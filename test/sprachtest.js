// Sprachtest: ein Struktogramm mit dem eingebauten Interpreter ausführen (Referenz), mit dem eigenen
// Generator in alle Zielsprachen übersetzen, kompilieren, ausführen und die Ausgaben vergleichen.
//
//   node test/sprachtest.js [datei.nsd] [--input 7] [python java ...]
//   mehrere Eingaben (je INPUT eine Zeile): --input 1500,1000
//
// Standard: test/samples/gesamttest.nsd (alle Elementtypen, Rekursion, Parallelverarbeitung) mit Eingabe 7.
// Sprachen ohne installierten Compiler werden übersprungen. Gearbeitet wird in einem temporären Ordner.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fromNsd } = require('../src/core/nsdxml');
const { generateCode, TARGETS } = require('../src/core/generators');
const { Interpreter } = require('../src/core/executor');

const args = process.argv.slice(2);
let file = path.join(__dirname, 'samples', 'gesamttest.nsd');
let input = '7';
const only = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input') input = args[++i];
  else if (/\.nsd$/i.test(args[i])) file = path.resolve(args[i]);
  else only.push(args[i]);
}
const doc = fromNsd(fs.readFileSync(file, 'utf8'));
const mainIdx = Math.max(0, doc.roots.findIndex((r) => r.rootType === 'program'));
const className = 'Programm';

/* Referenz: eingebauter Interpreter */
function interpret() {
  const g = new Interpreter(doc).run(mainIdx);
  const out = [];
  const queue = input.split(',');
  let r = g.next();
  while (!r.done) {
    const y = r.value;
    if (y.type === 'output') out.push(y.text);
    r = g.next(y.type === 'input' ? (queue.length > 1 ? queue.shift() : queue[0]) : undefined);
  }
  return out.join('\n');
}

/* Werkzeuge: PATH plus übliche Installationsorte unter Windows */
const extra = [];
const exists = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
if (process.platform === 'win32') {
  const adopt = 'C:/Program Files/Eclipse Adoptium';
  if (exists(adopt)) for (const d of fs.readdirSync(adopt)) if (d.startsWith('jdk-')) extra.push(`${adopt}/${d}/bin`);
  for (const p of ['C:/msys64/ucrt64/bin', `${process.env.LOCALAPPDATA}/Programs/kotlinc/bin`, 'C:/FPC/3.2.2/bin/i386-win32']) if (exists(p)) extra.push(p);
}
const env = { ...process.env };
const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
env[pathKey] = [...extra, env[pathKey]].join(path.delimiter);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'sprachtest-'));
const sh = (cmd, a, opts = {}) => spawnSync(opts.shell ? [cmd, ...a].join(' ') : cmd, opts.shell ? [] : a,
  { cwd: WORK, env, encoding: 'utf8', timeout: 300000, shell: !!opts.shell, input: opts.input });
const has = (cmd) => { const r = sh(process.platform === 'win32' ? 'where' : 'which', [cmd]); return r.status === 0; };
const X = process.platform === 'win32' ? '.exe' : '';
const exe = (n) => path.join(WORK, n + X);

const RUN = {
  python: { tool: 'python', file: 'prog.py', run: ['python', ['prog.py']] },
  javascript: { tool: 'node', file: 'prog.js', run: ['node', ['prog.js']] },
  c: { tool: 'gcc', file: 'prog.c', build: ['gcc', ['-fopenmp', '-o', 'prog_c' + X, 'prog.c', '-lm']], run: [exe('prog_c'), []] },
  cpp: { tool: 'g++', file: 'prog.cpp', build: ['g++', ['-pthread', '-o', 'prog_cpp' + X, 'prog.cpp']], run: [exe('prog_cpp'), []] },
  csharp: { tool: 'dotnet', file: 'cs/Program.cs', build: ['dotnet', ['build', 'cs', '-nologo', '-v', 'q', '-o', 'cs/out']], run: ['dotnet', ['cs/out/cs.dll']] },
  java: { tool: 'javac', file: `${className}.java`, build: ['javac', ['-encoding', 'UTF-8', '-d', 'jcls', `${className}.java`]], run: ['java', ['-cp', 'jcls', className]] },
  kotlin: { tool: 'kotlinc', file: 'prog.kt', build: ['kotlinc', ['prog.kt', '-include-runtime', '-nowarn', '-d', 'prog_kt.jar'], true], run: ['java', ['-jar', 'prog_kt.jar']] },
  rust: { tool: 'rustc', file: 'prog.rs', build: ['rustc', ['-o', 'prog_rs' + X, 'prog.rs']], run: [exe('prog_rs'), []] },
  pascal: { tool: 'fpc', file: 'prog.pas', build: ['fpc', [...(process.platform === 'win32' ? ['-Px86_64'] : []), '-oprog_pas' + X, 'prog.pas']], run: [exe('prog_pas'), []] },
};

// C#: Projektdatei; JavaScript: prompt-sync braucht ein Terminal – hier ein pipe-fester Ersatz mit gleicher Schnittstelle
fs.mkdirSync(path.join(WORK, 'cs'));
fs.writeFileSync(path.join(WORK, 'cs/cs.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><RollForward>Major</RollForward><Nullable>disable</Nullable><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>');
fs.mkdirSync(path.join(WORK, 'node_modules/prompt-sync'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'node_modules/prompt-sync/index.js'), `const fs = require('fs');
module.exports = () => (msg) => {
  if (msg) process.stdout.write(String(msg));
  const b = Buffer.alloc(1); let s = '';
  for (;;) {
    let n = 0;
    try { n = fs.readSync(0, b, 0, 1); } catch (e) { if (e.code === 'EAGAIN') continue; if (e.code === 'EOF') break; throw e; }
    if (!n || b[0] === 10) break;
    if (b[0] !== 13) s += b.toString('latin1');
  }
  return s;
};
`);

const norm = (s) => String(s || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();
const expected = norm(interpret());
let failed = 0;
for (const lang of Object.keys(TARGETS)) {
  if (only.length && !only.includes(lang)) continue;
  const R = RUN[lang];
  const label = TARGETS[lang].label.padEnd(22);
  if (!has(R.tool)) { console.log(`${label} übersprungen (${R.tool} nicht gefunden)`); continue; }
  fs.writeFileSync(path.join(WORK, R.file), generateCode(doc, lang, { className }));
  let status = 'ok', detail = '';
  if (R.build) {
    const b = sh(R.build[0], R.build[1], { shell: R.build[2] });
    if (b.status !== 0) {
      status = 'FEHLER beim Übersetzen';
      const all = (b.stdout || '') + (b.stderr || '');
      detail = all.split('\n').filter((l) => /error/i.test(l)).slice(0, 8).join('\n') || all.slice(-1200);
    }
  }
  if (status === 'ok') {
    const r = sh(R.run[0], R.run[1], { input: input.split(',').join('\n') + '\n' });
    const got = norm(r.stdout);
    if (r.error) { status = 'FEHLER beim Starten'; detail = r.error.message; } else if (got !== expected) {
      status = 'FEHLER: Ausgabe weicht ab';
      const a = expected.split('\n'), g = got.split('\n');
      const k = a.findIndex((l, i) => l !== g[i]);
      detail = `Zeile ${k + 1}: erwartet ${JSON.stringify(a[k])}, erhalten ${JSON.stringify(g[k])}` + (r.stderr ? '\n' + r.stderr.slice(-600) : '');
    }
  }
  if (status !== 'ok') failed++;
  console.log(`${label} ${status}${detail ? '\n    ' + detail.replace(/\n/g, '\n    ') : ''}`);
}
console.log(`\nReferenz (Interpreter, Eingabe ${input}):\n${expected}\n\nArbeitsordner: ${WORK}`);
process.exitCode = failed ? 1 : 0;
