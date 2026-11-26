// Läuft IN einem echten VS Code (gestartet von test/vscode/run.js) mit der Entwicklungsversion der Erweiterung.
// Prüft, was man sonst von Hand ausprobiert – über die echten Befehle der Erweiterung:
//   1. Ausführen (Befehl „Ausführen ohne Debuggen“) mit Eingaben, Ausgabe wie der Interpreter; Dateien der
//      Dateifunktionen landen neben der .nsd
//   2. Code erzeugen (Befehl „Struktogramm → Code“) für alle acht Sprachen; genau dieser Code wird im Terminal
//      „Struktograf: erzeugter Code“ sichtbar mit dem echten Compiler übersetzt, ausgeführt und mit dem Interpreter
//      verglichen (test/vscode/terminal-run.js) – keine Simulation
//   3. Meldungen beim Erzeugen (fileRead als Text, nicht übersetzbare Befehle)
//   4. Live-Code: eine Änderung am Struktogramm erscheint im erzeugten (ungespeicherten) Code
// Mit STRUKTOGRAF_TEST_SCHRITT=1 (npm run test:vscode -- --schritt) wartet das Terminal nach jedem Schritt auf Enter.
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const S = require(path.join(ROOT, 'test', 'languages'));
const { fromNsd, toNsd } = require(path.join(ROOT, 'src', 'core', 'nsdxml'));
const { mk } = require(path.join(ROOT, 'src', 'core', 'model'));
const { generateCode, TARGETS, toClassName } = require(path.join(ROOT, 'src', 'core', 'generators'));
const { lintDoc } = require(path.join(ROOT, 'src', 'core', 'lint'));
const { BATCH_LANGS } = require(path.join(ROOT, 'test', 'batch'));

const WS = process.env.STRUKTOGRAF_TEST_WS;
const STEP = process.env.STRUKTOGRAF_TEST_SCHRITT === '1';
/** Eingaben je Beispiel (eine je INPUT) */
const INPUTS = {
  '01_dateien.nsd': ['5'],
  '02_fileread.nsd': [],
  '03_fehlertexte.nsd': ['abc', '1,5'],
  '04_unendlich.nsd': [],
  '05_texte.nsd': ['Öl'],
  '06_eingabe.nsd': ['Jörg Ä', '30', '2.5'],
};

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, what = 'Bedingung') {
  const end = ms ? Date.now() + ms : Infinity;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Zeitüberschreitung: ${what}`);
    await sleep(50);
  }
}
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`Zeitüberschreitung: ${what}`)), ms))]);
}
async function test(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, note });
    console.log(`  O ${name}${note ? ' – ' + note : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push({ name, ok: false, note: e.message });
    console.log(`  X ${name}: ${String(e.message).split('\n').slice(0, 8).join('\n      ')}`);
  }
}

/* ---------------- Terminal „Struktograf: erzeugter Code“ (terminal-run.js) ---------------- */
const JOBS = path.join(WS, '.terminal');
let jobNo = 0;
function startTerminal() {
  fs.mkdirSync(JOBS, { recursive: true });
  // Node aus dem PATH (das Programm von VS Code selbst ist Electron)
  const node = execSync(process.platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
  const term = vscode.window.createTerminal({ name: 'Struktograf: erzeugter Code', shellPath: node,
    shellArgs: [path.join(__dirname, 'terminal-run.js'), JOBS, ...(STEP ? ['--schritt'] : [])] });
  term.show(false);
  return term;
}
/** Auftrag ans Terminal; liefert dessen Ergebnis (und wartet im Schritt-Modus auf Enter) */
async function terminalJob(job, timeoutMs = 600000) {
  const n = ++jobNo;
  const f = path.join(JOBS, `job-${n}.json`);
  fs.writeFileSync(f + '.tmp', JSON.stringify({ n, ...job }));
  fs.renameSync(f + '.tmp', f);
  const resFile = path.join(JOBS, `result-${n}.json`);
  await waitFor(() => fs.existsSync(resFile), STEP ? 0 : timeoutMs, 'Ergebnis im Terminal');
  await waitFor(() => fs.existsSync(path.join(JOBS, `ack-${n}`)), STEP ? 0 : 10000, 'Terminal');
  return JSON.parse(fs.readFileSync(resFile, 'utf8'));
}

/* ---------------- Erweiterung ansteuern ---------------- */
let provider;
const uriOf = (f) => vscode.Uri.file(path.join(WS, f));

/** Struktogramm im Struktograf-Editor öffnen und den Editor-Zustand der Erweiterung liefern */
async function openEditor(file) {
  const uri = uriOf(file);
  await vscode.commands.executeCommand('vscode.openWith', uri, 'struktogramm.editor');
  return waitFor(() => [...provider.editors].find((s) => s.document.uri.fsPath === uri.fsPath), 15000, 'Struktograf-Editor');
}

/** Ausführen über den echten Befehl; Eingaben wie über das Eingabefeld. Liefert Ausgabezeilen und Endzustand. */
async function runInVsCode(file, inputs) {
  const st = await openEditor(file);
  const out = [], trace = [];
  const queue = inputs.slice();
  let finish;
  const done = new Promise((r) => { finish = r; });
  const listener = (state, m) => {
    if (state !== st) return;
    if (m.type === 'execOut') for (const l of m.lines) if (l.kind === 'out') out.push(l.text);
    if (m.type === 'execState') trace.push(m.state);
    // Eingabe erst schicken, wenn die Ausführung wirklich darauf wartet (wie ein Mensch, der danach tippt)
    if (m.type === 'execState' && m.state === 'input') {
      const value = queue.length ? queue.shift() : '';
      waitFor(() => st.exec.session && st.exec.session.state === 'input', 5000, 'Eingabebereitschaft')
        .then(() => { trace.push(`Eingabe „${value}“`); st.exec.handle({ type: 'execInput', value }); })
        .catch((e) => trace.push(e.message));
    }
    if (m.type === 'execState' && m.state === 'done') finish(m);
  };
  provider.execListeners.add(listener);
  try {
    await vscode.commands.executeCommand('struktogramm.runNoDebug', uriOf(file));
    const end = await withTimeout(done, 60000, 'Ende der Ausführung').catch((e) => { throw new Error(`${e.message} – Ablauf: ${trace.join(' → ')}`); });
    return { out, end };
  } finally {
    provider.execListeners.delete(listener);
  }
}

const errorsShown = [];
/**
 * Code erzeugen über den echten Befehl (Zielsprache über die Einstellung, ohne Auswahldialog). Liefert das neue
 * Dokument – oder { blocked: Meldung }, wenn die Erweiterung wegen eines Fehlers im Struktogramm keinen Code erzeugt.
 */
async function toCodeInVsCode(file, lang) {
  await vscode.workspace.getConfiguration('struktogramm').update('defaultTargetLanguage', lang, vscode.ConfigurationTarget.Global);
  const before = new Set(vscode.workspace.textDocuments.filter((d) => d.isUntitled));
  const errBefore = errorsShown.length;
  await vscode.commands.executeCommand('struktogramm.toCode', uriOf(file));
  return waitFor(() => vscode.workspace.textDocuments.find((d) => d.isUntitled && !before.has(d)) ||
    (errorsShown.length > errBefore && { blocked: errorsShown[errorsShown.length - 1] }), 15000, 'erzeugtes Dokument oder Fehlermeldung');
}

/** erzeugtes (ungespeichertes) Dokument ohne Rückfrage schließen */
async function closeDoc(doc) {
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}

exports.run = async () => {
  const ext = vscode.extensions.all.find((e) => path.resolve(e.extensionPath) === ROOT);
  if (!ext) throw new Error('Erweiterung nicht geladen');
  const api = await ext.activate();
  provider = api && api._test && api._test.provider;
  if (!provider) throw new Error('Testzugang der Erweiterung fehlt (activate im Testmodus)');
  console.log(`\nStruktograf im echten VS Code ${vscode.version} – Arbeitsordner ${WS}${STEP ? ' – Schritt für Schritt (Enter im Terminal)' : ''}`);
  const term = startTerminal();

  // Meldungen der Erweiterung mitschneiden (gleiche vscode-API wie die Erweiterung)
  const warnings = [];
  const origWarn = vscode.window.showWarningMessage, origErr = vscode.window.showErrorMessage;
  vscode.window.showWarningMessage = (msg) => { warnings.push(String(msg)); return Promise.resolve(undefined); };
  vscode.window.showErrorMessage = (msg) => { errorsShown.push(String(msg)); return Promise.resolve(undefined); };

  console.log('\n1. Ausführen (Befehl „Ausführen ohne Debuggen“)');
  for (const [file, inputs] of Object.entries(INPUTS)) {
    await test(`${file} ausführen${inputs.length ? ` (Eingaben ${inputs.join(', ')})` : ''}`, async () => {
      const ref = S.interpret(fromNsd(fs.readFileSync(path.join(WS, file), 'utf8')), inputs);
      const { out, end } = await runInVsCode(file, inputs);
      const d = end.error && !ref.error ? 'Fehler beim Ausführen: ' + end.error : S.diff(ref.output, out.join('\n'));
      // im Terminal zeigen, was der Interpreter in VS Code ausgegeben hat (Schritt-Modus: Enter abwarten)
      await terminalJob({ type: 'note', text: `\x1b[1m━━ ${file} im Interpreter (Befehl „Ausführen“)${inputs.length ? `, Eingaben ${inputs.map((x) => `„${x}“`).join(', ')}` : ''} ━━\x1b[0m\n` +
        out.join('\n') + `\n${d ? `\x1b[31m✗ ${d}\x1b[0m` : '\x1b[32m✓ wie der Interpreter im Test\x1b[0m'}` });
      if (d) throw new Error(d);
      return `${out.length} Zeilen wie im Interpreter`;
    });
  }
  await test('Dateien der Dateifunktionen liegen neben der .nsd', async () => {
    for (const f of ['daten.txt', 't.txt']) if (!fs.existsSync(path.join(WS, f))) throw new Error(`${f} fehlt in ${WS}`);
    const first = fs.readFileSync(path.join(WS, 'daten.txt'), 'utf8').split('\n')[0];
    if (first !== 'Hallo Welt') throw new Error(`daten.txt beginnt mit „${first}“`);
    return 'daten.txt, t.txt';
  });

  console.log('\n2. Code erzeugen (Befehl „Struktogramm → Code“), im Terminal übersetzen und ausführen');
  for (const lang of Object.keys(TARGETS)) {
    await test(`${TARGETS[lang].label}: 6 Struktogramme`, async () => {
      const bad = [], blockedFiles = [];
      // Java, Kotlin, C#: erst den Code aller Struktogramme erzeugen, im Terminal gemeinsam übersetzen (ein
      // Compiler-Aufruf statt sechs – Kotlin bräuchte sonst je Programm ≈ 11 s zum Hochfahren), dann einzeln ausführen
      const batch = BATCH_LANGS.includes(lang) ? [] : null;
      for (const [file, inputs] of Object.entries(INPUTS)) {
        const model = fromNsd(fs.readFileSync(path.join(WS, file), 'utf8'));
        const lintErrors = lintDoc(model).filter((x) => x.severity === 'error');
        const doc = await toCodeInVsCode(file, lang);
        // Fehler im Struktogramm (Prüfung im Editor): die Erweiterung darf keinen Code erzeugen, sondern meldet ihn
        if (lintErrors.length || doc.blocked) {
          if (!doc.blocked) { bad.push(`${file}: Code erzeugt trotz Fehler „${lintErrors[0].message}“`); await closeDoc(doc); }
          else if (!lintErrors.length) bad.push(`${file}: gesperrt ohne Fehler im Struktogramm: ${doc.blocked}`);
          else blockedFiles.push(file);
          continue;
        }
        const code = doc.getText().replace(/\r\n/g, '\n');
        const expected = generateCode(model, lang, { className: toClassName(file.replace(/\.nsd$/, '')) });
        if (code !== expected.replace(/\r\n/g, '\n')) { bad.push(`${file}: Code im Editor weicht vom Generator ab`); await closeDoc(doc); continue; }
        const job = { type: 'run', title: file, lang, code, inputs, expected: S.interpret(model, inputs).output };
        if (batch) { batch.push({ id: batch.length + 1, doc, job }); continue; }
        // genau dieser Code im Terminal: übersetzen, ausführen, mit dem Interpreter vergleichen (Code bleibt dabei offen)
        term.show(true);
        const r = await terminalJob(job);
        await closeDoc(doc);
        if (!r.ok) bad.push(`${file}: ${r.msg}`);
      }
      if (batch && batch.length) {
        term.show(true);
        await terminalJob({ type: 'compile', lang, items: batch.map((b) => ({ id: b.id, title: b.job.title, code: b.job.code })) });
        for (const b of batch) {
          await vscode.window.showTextDocument(b.doc, { preview: false }); // Code dieses Programms zeigen
          term.show(true);
          const r = await terminalJob({ ...b.job, batched: true, id: b.id });
          await closeDoc(b.doc);
          if (!r.ok) bad.push(`${b.job.title}: ${r.msg}`);
        }
      }
      if (bad.length) throw new Error(bad.join('\n'));
      return 'im Terminal übersetzt und ausgeführt wie im Interpreter' + (blockedFiles.length ? `; gesperrt wegen Fehler im Struktogramm: ${blockedFiles.join(', ')}` : '');
    });
  }

  console.log('\n3. Meldungen beim Erzeugen');
  await test('nicht übersetzbare Befehle: Meldung (Java)', async () => {
    warnings.length = 0;
    const doc = await toCodeInVsCode('07_nicht_uebersetzbar.nsd', 'java');
    const code = doc.getText();
    await closeDoc(doc);
    if (!/push|forward/.test(warnings.join(' '))) throw new Error('Meldung nennt die Befehle nicht: ' + warnings.join(' | '));
    if (!/push/.test(code)) throw new Error('Kommentar im Code fehlt');
    return warnings[0].slice(0, 90);
  });
  await test('fileRead mitten in einem Ausdruck: Meldung (Java)', async () => {
    fs.writeFileSync(path.join(WS, '08_fileread_ausdruck.nsd'), toNsd({ roots: [mk.root('FrAusdruck', 'program', [
      mk.instruction(['g := fileOpen("x.txt")', 'OUTPUT fileRead(g)'])])] }));
    warnings.length = 0;
    const doc = await toCodeInVsCode('08_fileread_ausdruck.nsd', 'java');
    await closeDoc(doc);
    if (!warnings.some((w) => /fileRead/.test(w))) throw new Error('keine fileRead-Meldung: ' + warnings.join(' | '));
    return warnings.find((w) => /fileRead/.test(w)).slice(0, 90);
  });

  console.log('\n4. Live-Code');
  await test('Änderung am Struktogramm erscheint im erzeugten Python-Code', async () => {
    const doc = await toCodeInVsCode('01_dateien.nsd', 'python');
    if (!/Hallo Welt/.test(doc.getText())) throw new Error('Ausgangstext fehlt im Code');
    const nsd = await vscode.workspace.openTextDocument(uriOf('01_dateien.nsd'));
    const at = nsd.getText().indexOf('Hallo Welt');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(nsd.uri, new vscode.Range(nsd.positionAt(at), nsd.positionAt(at + 'Hallo Welt'.length)), 'Hallo Live');
    await vscode.workspace.applyEdit(edit);
    try {
      await waitFor(() => /Hallo Live/.test(doc.getText()), 8000, 'Aktualisierung des Codes');
    } finally {
      const back = new vscode.WorkspaceEdit();
      const a2 = nsd.getText().indexOf('Hallo Live');
      if (a2 >= 0) { back.replace(nsd.uri, new vscode.Range(nsd.positionAt(a2), nsd.positionAt(a2 + 'Hallo Live'.length)), 'Hallo Welt'); await vscode.workspace.applyEdit(back); }
      await nsd.save();
      await closeDoc(doc);
    }
    return 'Code aktualisiert';
  });

  vscode.window.showWarningMessage = origWarn;
  vscode.window.showErrorMessage = origErr;
  await vscode.workspace.getConfiguration('struktogramm').update('defaultTargetLanguage', undefined, vscode.ConfigurationTarget.Global);
  const failed = results.filter((r) => !r.ok);
  const summary = failed.length ? `${failed.length} von ${results.length} Tests nicht erfolgreich` : `alle ${results.length} Tests erfolgreich`;
  console.log(`\n${summary}`);
  term.show(true);
  await terminalJob({ type: 'end', text: `\n${failed.length ? '\x1b[31m' : '\x1b[32m'}\x1b[1m■ ${summary}\x1b[0m` +
    failed.map((f) => `\n  ✗ ${f.name}: ${String(f.note).split('\n')[0]}`).join('') });
  if (failed.length) throw new Error(summary);
};
