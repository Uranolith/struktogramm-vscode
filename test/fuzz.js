// Zufallstest der Codeerzeugung (docs/CODEGEN-PLAN.md, Schritt 8): erzeugt zufällige Struktogramme, führt sie mit dem
// Interpreter aus, übersetzt sie in die Zielsprachen, baut und startet sie mit den echten Compilern und vergleicht die
// Ausgaben. Abweichungen werden als .nsd mit Seed nach test/out/fuzz/ geschrieben – so lassen sie sich nachstellen und
// als fester Test nach test/samples übernehmen.
//
//   node test/fuzz.js [--n 50] [--seed 1] [--size 12] [sprache …]
//   (Standard: 30 Struktogramme, Seed aus der Uhrzeit, die schnellen Sprachen python javascript c cpp rust)
//
// Die Struktogramme vermeiden bewusst, was Code und Interpreter absichtlich verschieden behandeln (Plan, Phase 1):
// Ganzzahlen bleiben klein (mod), geteilt wird nur durch Konstanten ungleich 0.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mk } = require('../src/core/model');
const { toNsd } = require('../src/core/nsdxml');
const { generateCode, TARGETS } = require('../src/core/generators');
const S = require('./languages');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : def; };
const COUNT = opt('n', 30);
const SEED0 = opt('seed', Date.now() % 1000000);
const SIZE = opt('size', 12);
const langArgs = args.filter((a, i) => TARGETS[a] && !(args[i - 1] || '').startsWith('--'));
const LANGS = (langArgs.length ? langArgs : ['python', 'javascript', 'c', 'cpp', 'rust']).filter((l) => S.has(S.RUN[l].tool));
const OUT = path.join(__dirname, 'out', 'fuzz');

/* ---------------- Zufall (mulberry32, wiederholbar über den Seed) ---------------- */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (xs) => xs[Math.floor(next() * xs.length)], chance: (p) => next() < p };
}

/* ---------------- Struktogramm erzeugen ---------------- */
function program(seed) {
  const R = rng(seed);
  const INTS = ['a', 'b', 'c'], DBLS = ['x', 'y'];
  let budget = SIZE;
  const loopVars = ['i', 'j', 'k'];

  const intLit = () => String(R.int(-5, 20));
  const intAtom = (vars) => R.pick([intLit, () => R.pick(vars), () => `length(s)`, () => `arr[${R.int(0, 4)}]`])();
  const intExpr = (d, vars) => {
    if (d <= 0 || R.chance(0.35)) return intAtom(vars);
    const op = R.pick(['+', '-', '*', 'div', 'mod', 'abs', 'minmax', 'paren']);
    const A = intExpr(d - 1, vars), B = intExpr(d - 1, vars);
    switch (op) {
      case 'div': return `${A} div ${R.pick(['2', '3', '7', '-4'])}`;
      case 'mod': return `${A} mod ${R.pick(['2', '5', '9'])}`;
      case 'abs': return `abs(${A})`;
      case 'minmax': return `${R.pick(['min', 'max'])}(${A}, ${B})`;
      case 'paren': return `(${A})`;
      default: return `${A} ${op} ${B}`;
    }
  };
  // Werte klein halten: Ergebnis einer Zuweisung mod 1000 (Überlauf ist bewusst Sache des Programms, Plan 1.1)
  const intVal = (vars) => `(${intExpr(2, vars)}) mod 1000`;
  const dblExpr = (vars) => R.pick([
    () => `${R.pick(DBLS)} + ${R.int(1, 9)}.5`,
    () => `${R.pick(vars)} * 1.5`,
    () => `sqrt(abs(${R.pick(vars)}))`,
    () => `${R.pick(DBLS)} / ${R.pick(['2', '4.0', '8'])}`,
    () => `${R.pick(vars)} / 4.0`,
    () => `${R.int(0, 9)}.25`,
  ])();
  const cond = (vars) => {
    const rel = () => `${intExpr(1, vars)} ${R.pick(['<', '>', '<=', '>=', '=', '<>'])} ${intExpr(1, vars)}`;
    return R.pick([rel, rel, () => `${rel()} and ${rel()}`, () => `${rel()} or not (${rel()})`, () => `(${rel()}) xor (${rel()})`])();
  };
  const outItem = (vars) => R.pick([
    () => intExpr(1, vars), () => R.pick(DBLS), () => 's', () => `"t" + ${R.pick(vars)}`, () => `copy(s, 1, 2)`, () => cond(vars),
  ])();

  // Anweisungen; vars = lesbare Ganzzahlen (inkl. Zählvariablen der umgebenden Schleifen)
  const stmts = (d, vars, inLoop) => {
    const out = [];
    const n = R.int(1, d > 1 ? 3 : 2);
    for (let q = 0; q < n && budget > 0; q++) { budget--; out.push(stmt(d, vars, inLoop)); }
    return out;
  };
  const stmt = (d, vars, inLoop) => {
    const kinds = ['assign', 'assign', 'dbl', 'str', 'arr', 'out', 'out', 'file'];
    if (d > 0) kinds.push('if', 'for', 'while', 'repeat', 'case', 'call');
    if (inLoop) kinds.push('leave', 'continue');
    switch (R.pick(kinds)) {
      case 'assign': return mk.instruction(`${R.pick(INTS)} := ${intVal(vars)}`);
      case 'dbl': return mk.instruction(`${R.pick(DBLS)} := ${dblExpr(vars)}`);
      case 'str': return mk.instruction(`s := ${R.pick(['s + "x"', `copy(s + "${R.pick(['ab', 'Öl', 'z'])}", 1, 6)`, `"n" + ${R.pick(vars)}`, 'uppercase(s)'])}`);
      case 'arr': return mk.instruction(`arr[${R.int(0, 4)}] := ${intVal(vars)}`);
      case 'out': return mk.instruction(`OUTPUT ${outItem(vars)}${R.chance(0.4) ? ', " ", ' + outItem(vars) : ''}`);
      case 'if': return mk.alternative(cond(vars), stmts(d - 1, vars, inLoop), R.chance(0.6) ? stmts(d - 1, vars, inLoop) : []);
      case 'case': {
        const v = R.pick(vars);
        return mk.case(`${v} mod 3`, ['0', '1', 'default'], [stmts(d - 1, vars, inLoop), stmts(d - 1, vars, inLoop), R.chance(0.5) ? stmts(d - 1, vars, inLoop) : []]);
      }
      case 'for': {
        const lv = loopVars.find((x) => !vars.includes(x)) || 'k';
        const lo = R.int(-2, 3), hi = lo + R.int(0, 4);
        const t = R.chance(0.3) ? `for ${lv} := ${hi} to ${lo} step -1` : `for ${lv} := ${lo} to ${hi}`;
        return mk.for(t, stmts(d - 1, [...vars, lv], true));
      }
      case 'while': { // Zähler sichert das Ende
        const w = 'w' + d;
        return [mk.instruction(`${w} := 0`), mk.while(`while ${w} < ${R.int(1, 4)}`, [mk.instruction(`${w} := ${w} + 1`), ...stmts(d - 1, vars, true)])];
      }
      case 'repeat': {
        const w = 'r' + d;
        return [mk.instruction(`${w} := 0`), mk.repeat(`until ${w} >= ${R.int(1, 3)}`, [mk.instruction(`${w} := ${w} + 1`), ...stmts(d - 1, vars, true)])];
      }
      case 'call': return mk.instruction(`${R.pick(INTS)} := f(${intExpr(1, vars)}, ${R.pick(DBLS)}) mod 1000`);
      case 'file': { // Text, Ganzzahl und Kommazahl schreiben und zurücklesen (Plan 6.2)
        const v = R.pick(INTS), d = R.pick(DBLS);
        return mk.instruction(['fh := fileCreate("fz.txt")', 'fileWriteLine(fh, s)', `fileWriteLine(fh, ${intExpr(1, vars)})`, `fileWrite(fh, ${R.pick(DBLS)})`,
          'fileClose(fh)', 'fh := fileOpen("fz.txt")', 's := fileReadLine(fh)', `${v} := fileReadInt(fh)`, `${d} := fileReadDouble(fh)`,
          `OUTPUT "eof ", fileEOF(fh)`, 'fileClose(fh)']);
      }
      case 'leave': return mk.alternative(cond(vars), [mk.jump('leave')], []);
      case 'continue': return mk.alternative(cond(vars), [mk.jump('continue')], []);
      default: return mk.instruction('OUTPUT "?"');
    }
  };
  const flat = (xs) => xs.flatMap((x) => (Array.isArray(x) ? flat(x) : [x]));
  const init = mk.instruction(['a := 1', 'b := 2', 'c := 3', 'x := 0.5', 'y := 2.0', 's := "ab"', 'arr := {1, 2, 3, 4, 5}']);
  const body = flat(stmts(3, [...INTS], false));
  const fin = mk.instruction(['OUTPUT a, " ", b, " ", c, " ", x, " ", y, " ", s', 'OUTPUT arr[0] + arr[4]']);
  const main = mk.root(`Zufall${seed}`, 'program', [init, ...body, fin]);
  // Unterprogramm f(p, q): Ganzzahl und Kommazahl, gibt eine Ganzzahl zurück
  const f = mk.root('f(p, q)', 'sub', [mk.alternative('p > 3', [mk.jump('return p * 2 mod 97')], [mk.jump('return p + 1')])]);
  return { roots: [main, f] };
}

/* ---------------- Lauf ---------------- */
(async () => {
  console.log(`Zufallstest: ${COUNT} Struktogramme ab Seed ${SEED0}, Sprachen ${LANGS.join(' ')}`);
  const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'fuzz-'));
  let fails = 0, skipped = 0;
  for (let n = 0; n < COUNT; n++) {
    const seed = SEED0 + n;
    const doc = program(seed);
    const ref = S.interpret(doc, []);
    if (ref.error) { skipped++; continue; } // Interpreter-Fehler (z. B. Wert fehlt): kein sinnvoller Vergleich
    const res = await Promise.all(LANGS.map(async (lang) => {
      const dir = path.join(WORK, lang, String(seed));
      S.prepare(dir, lang);
      let code;
      try { code = generateCode(doc, lang, { className: S.CLASS_NAME }); } catch (e) { return { lang, msg: 'Codeerzeugung: ' + e.message }; }
      fs.writeFileSync(path.join(dir, S.RUN[lang].file), code);
      const b = await S.build(lang, dir);
      if (b) return { lang, msg: 'Übersetzen: ' + b.split('\n')[0] };
      const r = await S.run(lang, dir, [], 20000);
      const d = r.timedOut ? 'Zeitüberschreitung' : S.diff(ref.output, r.stdout);
      return d ? { lang, msg: d } : null;
    }));
    const bad = res.filter(Boolean);
    process.stdout.write(bad.length ? 'X' : '.');
    if (bad.length) {
      fails++;
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, `seed_${seed}.nsd`);
      fs.writeFileSync(file, toNsd(doc));
      fs.writeFileSync(file.replace(/\.nsd$/, '.txt'), bad.map((x) => `${x.lang}: ${x.msg}`).join('\n') + '\n');
      console.log(`\n  Seed ${seed}: ${bad.map((x) => `${x.lang}: ${x.msg.slice(0, 160)}`).join('\n             ')}`);
    }
  }
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log(`\n${COUNT - skipped} verglichen, ${fails} mit Abweichung${skipped ? `, ${skipped} übersprungen (Interpreter-Fehler)` : ''}` + (fails ? ` – Dateien in ${OUT}` : ''));
  process.exitCode = fails ? 1 : 0;
})();
