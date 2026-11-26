// Läuft im Terminal „Struktograf: erzeugter Code“ des Test-VS-Code (gestartet von test/vscode/suite.js) und übersetzt
// und startet dort sichtbar jedes erzeugte Programm mit dem echten Compiler – keine Simulation: Compiler-Aufruf,
// Eingaben, Programmausgabe und der Vergleich mit dem Interpreter stehen im Terminal.
//
//   node terminal-run.js <auftragsordner>
//
// Die Testsuite legt Aufträge als job-<n>.json in den Ordner (run: Programm übersetzen und ausführen; note: Text
// anzeigen; end: Zusammenfassung). Das Ergebnis steht danach in result-<n>.json.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const S = require('../languages');
const { compileAll, runCmd } = require('../batch');

const [DIR] = process.argv.slice(2);
const C = { r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m' };
const W = fs.mkdtempSync(path.join(require('os').tmpdir(), 'struktograf-term-'));
const label = (l) => S.RUN[l] ? ({ python: 'Python', java: 'Java', c: 'C', cpp: 'C++', csharp: 'C#', javascript: 'JavaScript', kotlin: 'Kotlin', rust: 'Rust' })[l] : l;

/** Befehl sichtbar ausführen: Ausgabe live ins Terminal und mitschreiben */
function runVisible(cmd, args, { cwd, input, shell, timeout = 60000 }) {
  process.stdout.write(`${C.d}> ${[cmd, ...args].join(' ')}${C.r}\n`);
  return new Promise((resolve) => {
    const p = spawn(shell ? [cmd, ...args].join(' ') : cmd, shell ? [] : args, { cwd, env: S.env, shell: !!shell, windowsHide: true });
    let out = '', err = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { p.kill(); } catch (e) { /* schon beendet */ } }, timeout);
    p.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    p.stderr.on('data', (d) => { err += d; process.stdout.write(C.yellow + d + C.r); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ status: -1, stdout: out, stderr: String(e.message) }); });
    p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout: out, stderr: err, timedOut }); });
    p.stdin.on('error', () => {});
    p.stdin.end(input || '');
  });
}

/**
 * Übersetztes Programm mit jedem Testfall ausführen – Regeln wie im Aufgabentest: Ausgabe wie im Interpreter; bricht
 * der Interpreter mit einem Fehler ab, muss auch das Programm mit einem Fehler enden; sonst derselbe Exitcode.
 */
async function runCases(cmd, args, cwd, job) {
  const cases = job.cases || [{ inputs: job.inputs, expected: job.expected, refError: null, exitCode: 0 }];
  const bad = [];
  for (const [k, c] of cases.entries()) {
    process.stdout.write(`${C.cyan}Ausführen${cases.length > 1 ? ` (Fall ${k + 1})` : ''}${c.inputs.length ? ` mit Eingaben ${c.inputs.map((x) => `„${x}“`).join(', ')}` : ''}:${C.r}\n`);
    const r = await runVisible(cmd, args, { cwd, input: c.inputs.join('\n') + '\n', timeout: 60000 });
    let d = r.timedOut ? 'Zeitüberschreitung' : S.diff(c.expected, r.stdout);
    if (!d && c.refError && r.status === 0) d = `Interpreter bricht ab („${c.refError}“), das Programm nicht`;
    else if (!d && !c.refError && r.status !== c.exitCode) d = `Exitcode ${r.status}${c.exitCode ? ` statt ${c.exitCode}` : ''}`;
    if (c.refError && !d) process.stdout.write(`${C.d}(endet mit Fehler wie der Interpreter: ${c.refError})${C.r}\n`);
    if (d) bad.push(`${cases.length > 1 ? `Fall ${k + 1}: ` : ''}${d}`);
  }
  return bad.length ? { ok: false, msg: bad.join(' | ') } : { ok: true, msg: `Ausgabe wie im Interpreter${cases.length > 1 ? ` (${cases.length} Testfälle)` : ''}` };
}

/**
 * Java, Kotlin, C#: alle Programme einer Sprache mit EINEM Compiler-Aufruf übersetzen (test/batch.js) – der
 * Kotlin-Compiler bräuchte sonst je Programm ≈ 11 s nur zum Hochfahren. Jedes Programm bekommt dafür ein eigenes
 * package bzw. einen eigenen namespace, der Code bleibt sonst unverändert.
 */
const compiled = {}; // Sprache -> { dir, errors }
async function compileJob(job) {
  const dir = path.join(W, `batch_${job.lang}`);
  process.stdout.write(`\n${C.b}━━ ${label(job.lang)}: ${job.items.length} Programme gemeinsam übersetzen ━━${C.r}\n` +
    `${C.d}(${job.items.map((x) => x.title).join(', ')} – je Programm ein eigenes ${job.lang === 'csharp' ? 'namespace' : 'package'}, sonst unverändert)${C.r}\n`);
  const t0 = Date.now();
  const { errors } = await compileAll(job.lang, dir, job.items.map((x) => ({ id: x.id, code: x.code })));
  compiled[job.lang] = { dir, errors };
  process.stdout.write(`${C.cyan}übersetzt in ${((Date.now() - t0) / 1000).toFixed(1)} s${C.r}` +
    (errors.size ? ` – ${C.red}${errors.size} mit Übersetzungsfehler${C.r}` : '') + '\n');
  for (const [id, msg] of errors) process.stdout.write(`${C.red}  ${job.items.find((x) => x.id === id).title}: ${msg}${C.r}\n`);
  return { ok: !errors.size };
}

/** gemeinsam übersetztes Programm ausführen */
async function runCompiled(job) {
  const b = compiled[job.lang];
  if (!b) return { ok: false, msg: 'nicht übersetzt' };
  if (b.errors.has(job.id)) return { ok: false, msg: 'Übersetzen fehlgeschlagen: ' + b.errors.get(job.id) };
  const cwd = path.join(b.dir, 'run', String(job.id));
  fs.mkdirSync(cwd, { recursive: true });
  const [cmd, args] = runCmd(job.lang, b.dir, job.id);
  return runCases(cmd, args, cwd, job);
}

/** Programm übersetzen (wie der Nutzer es täte) und mit den Eingaben ausführen */
async function runJob(job) {
  if (job.batched) return runCompiled(job);
  const dir = path.join(W, `${job.n}_${job.lang}`);
  S.prepare(dir, job.lang);
  const R = S.RUN[job.lang];
  let build, run;
  if (job.lang === 'java') { // Dateiname = Klassenname
    const cls = (/public class (\w+)/.exec(job.code) || [])[1] || 'Program';
    fs.writeFileSync(path.join(dir, `${cls}.java`), job.code);
    build = ['javac', ['-encoding', 'UTF-8', '-d', 'jcls', `${cls}.java`]];
    run = ['java', ['-Dstdout.encoding=UTF-8', '-cp', 'jcls', cls]];
  } else {
    fs.writeFileSync(path.join(dir, R.file), job.code);
    build = R.build || null;
    run = R.run(dir);
  }
  if (build) {
    process.stdout.write(`${C.cyan}Übersetzen:${C.r}\n`);
    const b = await runVisible(build[0], build[1], { cwd: dir, shell: !!build[2], timeout: 300000 });
    if (b.status !== 0) return { ok: false, msg: 'Übersetzen fehlgeschlagen: ' + ((b.stdout || '') + (b.stderr || '')).split('\n').find((l) => /error|fehler/i.test(l)) };
  }
  return runCases(run[0], run[1], dir, job);
}

(async () => {
  process.stdout.write(`${C.b}Struktograf – erzeugter Code im echten Compiler${C.r}\n`);
  for (let n = 1; ; n++) {
    const f = path.join(DIR, `job-${n}.json`);
    while (!fs.existsSync(f)) await new Promise((r) => setTimeout(r, 100));
    const job = JSON.parse(fs.readFileSync(f, 'utf8'));
    let result = { ok: true };
    if (job.type === 'run') {
      process.stdout.write(`\n${C.b}━━ ${job.title} – ${label(job.lang)} ━━${C.r}\n`);
      try { result = await runJob(job); } catch (e) { result = { ok: false, msg: e.message }; }
      process.stdout.write(result.ok ? `${C.green}✓ ${result.msg}${C.r}\n` : `${C.red}✗ ${result.msg}${C.r}\n`);
    } else if (job.type === 'compile') {
      try { result = await compileJob(job); } catch (e) { result = { ok: false, msg: e.message }; }
    } else {
      process.stdout.write(`\n${job.text}\n`);
    }
    fs.writeFileSync(path.join(DIR, `result-${n}.json`), JSON.stringify(result));
    if (job.type === 'end') break;
  }
  fs.rmSync(W, { recursive: true, force: true });
})();
