// Abdeckungstest Bibliotheksfunktionen: Jede Funktion und Methode, die der Interpreter kennt (executor.js: builtin()
// und method()), muss der Generator in jede Zielsprache übersetzen. Schnell (ohne Compiler): Der Test erzeugt je
// Funktion ein kleines Programm und prüft, ob der Aufruf unübersetzt im Code stehen bleibt.
//
//   node test/builtins.js            alle Funktionen, alle Sprachen
//   node test/builtins.js -v         zusätzlich die erzeugte Zeile je Fehler
//
// Bekannte Lücken stehen in KNOWN mit dem Schritt aus docs/CODEGEN-PLAN.md, der sie schließt (K). Ist eine bekannte
// Lücke geschlossen, schlägt der Test fehl (B), bis der Eintrag entfernt ist. Neue Funktionen im Interpreter ohne
// Eintrag in CALLS lassen den Test ebenfalls fehlschlagen.
'use strict';
const fs = require('fs');
const path = require('path');
const { mk } = require('../src/core/model');
const { generateCode, TARGETS } = require('../src/core/generators');

const verbose = process.argv.includes('-v');
const LANGS = Object.keys(TARGETS);

/* Funktionen und Methoden aus dem Quelltext des Interpreters */
const src = fs.readFileSync(path.join(__dirname, '../src/core/executor.js'), 'utf8');
const section = (start, end) => { const a = src.indexOf(start); const b = src.indexOf(end, a); return src.slice(a, b); };
const casesIn = (text) => [...text.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]);
const FUNCS = new Set(casesIn(section('  builtin(name, args, path) {', 'default: throw new ExecError(tr(\'exec.unknownFunc\'')));
const METHODS = new Set(casesIn(section('  method(obj, name, args, path) {', 'throw new ExecError(tr(\'exec.unknownMethod\'')));
// keine Funktionen im eigentlichen Sinn: print/println sind im Struktogramm verboten (OUTPUT), inc/dec sind Prozeduren (unten)
for (const n of ['print', 'println']) FUNCS.delete(n);

/**
 * Beispielaufruf je Funktion. Kontext: s := "abc", a := {1, 2, 3}, p := P{x: 1} (Record), x := 5.
 * stmt: Aufruf als Anweisung (Prozedur); sonst r := Aufruf.
 */
const CALLS = {
  asin: 'asin(0.5)', acos: 'acos(0.5)', atan: 'atan(1.0)', toradians: 'toRadians(90)', todegrees: 'toDegrees(1.0)',
  sgn: 'sgn(-2)', signum: 'signum(-2.5)', trim: 'trim(s)', insert: 'insert("x", s, 2)', delete: 'delete(s, 1, 1)',
  split: 'split(s, "b")', strcmp: 'strcmp(s, "x")', isarray: 'isArray(a)', isstring: 'isString(s)', ischar: 'isChar(s)',
  isbool: 'isBool(x)', isnumber: 'isNumber(x)', copyarray: 'copyArray(a)', copyrecord: 'copyRecord(p)',
  randomize: { stmt: 'randomize()' }, sqrt: 'sqrt(2.0)', abs: 'abs(-3)', pow: 'pow(2, 3)', power: 'power(2, 3)',
  exp: 'exp(1.0)', log: 'log(2.0)', ln: 'ln(2.0)', sin: 'sin(1.0)', cos: 'cos(1.0)', tan: 'tan(1.0)', floor: 'floor(2.7)',
  ceil: 'ceil(2.1)', round: 'round(2.5)', trunc: 'trunc(2.7)', int: 'int(2.7)', float: 'float(x)', double: 'double(x)',
  real: 'real(x)', str: 'str(x)', tostring: 'toString(x)', inttostr: 'intToStr(x)', floattostr: 'floatToStr(2.5)',
  strtoint: 'strToInt("42")', strtofloat: 'strToFloat("2.5")', chr: 'chr(65)', ord: 'ord("A")', length: 'length(s)',
  len: 'len(s)', uppercase: 'uppercase(s)', upper: 'upper(s)', lowercase: 'lowercase(s)', lower: 'lower(s)',
  copy: 'copy(s, 1, 2)', pos: 'pos("b", s)', min: 'min(1, 2)', max: 'max(1, 2)', random: 'random(6)', randint: 'randint(1, 6)',
  range: 'range(5)', sum: 'sum(a)', odd: 'odd(x)', sqr: 'sqr(3)', trunc_: null,
  inc: { stmt: 'inc(x)' }, dec: { stmt: 'dec(x)' },
};
delete CALLS.trunc_;
/** Methoden: Aufruf auf einem Text (s) bzw. Array (a) */
const METHOD_CALLS = {
  length: ['s.length()', 'a.length()'], size: ['s.size()', 'a.size()'], charat: ['s.charAt(1)'], substring: ['s.substring(0, 2)'],
  touppercase: ['s.toUpperCase()'], upper: ['s.upper()'], tolowercase: ['s.toLowerCase()'], lower: ['s.lower()'],
  indexof: ['s.indexOf("b")', 'a.indexOf(2)'], contains: ['s.contains("b")', 'a.contains(2)'], equals: ['s.equals("abc")'],
  trim: ['s.trim()'], strip: ['s.strip()'], startswith: ['s.startsWith("a")'], endswith: ['s.endsWith("c")'],
  append: [{ stmt: 'a.append(4)' }], add: [{ stmt: 'a.add(4)' }], push: [{ stmt: 'a.push(4)' }], pop: ['a.pop()'], get: ['a.get(1)'],
};

/**
 * Namen, die in der Zielsprache unter demselben Namen mit derselben Bedeutung existieren – bleibt der Aufruf so stehen,
 * ist das richtig (Funktionen: name(…); Methoden: .name(…))
 */
const NATIVE = {
  python: ['abs', 'chr', 'ord', 'len', 'max', 'min', 'str', 'int', 'float', 'round', 'sum', 'pow', 'range'],
  c: ['abs', 'sqrt', 'pow', 'floor', 'ceil', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'strcmp', 'trunc'],
  cpp: ['abs', 'sqrt', 'pow', 'floor', 'ceil', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'trunc', 'max', 'min'],
  java: [], csharp: [], javascript: [], kotlin: [],
  rust: ['random'], // Hilfsfunktion des Generators (fn random() -> f64)
};
const NATIVE_METHODS = {
  python: ['upper', 'lower', 'strip', 'startswith', 'endswith', 'append', 'pop', 'index'],
  java: ['length', 'charAt', 'substring', 'toUpperCase', 'toLowerCase', 'indexOf', 'contains', 'equals', 'trim', 'strip', 'startsWith', 'endsWith', 'size', 'add', 'get'],
  javascript: ['substring', 'toUpperCase', 'toLowerCase', 'indexOf', 'trim', 'startsWith', 'endsWith', 'push', 'pop', 'charAt'],
  csharp: [], c: [], cpp: ['size', 'substr', 'push_back', 'pop_back'], kotlin: ['substring', 'uppercase', 'lowercase', 'indexOf', 'contains', 'equals', 'trim', 'startsWith', 'endsWith', 'get', 'add'],
  rust: ['len', 'to_uppercase', 'to_lowercase', 'contains', 'trim', 'starts_with', 'ends_with', 'push', 'pop', 'get'],
};

/**
 * Bekannte Lücken: Funktion (bzw. "methode:name") -> { sprache oder *: Planschritt }
 * Stand 26.11.2026 (Bestandsaufnahme); wird mit den Schritten in docs/CODEGEN-PLAN.md kleiner.
 */
const KNOWN = {
  copyrecord: { '*': '6.1' },
  floattostr: { '*': '6.3' },
  inttostr: { '*': '6.3' },
  isarray: { '*': '6.1' },
  isbool: { '*': '6.1' },
  ischar: { '*': '6.1' },
  isnumber: { '*': '6.1' },
  isstring: { '*': '6.1' },
  ln: { '*': '6.3' },
  lower: { '*': '6.3' },
  odd: { '*': '6.3' },
  power: { '*': '6.3' },
  randint: { '*': '6.3' },
  range: { java: '6.3', c: '6.3', cpp: '6.3', csharp: '6.3', javascript: '6.3', kotlin: '6.3', rust: '6.3' },
  real: { '*': '6.3' },
  signum: { '*': '6.1' },
  split: { c: '6.1', cpp: '6.1' },
  strtofloat: { '*': '6.3' },
  strtoint: { '*': '6.3' },
  sum: { java: '6.3', c: '6.3', cpp: '6.3', csharp: '6.3', javascript: '6.3', kotlin: '6.3', rust: '6.3' },
  tostring: { '*': '6.3' },
  upper: { '*': '6.3' },
  "methode:add": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', javascript: '6.5', rust: '6.5' },
  "methode:append": { java: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', javascript: '6.5', kotlin: '6.5', rust: '6.5' },
  "methode:charat": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', kotlin: '6.5', rust: '6.5' },
  "methode:contains": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', javascript: '6.5' },
  "methode:endswith": { c: '6.5', cpp: '6.5', csharp: '6.5', rust: '6.5' },
  "methode:equals": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', javascript: '6.5', rust: '6.5' },
  "methode:get": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', javascript: '6.5' },
  "methode:indexof": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', rust: '6.5' },
  "methode:length": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', javascript: '6.5', kotlin: '6.5', rust: '6.5' },
  "methode:lower": { java: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', javascript: '6.5', kotlin: '6.5', rust: '6.5' },
  "methode:pop": { java: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', kotlin: '6.5' },
  "methode:push": { python: '6.5', java: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', kotlin: '6.5' },
  "methode:size": { python: '6.5', c: '6.5', csharp: '6.5', javascript: '6.5', kotlin: '6.5', rust: '6.5' },
  "methode:startswith": { c: '6.5', cpp: '6.5', csharp: '6.5', rust: '6.5' },
  "methode:strip": { c: '6.5', cpp: '6.5', csharp: '6.5', javascript: '6.5', kotlin: '6.5', rust: '6.5' },
  "methode:substring": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', rust: '6.5' },
  "methode:tolowercase": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', kotlin: '6.5', rust: '6.5' },
  "methode:touppercase": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', kotlin: '6.5', rust: '6.5' },
  "methode:trim": { python: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5' },
  "methode:upper": { java: '6.5', c: '6.5', cpp: '6.5', csharp: '6.5', javascript: '6.5', kotlin: '6.5', rust: '6.5' },
};

/* ------------------------------------------------------------------ */
const ctxLines = ['type P = record{x: int}', 's := "abc"', 'a := {1, 2, 3}', 'p := P{x: 1}', 'x := 5'];
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bleibt der Aufruf unübersetzt im Code? Liefert die verdächtige Zeile oder null */
function rawCall(code, name, lang, isMethod) {
  const n = name.toLowerCase();
  if ((isMethod ? NATIVE_METHODS : NATIVE)[lang].some((x) => x.toLowerCase() === n)) return null;
  // Schreibweise aus dem Struktogramm (isArray) oder klein (isarray) – nicht Random( in C# für random(
  const alt = `(?:${reEsc(name)}|${reEsc(n)})`;
  const re = isMethod ? new RegExp(`\\.${alt}\\(`) : new RegExp(`(^|[^.\\w])${alt}\\(`);
  const lines = code.split('\n').filter((l) => !/^\s*(\/\/|#|\/\*|\*)/.test(l)); // Kommentare zählen nicht
  return lines.find((l) => re.test(l)) || null;
}

function check(key, call, isMethod) {
  const stmt = typeof call === 'object';
  const text = stmt ? call.stmt : `r := ${call}`;
  const name = isMethod ? /\.(\w+)\(/.exec(text)[1] : /(\w+)\(/.exec(text)[1];
  const doc = { roots: [mk.root('F', 'program', [mk.instruction(ctxLines.slice(0, 1)), mk.instruction([...ctxLines.slice(1), text, stmt ? 'OUTPUT x' : 'OUTPUT r'])])] };
  return LANGS.map((lang) => {
    let code;
    try { code = generateCode(doc, lang, { className: 'Program' }); } catch (e) { return { lang, bad: 'Ausnahme: ' + e.message }; }
    const line = rawCall(code, name, lang, isMethod);
    return { lang, bad: line ? line.trim() : null };
  });
}

const missing = [...FUNCS].filter((f) => !(f in CALLS));
const missingM = [...METHODS].filter((m) => !(m in METHOD_CALLS));
let fail = 0, known = 0, fixed = 0, ok = 0;
const rows = [];
const run = (key, calls, isMethod) => {
  const results = calls.map((c) => check(key, c, isMethod));
  LANGS.forEach((lang, li) => {
    const bad = results.map((r) => r[li].bad).find(Boolean) || null;
    const kk = isMethod ? 'methode:' + key : key;
    const step = KNOWN[kk] && (KNOWN[kk][lang] || KNOWN[kk]['*']);
    let st;
    if (bad) st = step ? 'K' : 'X'; else st = step ? 'B' : 'O';
    if (st === 'O') ok++; else if (st === 'K') known++; else if (st === 'B') fixed++; else fail++;
    if (st !== 'O') rows.push({ key: kk, lang, st, step, bad });
  });
};
for (const f of [...FUNCS].filter((f) => f in CALLS).sort()) run(f, [CALLS[f]], false);
for (const m of [...METHODS].filter((m) => m in METHOD_CALLS).sort()) run(m, METHOD_CALLS[m], true);

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c) => (s) => (color ? `\x1b[${c}m${s}\x1b[0m` : s);
const red = paint('31'), green = paint('32'), yellow = paint('33'), cyan = paint('36'), gray = paint('90');
console.log(`Bibliotheksfunktionen: ${FUNCS.size} Funktionen und ${METHODS.size} Methoden des Interpreters × ${LANGS.length} Sprachen`);
for (const st of ['X', 'B', 'K']) {
  const list = rows.filter((r) => r.st === st);
  if (!list.length || (st === 'K' && !verbose)) continue; // bekannte Lücken nur mit -v
  const head = { X: red('X nicht übersetzt (neu)'), B: cyan('B bekannte Lücke geschlossen – Eintrag in KNOWN entfernen'), K: yellow('K bekannte Lücke') }[st];
  console.log('\n' + head);
  const by = new Map();
  for (const r of list) by.set(r.key, [...(by.get(r.key) || []), r]);
  for (const [k, rs] of by) {
    console.log(`  ${k.padEnd(20)} ${rs.map((r) => r.lang + (st === 'K' ? gray(`(${r.step})`) : '')).join(' ')}`);
    if (verbose && st === 'X') for (const r of rs) console.log(gray(`      ${r.lang}: ${r.bad}`));
  }
}
if (missing.length) console.log(red(`\nFunktionen ohne Beispielaufruf in CALLS: ${missing.join(', ')}`));
if (missingM.length) console.log(red(`Methoden ohne Beispielaufruf in METHOD_CALLS: ${missingM.join(', ')}`));
const bad = fail + fixed + missing.length + missingM.length;
console.log(`\n${bad ? red(`${fail} nicht übersetzt, ${fixed} behoben (KNOWN bereinigen)`) : green('keine neuen Lücken')}` +
  `${known ? yellow(`, ${known} bekannte Lücken`) : ''}${gray(`, ${ok} in Ordnung`)}`);
process.exitCode = bad ? 1 : 0;
