// Zufallstest der Codeerzeugung (docs/CODEGEN-PLAN.md, Schritt 8): erzeugt zufällige Struktogramme, führt sie mit dem
// Interpreter aus, übersetzt sie in die Zielsprachen, baut und startet sie mit den echten Compilern und vergleicht die
// Ausgaben. Abweichungen werden als .nsd mit Seed nach test/out/fuzz/ geschrieben – so lassen sie sich nachstellen und
// als fester Test nach test/samples übernehmen.
//
//   node test/fuzz.js [--n 50] [--seed 1] [--size 12] [--jobs 4] [sprache … | all]
//   (Standard: 30 Struktogramme, Seed aus der Uhrzeit, die schnellen Sprachen python javascript c cpp rust;
//   all = alle acht Sprachen)
//
// Die Struktogramme vermeiden bewusst, was Code und Interpreter absichtlich verschieden behandeln (Plan, Phase 1):
// Ganzzahlen bleiben klein (mod), geteilt wird nur durch Konstanten ungleich 0.
//
// Schnell genug für viele Programme (Plan 8.2): Java, Kotlin und C# übersetzen alle Programme eines Laufs in EINEM
// Compiler-Aufruf (eigener Klassenname bzw. eigenes Kotlin-package je Programm, C# über ein Startprogramm); die
// übrigen Sprachen bauen und starten mehrere Programme gleichzeitig (--jobs).
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
const JOBS = opt('jobs', Math.max(2, os.cpus().length));
const langArgs = args.includes('all') ? Object.keys(TARGETS) : args.filter((a, i) => TARGETS[a] && !(args[i - 1] || '').startsWith('--'));
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
/** Aufgaben mit höchstens n gleichzeitig abarbeiten */
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; await fn(items[k], k); }
  }));
}

/**
 * Sprachen, die alle Programme in einem Compiler-Aufruf übersetzen: Dateiname, Code, Übersetzen (Dateiliste) und
 * Starten je Seed. Kotlin: eigenes package je Programm (sonst kollidieren main, f und die Hilfsfunktionen); C#: ein
 * Startprogramm ruft per Reflection die Main des gewünschten Programms auf.
 */
const BATCHED = {
  java: {
    file: (seed) => `Program${seed}.java`,
    code: (doc, seed) => generateCode(doc, 'java', { className: `Program${seed}` }),
    build: (files) => ['javac', ['-encoding', 'UTF-8', '-d', 'jcls', ...files]],
    run: (seed, dir) => ['java', ['-Dstdout.encoding=UTF-8', '-cp', path.join(dir, 'jcls'), `Program${seed}`]],
  },
  kotlin: {
    file: (seed) => `prog${seed}.kt`,
    code: (doc, seed) => `package p${seed}\n` + generateCode(doc, 'kotlin', {}),
    build: (files) => ['kotlinc', [...files, '-include-runtime', '-nowarn', '-d', 'fuzz.jar'], true],
    run: (seed, dir) => ['java', ['-Dstdout.encoding=UTF-8', '-cp', path.join(dir, 'fuzz.jar'), `p${seed}.Prog${seed}Kt`]],
  },
  csharp: {
    file: (seed) => `cs/Program${seed}.cs`,
    code: (doc, seed) => generateCode(doc, 'csharp', { className: `Program${seed}` }),
    build: () => ['dotnet', ['build', 'cs', '-nologo', '-v', 'q', '-o', 'cs/out']],
    run: (seed, dir) => ['dotnet', [path.join(dir, 'cs/out/cs.dll'), `Program${seed}`]],
    prepare(dir) {
      fs.mkdirSync(path.join(dir, 'cs'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'cs/cs.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>' +
        '<TargetFramework>net8.0</TargetFramework><RollForward>Major</RollForward><Nullable>disable</Nullable><ImplicitUsings>disable</ImplicitUsings>' +
        '<StartupObject>FuzzMain</StartupObject><NoWarn>CS7022;CS0168;CS0219;CS0162</NoWarn></PropertyGroup></Project>');
      fs.writeFileSync(path.join(dir, 'cs/FuzzMain.cs'), `using System;
using System.Reflection;
class FuzzMain
{
    static void Main(string[] a)
    {
        var m = Type.GetType(a[0]).GetMethod("Main", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
        try { m.Invoke(null, m.GetParameters().Length == 0 ? null : new object[] { new string[0] }); }
        catch (TargetInvocationException e) { Console.Out.Flush(); Console.Error.WriteLine(e.InnerException); Environment.Exit(1); }
    }
}
`);
    },
  },
};

/** Fehlerzeilen eines gemeinsamen Übersetzens den Programmen (Seeds) zuordnen */
function errorsBySeed(out) {
  const m = new Map();
  for (const line of String(out).replace(/\r/g, '').split('\n')) {
    const r = /(?:Program|prog)(\d+)\.(?:java|kt|cs)\b.*\b(?:error|fehler)\b/i.exec(line); // javac meldet je nach Sprache „Fehler“
    if (r && !m.has(Number(r[1]))) m.set(Number(r[1]), line.trim());
  }
  return m;
}

(async () => {
  console.log(`Zufallstest: ${COUNT} Struktogramme ab Seed ${SEED0}, Sprachen ${LANGS.join(' ')}, ${JOBS} gleichzeitig`);
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
  const check = (c, lang, r) => {
    const d = r.timedOut ? 'Zeitüberschreitung' : S.diff(c.ref.output, r.stdout);
    if (d) c.bad.push({ lang, msg: d });
  };

  // 2. Sprachen mit eigenem Compiler-Aufruf je Programm: mehrere gleichzeitig
  const single = LANGS.filter((l) => !BATCHED[l]);
  await pool(cases.flatMap((c) => single.map((lang) => ({ c, lang }))), JOBS, async ({ c, lang }) => {
    const dir = path.join(WORK, lang, String(c.seed));
    S.prepare(dir, lang);
    let code;
    try { code = generateCode(c.doc, lang, { className: S.CLASS_NAME }); } catch (e) { c.bad.push({ lang, msg: 'Codeerzeugung: ' + e.message }); return; }
    fs.writeFileSync(path.join(dir, S.RUN[lang].file), code);
    const b = await S.build(lang, dir);
    if (b) { c.bad.push({ lang, msg: 'Übersetzen: ' + b.split('\n')[0] }); return; }
    check(c, lang, await S.run(lang, dir, [], 20000));
  });

  // 3. Java, Kotlin, C#: alle Programme in einem Compiler-Aufruf, dann nacheinander starten
  for (const lang of LANGS.filter((l) => BATCHED[l])) {
    const B = BATCHED[lang];
    const dir = path.join(WORK, lang);
    fs.mkdirSync(dir, { recursive: true });
    if (B.prepare) B.prepare(dir);
    let todo = [];
    for (const c of cases) {
      try { fs.writeFileSync(path.join(dir, B.file(c.seed)), B.code(c.doc, c.seed)); todo.push(c); } catch (e) { c.bad.push({ lang, msg: 'Codeerzeugung: ' + e.message }); }
    }
    // Übersetzungsfehler: betroffene Programme herausnehmen und den Rest erneut übersetzen
    for (let attempt = 0; todo.length && attempt < 5; attempt++) {
      const [cmd, a, shell] = B.build(todo.map((c) => B.file(c.seed)));
      const r = await S.exec(cmd, a, { cwd: dir, shell: !!shell, timeout: 1800000 });
      if (r.status === 0) break;
      const errs = errorsBySeed((r.stdout || '') + (r.stderr || ''));
      const hit = todo.filter((c) => errs.has(c.seed));
      if (!hit.length) { // nicht zuzuordnen: alle als fehlgeschlagen melden
        const msg = ((r.stdout || '') + (r.stderr || '')).split('\n').find((l) => /error|fehler/i.test(l)) || 'Übersetzen fehlgeschlagen';
        todo.forEach((c) => c.bad.push({ lang, msg: 'Übersetzen: ' + msg.trim() }));
        todo = [];
        break;
      }
      for (const c of hit) {
        c.bad.push({ lang, msg: 'Übersetzen: ' + errs.get(c.seed) });
        if (lang === 'csharp') fs.rmSync(path.join(dir, B.file(c.seed)), { force: true }); // C# übersetzt alle Dateien im Ordner
      }
      todo = todo.filter((c) => !errs.has(c.seed));
    }
    await pool(todo, JOBS, async (c) => {
      // eigener Arbeitsordner je Programm: Die Dateifunktionen schreiben sonst gleichzeitig in dieselbe Datei
      const cwd = path.join(dir, 'run', String(c.seed));
      fs.mkdirSync(cwd, { recursive: true });
      const [cmd, a] = B.run(c.seed, dir);
      check(c, lang, await S.exec(cmd, a, { cwd, input: '\n', timeout: 20000 }));
    });
  }

  // 4. Bericht in Seed-Reihenfolge
  let fails = 0;
  process.stdout.write(cases.map((c) => (c.bad.length ? 'X' : '.')).join('') + '\n');
  for (const c of cases) {
    if (!c.bad.length) continue;
    fails++;
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `seed_${c.seed}.nsd`);
    fs.writeFileSync(file, toNsd(c.doc));
    fs.writeFileSync(file.replace(/\.nsd$/, '.txt'), c.bad.map((x) => `${x.lang}: ${x.msg}`).join('\n') + '\n');
    console.log(`  Seed ${c.seed}: ${c.bad.map((x) => `${x.lang}: ${x.msg.slice(0, 160)}`).join('\n             ')}`);
  }
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log(`${cases.length} verglichen, ${fails} mit Abweichung${skipped ? `, ${skipped} übersprungen (Interpreter-Fehler)` : ''}` +
    ` – ${Math.round((Date.now() - t0) / 1000)} s` + (fails ? ` – Dateien in ${OUT}` : ''));
  process.exitCode = fails ? 1 : 0;
})();
