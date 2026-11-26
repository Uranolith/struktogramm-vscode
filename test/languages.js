// Gemeinsame Werkzeuge für die Sprachtests: Compiler finden, Arbeitsordner vorbereiten, übersetzen und ausführen.
// Jede Sprache arbeitet in einem eigenen Ordner, damit mehrere Sprachen gleichzeitig laufen können.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Interpreter, Signal } = require('../src/core/executor');

const CLASS_NAME = 'Program';

/* PATH plus übliche Installationsorte unter Windows */
const extra = [];
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
if (process.platform === 'win32') {
  const adopt = 'C:/Program Files/Eclipse Adoptium';
  if (isDir(adopt)) for (const d of fs.readdirSync(adopt)) if (d.startsWith('jdk-')) extra.push(`${adopt}/${d}/bin`);
  for (const p of ['C:/msys64/ucrt64/bin', `${process.env.LOCALAPPDATA}/Programs/kotlinc/bin`]) if (isDir(p)) extra.push(p);
}
// Ausgabe als UTF-8 wie in einem UTF-8-Terminal (sonst schreiben Python und Java in eine Pipe Windows-1252)
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', PYTHONIOENCODING: 'utf-8' };
const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
env[pathKey] = [...extra, env[pathKey]].join(path.delimiter);

const X = process.platform === 'win32' ? '.exe' : '';
const has = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { env }).status === 0;

/**
 * C/C++: Warnungen, die auf falsch erzeugten Code hinweisen, als Fehler – z. B. sizeof auf einem Array-Parameter (misst den
 * Zeiger), printf-Format passt nicht zum Typ, Zeiger aus Ganzzahl, Funktion ohne Deklaration, Lesen über ein Textende hinaus
 */
const STRICT_CFAMILY = ['-Werror=sizeof-array-argument', '-Werror=format', '-Werror=stringop-overread', '-Werror=return-type',
  '-Werror=sizeof-pointer-div'];
const STRICT_C = [...STRICT_CFAMILY, '-Werror=int-conversion', '-Werror=implicit-function-declaration', '-Werror=incompatible-pointer-types'];

/** Je Sprache: Werkzeug, Quelldatei, Übersetzen (optional, [befehl, argumente, shell]) und Ausführen – relativ zum Ordner */
const RUN = {
  python: { tool: 'python', file: 'prog.py', run: (d) => ['python', ['prog.py']] },
  javascript: { tool: 'node', file: 'prog.js', run: (d) => ['node', ['prog.js']] },
  c: { tool: 'gcc', file: 'prog.c', build: ['gcc', [...STRICT_C, '-fopenmp', '-o', 'prog_c' + X, 'prog.c', '-lm']], run: (d) => [path.join(d, 'prog_c' + X), []] },
  cpp: { tool: 'g++', file: 'prog.cpp', build: ['g++', [...STRICT_CFAMILY, '-pthread', '-o', 'prog_cpp' + X, 'prog.cpp']], run: (d) => [path.join(d, 'prog_cpp' + X), []] },
  csharp: { tool: 'dotnet', file: 'cs/Program.cs', build: ['dotnet', ['build', 'cs', '-nologo', '-v', 'q', '-o', 'cs/out']], run: (d) => ['dotnet', ['cs/out/cs.dll']] },
  java: { tool: 'javac', file: `${CLASS_NAME}.java`, build: ['javac', ['-encoding', 'UTF-8', '-d', 'jcls', `${CLASS_NAME}.java`]], run: (d) => ['java', ['-Dstdout.encoding=UTF-8', '-cp', 'jcls', CLASS_NAME]] },
  kotlin: { tool: 'kotlinc', file: 'prog.kt', build: ['kotlinc', ['prog.kt', '-include-runtime', '-nowarn', '-d', 'prog_kt.jar'], true], run: (d) => ['java', ['-Dstdout.encoding=UTF-8', '-jar', 'prog_kt.jar']] },
  rust: { tool: 'rustc', file: 'prog.rs', build: ['rustc', ['-o', 'prog_rs' + X, 'prog.rs']], run: (d) => [path.join(d, 'prog_rs' + X), []] },
};

/** Ordner für eine Sprache anlegen (C#: Projektdatei; JavaScript: pipe-fester Ersatz für prompt-sync) */
function prepare(dir, lang) {
  fs.mkdirSync(dir, { recursive: true });
  if (lang === 'csharp') {
    fs.mkdirSync(path.join(dir, 'cs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'cs/cs.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><RollForward>Major</RollForward><Nullable>disable</Nullable><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>');
  }
  if (lang === 'javascript') {
    fs.mkdirSync(path.join(dir, 'node_modules/prompt-sync'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/prompt-sync/index.js'), `const fs = require('fs');
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
  }
}

/** Obergrenze für gesammelte Ausgabe: Eine Endlosschleife mit Ausgabe füllt sonst den Speicher (Invalid string length) */
const MAX_OUTPUT = 4 * 1024 * 1024;

/** Prozess asynchron starten; liefert { status, stdout, stderr, error, timedOut, overflow } */
function exec(cmd, args, { cwd, input, shell = false, timeout = 300000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', done = false, timedOut = false, overflow = false;
    const p = spawn(shell ? [cmd, ...args].join(' ') : cmd, shell ? [] : args, { cwd, env, shell, windowsHide: true });
    const kill = () => { try { p.kill(); } catch (e) { /* bereits beendet */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ stdout, stderr, timedOut, overflow, ...r }); };
    const collect = (d, which) => {
      if (overflow) return;
      if (which === 'out') stdout += d; else stderr += d;
      if (stdout.length + stderr.length > MAX_OUTPUT) { overflow = true; kill(); }
    };
    p.stdout.on('data', (d) => collect(d, 'out'));
    p.stderr.on('data', (d) => collect(d, 'err'));
    p.on('error', (error) => finish({ status: -1, error }));
    p.on('close', (status) => finish({ status }));
    p.stdin.on('error', () => { /* Programm hat stdin nicht gelesen */ });
    p.stdin.end(input || '');
  });
}

/** Übersetzen; liefert null bei Erfolg, sonst eine kurze Fehlermeldung */
async function build(lang, dir) {
  const R = RUN[lang];
  if (!R.build) return null;
  const b = await exec(R.build[0], R.build[1], { cwd: dir, shell: !!R.build[2] });
  if (b.status === 0) return null;
  const all = (b.stdout || '') + (b.stderr || '');
  return all.split('\n').filter((l) => /error|fehler/i.test(l)).slice(0, 6).join('\n').trim() || all.trim().slice(-800) || 'Übersetzen fehlgeschlagen';
}

/** Ausführen mit Eingabezeilen */
function run(lang, dir, lines, timeout = 30000) {
  const [cmd, args] = RUN[lang].run(dir);
  return exec(cmd, args, { cwd: dir, input: lines.map(String).join('\n') + '\n', timeout });
}

const norm = (s) => String(s || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();

/**
 * Referenz: eingebauter Interpreter. Gehen die Eingaben aus, wird die letzte wiederholt (wie bisher);
 * zurückgegeben werden auch die tatsächlich gelesenen Eingaben, damit das echte Programm genau diese bekommt.
 */
function interpret(doc, inputs, maxSteps = 2e6) {
  // eigener, leerer Ordner für die Dateifunktionen (fileCreate …) – wie der Arbeitsordner des erzeugten Programms
  const baseDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nsd-ref-'));
  try { return interpretIn(doc, inputs, maxSteps, baseDir); } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
}

function interpretIn(doc, inputs, maxSteps, baseDir) {
  const mainIdx = Math.max(0, doc.roots.findIndex((r) => r.rootType === 'program'));
  const g = new Interpreter(doc, { baseDir }).run(mainIdx);
  const out = [], used = [];
  const queue = inputs.map(String);
  let last = queue.length ? queue[queue.length - 1] : '0';
  let steps = 0;
  try {
    let r = g.next();
    while (!r.done) {
      if (++steps > maxSteps) return { output: out.join('\n'), used, error: 'Abbruch: zu viele Schritte (Endlosschleife?)' };
      const y = r.value;
      if (y.type === 'output') out.push(y.text);
      let v;
      if (y.type === 'input') { v = queue.length ? queue.shift() : last; last = v; used.push(v); }
      r = g.next(v);
    }
  } catch (e) {
    // exit im Struktogramm beendet das Programm regulär (wie in der Erweiterung, execSession.js)
    if (e instanceof Signal && e.kind === 'exit') return { output: out.join('\n'), used, error: null, exitCode: Number(e.value) || 0 };
    return { output: out.join('\n'), used, error: e.message || String(e) };
  }
  return { output: out.join('\n'), used, error: null, exitCode: 0 };
}

/** Erwartete und erhaltene Ausgabe vergleichen; liefert null oder eine Beschreibung der ersten Abweichung */
function diff(expected, got) {
  const a = norm(expected), b = norm(got);
  if (a === b) return null;
  const A = a.split('\n'), B = b.split('\n');
  const k = A.findIndex((l, i) => l !== B[i]);
  const i = k < 0 ? A.length : k;
  return `Zeile ${i + 1}: erwartet ${JSON.stringify(A[i] ?? '')}, erhalten ${JSON.stringify(B[i] ?? '')}`;
}

module.exports = { RUN, CLASS_NAME, env, has, prepare, exec, build, run, interpret, diff, norm };
