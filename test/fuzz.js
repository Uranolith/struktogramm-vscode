// Zufallstest der Codeerzeugung (docs/CODEGEN-PLAN.md, Schritt 8): erzeugt zufällige Struktogramme, führt sie mit dem
// Interpreter aus, übersetzt sie in die Zielsprachen, baut und startet sie mit den echten Compilern und vergleicht die
// Ausgaben. Abweichungen werden als .nsd mit Seed nach test/out/fuzz/ geschrieben – so lassen sie sich nachstellen und
// als fester Test nach test/samples übernehmen.
//
//   node test/fuzz.js [--n 50] [--seed 1] [--size 12] [--jobs 4] [--log protokoll.txt] [--plain] [sprache … | all]
//   (Standard: 30 Struktogramme, Seed aus der Uhrzeit, die schnellen Sprachen python javascript c cpp rust;
//   all = alle acht Sprachen)
//
// Die Struktogramme vermeiden bewusst, was Code und Interpreter absichtlich verschieden behandeln (Plan, Phase 1):
// Ganzzahlen bleiben klein (mod), geteilt wird nur durch Konstanten ungleich 0.
//
// Schnell genug für viele Programme (Plan 8.2): Java, Kotlin und C# übersetzen alle Programme eines Laufs in EINEM
// Compiler-Aufruf (test/batch.js: eigenes package bzw. eigener namespace je Programm, C# über ein Startprogramm); die
// übrigen Sprachen bauen und starten mehrere Programme gleichzeitig (--jobs).
//
// Im Terminal zeigt eine Live-Ansicht (test/live.js) den Fortschritt je Programm und Sprache; ohne Terminal oder mit
// --plain erscheint das Protokoll Zeile für Zeile (mit --log zusätzlich in einer Datei).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mk } = require('../src/core/model');
const { toNsd } = require('../src/core/nsdxml');
const { generateCode, TARGETS } = require('../src/core/generators');
const S = require('./languages');
const { LiveView, liveWanted, vis } = require('./live');
const { BATCH_LANGS, compileAll, runCmd } = require('./batch');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : def; };
const COUNT = opt('n', 30);
const SEED0 = opt('seed', Date.now() % 1000000);
const SIZE = opt('size', 12);
const JOBS = opt('jobs', Math.max(2, os.cpus().length));
const langArgs = args.includes('all') ? Object.keys(TARGETS) : args.filter((a, i) => TARGETS[a] && !(args[i - 1] || '').startsWith('--'));
const LANGS = (langArgs.length ? langArgs : ['python', 'javascript', 'c', 'cpp', 'rust']).filter((l) => S.has(S.RUN[l].tool));
const OUT = path.join(__dirname, 'out', 'fuzz');
const LOG = args.includes('--log') ? path.resolve(args[args.indexOf('--log') + 1]) : null;
const LIVE = liveWanted(args);
if (LOG) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, ''); }
/** Protokollzeile: in die Datei (--log) und – ohne Live-Ansicht – in die Konsole */
const log = (line) => { if (LOG) fs.appendFileSync(LOG, vis(line) + '\n'); if (!LIVE) console.log(line); };
const label = (l) => TARGETS[l].label.replace(/ \(.*\)$/, '');

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
  const intAtom = (vars) => R.pick([intLit, () => R.pick(vars), () => R.pick(vars), () => `length(s)`, () => `arr[${R.int(0, 4)}]`,
    () => 'r.u', () => `pos("${R.pick(['b', 'x', 'Ö'])}", s)`, () => 'ord(copy(s + "a", 1, 1))'])();
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
    () => `r.v * 2`,
  ])();
  const strExpr = (vars) => R.pick([
    () => 's + "x"', () => `copy(s + "${R.pick(['ab', 'Öl', 'z'])}", 1, 6)`, () => `"n" + ${R.pick(vars)}`, () => 'uppercase(s)',
    () => 'lowercase(s + "QÄ")', () => `insert("${R.pick(['-', 'ü', 'yz'])}", s, ${R.int(1, 4)})`, () => `delete(s + "${R.pick(['k', 'ß'])}", ${R.int(1, 3)}, ${R.int(0, 2)})`,
    () => 'trim("  " + s + " ")', () => `chr(65 + abs(${R.pick(vars)}) mod 26) + s`, () => 'r.w + "r"', () => `copy(s, ${R.int(1, 3)}, 4)`,
  ])();
  const cond = (vars) => {
    const rel = () => `${intExpr(1, vars)} ${R.pick(['<', '>', '<=', '>=', '=', '<>'])} ${intExpr(1, vars)}`;
    return R.pick([rel, rel, () => `${rel()} and ${rel()}`, () => `${rel()} or not (${rel()})`, () => `(${rel()}) xor (${rel()})`,
      () => `s ${R.pick(['=', '<>', '<'])} "${R.pick(['ab', 'AB', 'abx'])}"`])();
  };
  const outItem = (vars) => R.pick([
    () => intExpr(1, vars), () => R.pick(DBLS), () => 's', () => `"t" + ${R.pick(vars)}`, () => `copy(s, 1, 2)`, () => cond(vars),
    () => 'r.u', () => 'r.v', () => 'r.w', () => 'g(r)',
  ])();

  // Anweisungen; vars = lesbare Ganzzahlen (inkl. Zählvariablen der umgebenden Schleifen),
  // k = { loop: in einer Schleife, tryD: Tiefe umschließender try-Blöcke }
  const stmts = (d, vars, k) => {
    const out = [];
    const n = R.int(1, d > 1 ? 3 : 2);
    for (let q = 0; q < n && budget > 0; q++) { budget--; out.push(stmt(d, vars, k)); }
    return out;
  };
  const stmt = (d, vars, k) => {
    const kinds = ['assign', 'assign', 'dbl', 'str', 'str', 'arr', 'out', 'out', 'file', 'rec'];
    if (d > 0) kinds.push('if', 'for', 'while', 'repeat', 'case', 'call', 'try');
    if (k.loop) kinds.push('leave', 'continue');
    if (k.tryD) kinds.push('throw', 'rterr');
    switch (R.pick(kinds)) {
      case 'assign': return mk.instruction(`${R.pick(INTS)} := ${intVal(vars)}`);
      case 'dbl': return mk.instruction(`${R.pick(DBLS)} := ${dblExpr(vars)}`);
      case 'str': return mk.instruction(`s := ${strExpr(vars)}`);
      case 'arr': return mk.instruction(`arr[${R.int(0, 4)}] := ${intVal(vars)}`);
      case 'rec': return mk.instruction(R.pick([() => `r.u := ${intVal(vars)}`, () => `r.v := ${dblExpr(vars)}`, () => `r.w := copy(${strExpr(vars)}, 1, 5)`])());
      case 'out': return mk.instruction(`OUTPUT ${outItem(vars)}${R.chance(0.4) ? ', " ", ' + outItem(vars) : ''}`);
      case 'if': return mk.alternative(cond(vars), stmts(d - 1, vars, k), R.chance(0.6) ? stmts(d - 1, vars, k) : []);
      case 'case': {
        const v = R.pick(vars);
        return mk.case(`${v} mod 3`, ['0', '1', 'default'], [stmts(d - 1, vars, k), stmts(d - 1, vars, k), R.chance(0.5) ? stmts(d - 1, vars, k) : []]);
      }
      case 'for': {
        const lv = loopVars.find((x) => !vars.includes(x)) || 'k';
        const lo = R.int(-2, 3), hi = lo + R.int(0, 4);
        const t = R.chance(0.3) ? `for ${lv} := ${hi} to ${lo} step -1` : `for ${lv} := ${lo} to ${hi}`;
        return mk.for(t, stmts(d - 1, [...vars, lv], { ...k, loop: true }));
      }
      case 'while': { // Zähler sichert das Ende
        const w = 'w' + d;
        return [mk.instruction(`${w} := 0`), mk.while(`while ${w} < ${R.int(1, 4)}`, [mk.instruction(`${w} := ${w} + 1`), ...stmts(d - 1, vars, { ...k, loop: true })])];
      }
      case 'repeat': {
        const w = 'r' + d;
        return [mk.instruction(`${w} := 0`), mk.repeat(`until ${w} >= ${R.int(1, 3)}`, [mk.instruction(`${w} := ${w} + 1`), ...stmts(d - 1, vars, { ...k, loop: true })])];
      }
      case 'call': return mk.instruction(`${R.pick(INTS)} := ${R.chance(0.7) ? `f(${intExpr(1, vars)}, ${R.pick(DBLS)})` : 'g(r)'} mod 1000`);
      case 'try': { // eigener Name je Tiefe: e1, e2 … (geschachtelt)
        const e = 'e' + (k.tryD + 1);
        const inner = { ...k, tryD: k.tryD + 1 };
        return mk.try(e, stmts(d - 1, vars, inner), [mk.instruction(`OUTPUT "gefangen ", ${e}`), ...(R.chance(0.3) ? stmts(d - 1, vars, k) : [])],
          R.chance(0.4) ? [mk.instruction(`OUTPUT "finally ${e}"`)] : []);
      }
      case 'rterr': { // Laufzeitfehler im try: Text des Interpreters im catch (Plan 2.9)
        const v = R.pick(vars);
        return mk.alternative(cond(vars), [mk.instruction(R.pick([`OUTPUT ${intExpr(1, vars)} div (${v} - ${v})`, `OUTPUT ${intExpr(1, vars)} mod (${v} - ${v})`,
          `OUTPUT arr[${R.int(5, 9)}]`, `arr[${R.int(-3, -1)}] := 1`, `OUTPUT 7 / (${v} - ${v})`]))], []);
      }
      case 'throw': return mk.alternative(cond(vars), [mk.jump(`throw "${R.pick(['T', 'Fehler', 'Ü'])}" + ${R.pick(vars)}`)], []);
      case 'file': { // Text, Ganzzahl und Kommazahl schreiben und zurücklesen (Plan 6.2)
        const v = R.pick(INTS), dv = R.pick(DBLS);
        return mk.instruction(['fh := fileCreate("fz.txt")', 'fileWriteLine(fh, s)', `fileWriteLine(fh, ${intExpr(1, vars)})`, `fileWrite(fh, ${R.pick(DBLS)})`,
          'fileClose(fh)', 'fh := fileOpen("fz.txt")', 's := fileReadLine(fh)', `${v} := fileReadInt(fh)`, `${dv} := fileReadDouble(fh)`,
          `OUTPUT "eof ", fileEOF(fh)`, 'fileClose(fh)']);
      }
      case 'leave': return mk.alternative(cond(vars), [mk.jump('leave')], []);
      case 'continue': return mk.alternative(cond(vars), [mk.jump('continue')], []);
      default: return mk.instruction('OUTPUT "?"');
    }
  };
  const flat = (xs) => xs.flatMap((x) => (Array.isArray(x) ? flat(x) : [x]));
  const types = mk.instruction('type P = record{u: int; v: double; w: string}');
  const init = mk.instruction(['a := 1', 'b := 2', 'c := 3', 'x := 0.5', 'y := 2.0', 's := "ab"', 'arr := {1, 2, 3, 4, 5}', 'r := P{u: 4, v: 1.5, w: "rec"}']);
  const body = flat(stmts(3, [...INTS], { loop: false, tryD: 0 }));
  const fin = mk.instruction(['OUTPUT a, " ", b, " ", c, " ", x, " ", y, " ", s', 'OUTPUT arr[0] + arr[4], " ", r.u, " ", r.v, " ", r.w']);
  const main = mk.root(`Zufall${seed}`, 'program', [types, init, ...body, fin]);
  // Unterprogramme: f(p, q) mit Ganzzahl und Kommazahl; g(pr) liest einen Record
  const f = mk.root('f(p, q)', 'sub', [mk.alternative('p > 3', [mk.jump('return p * 2 mod 97')], [mk.jump('return p + 1')])]);
  const g = mk.root('g(pr)', 'sub', [mk.jump('return pr.u mod 50 + length(pr.w)')]);
  return { roots: [main, f, g] };
}

/* ---------------- Lauf ---------------- */
/** Aufgaben mit höchstens n gleichzeitig abarbeiten */
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; await fn(items[k], k); }
  }));
}

(async () => {
  log(`Zufallstest: ${COUNT} Struktogramme ab Seed ${SEED0}, Sprachen ${LANGS.join(' ')}, ${JOBS} gleichzeitig`);
  const live = LIVE ? new LiveView({ title: `Zufallstest – ${COUNT} Struktogramme ab Seed ${SEED0}, ${JOBS} gleichzeitig`, unit: 'Prüfungen (Programm × Sprache)',
    langs: LANGS.map((l) => ({ id: l, label: label(l) })), total: COUNT * LANGS.length }) : null;
  if (live) live.setPhase('Struktogramme erzeugen und mit dem Interpreter ausführen …', LOG ? [`Protokoll: ${LOG}`] : []);
  const t0 = Date.now();
  const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'fuzz-'));
  // 1. Programme erzeugen, Referenz mit dem Interpreter
  const cases = [];
  let skipped = 0;
  for (let n = 0; n < COUNT; n++) {
    const seed = SEED0 + n;
    const doc = program(seed);
    const ref = S.interpret(doc, []);
    if (ref.error) { skipped++; continue; } // Interpreter-Fehler (z. B. Wert fehlt): kein sinnvoller Vergleich
    cases.push({ seed, doc, ref, bad: [] });
  }
  if (live) live.setTotal(cases.length * LANGS.length);
  /** ein Programm in einer Sprache fertig (Live-Ansicht) */
  const reported = new Set();
  const report = (c, lang) => {
    if (!live || reported.has(c.seed + '|' + lang)) return;
    reported.add(c.seed + '|' + lang);
    const bad = c.bad.filter((b) => b.lang === lang);
    live.itemDone(`Seed ${c.seed}`, { [lang]: bad.length ? 'X' : 'O' }, bad.map((b) => `${label(lang)}: ${b.msg.split('\n')[0].slice(0, 180)}`));
  };
  const check = (c, lang, r) => {
    const d = r.timedOut ? 'Zeitüberschreitung' : S.diff(c.ref.output, r.stdout);
    if (d) c.bad.push({ lang, msg: d });
  };

  // 2. Sprachen mit eigenem Compiler-Aufruf je Programm: mehrere gleichzeitig
  const single = LANGS.filter((l) => !BATCH_LANGS.includes(l));
  if (live && single.length) live.setPhase(`${single.map(label).join(', ')}: je Programm übersetzen und starten …`, live.info);
  await pool(cases.flatMap((c) => single.map((lang) => ({ c, lang }))), JOBS, async ({ c, lang }) => {
    try { await runSingle(c, lang); } finally { report(c, lang); }
  });
  async function runSingle(c, lang) {
    const dir = path.join(WORK, lang, String(c.seed));
    S.prepare(dir, lang);
    let code;
    try { code = generateCode(c.doc, lang, { className: S.CLASS_NAME }); } catch (e) { c.bad.push({ lang, msg: 'Codeerzeugung: ' + e.message }); return; }
    fs.writeFileSync(path.join(dir, S.RUN[lang].file), code);
    const b = await S.build(lang, dir);
    if (b) { c.bad.push({ lang, msg: 'Übersetzen: ' + b.split('\n')[0] }); return; }
    check(c, lang, await S.run(lang, dir, [], 20000));
  }

  // 3. Java, Kotlin, C#: alle Programme in einem Compiler-Aufruf (test/batch.js), dann einzeln starten
  for (const lang of LANGS.filter((l) => BATCH_LANGS.includes(l))) {
    const dir = path.join(WORK, lang);
    if (live) live.setPhase(`${label(lang)}: alle ${cases.length} Programme in einem Compiler-Aufruf übersetzen …`, live.info);
    const items = [];
    for (const c of cases) {
      try { items.push({ id: c.seed, code: generateCode(c.doc, lang, { className: S.CLASS_NAME }) }); } catch (e) { c.bad.push({ lang, msg: 'Codeerzeugung: ' + e.message }); report(c, lang); }
    }
    const { errors } = await compileAll(lang, dir, items);
    const todo = [];
    for (const c of cases) {
      if (errors.has(c.seed)) { c.bad.push({ lang, msg: 'Übersetzen: ' + errors.get(c.seed) }); report(c, lang); }
      else if (items.some((it) => it.id === c.seed)) todo.push(c);
    }
    if (live) live.setPhase(`${label(lang)}: Programme starten …`, live.info);
    await pool(todo, JOBS, async (c) => {
      // eigener Arbeitsordner je Programm: Die Dateifunktionen schreiben sonst gleichzeitig in dieselbe Datei
      const cwd = path.join(dir, 'run', String(c.seed));
      fs.mkdirSync(cwd, { recursive: true });
      const [cmd, a] = runCmd(lang, dir, c.seed);
      check(c, lang, await S.exec(cmd, a, { cwd, input: '\n', timeout: 20000 }));
      report(c, lang);
    });
  }

  // 4. Bericht in Seed-Reihenfolge
  let fails = 0;
  log(cases.map((c) => (c.bad.length ? 'X' : '.')).join(''));
  for (const c of cases) {
    if (!c.bad.length) continue;
    fails++;
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `seed_${c.seed}.nsd`);
    fs.writeFileSync(file, toNsd(c.doc));
    fs.writeFileSync(file.replace(/\.nsd$/, '.txt'), c.bad.map((x) => `${x.lang}: ${x.msg}`).join('\n') + '\n');
    log(`  Seed ${c.seed}: ${c.bad.map((x) => `${x.lang}: ${x.msg.slice(0, 160)}`).join('\n             ')}`);
  }
  fs.rmSync(WORK, { recursive: true, force: true });
  const summary = `${cases.length} verglichen, ${fails} mit Abweichung${skipped ? `, ${skipped} übersprungen (Interpreter-Fehler)` : ''}` +
    ` – ${Math.round((Date.now() - t0) / 1000)} s`;
  log(summary + (fails ? ` – Dateien in ${OUT}` : ''));
  if (live) live.finish(summary, !fails, ['', ...(fails ? [`Abweichungen als .nsd in ${OUT}`, `nachstellen: node test/fuzz.js --n 1 --seed <Seed> ${LANGS.length === 8 ? 'all' : LANGS.join(' ')}`] : []), ...(LOG ? [`Protokoll: ${LOG}`] : [])]);
  process.exitCode = fails ? 1 : 0;
})();
