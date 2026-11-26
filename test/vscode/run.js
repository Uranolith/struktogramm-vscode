// Test in einem echten VS Code (Plan: „Ausprobieren“ automatisch): startet VS Code mit der Entwicklungsversion der
// Erweiterung (@vscode/test-electron), öffnet einen Arbeitsordner mit Beispiel-Struktogrammen und führt dort
// test/vscode/suite.js aus – Ausführen über den echten Befehl, Code erzeugen, Meldungen, Live-Code.
//
//   npm run test:vscode                       ausgewählte Beispiele, läuft durch (so auch in der CI)
//   npm run test:vscode -- --alle             zusätzlich ALLE Struktogramme aus test/samples (alle Ordner, alle
//                                             Testfälle aus inputs.json) – dauert entsprechend länger
//   npm run test:vscode -- --log datei.txt   Ergebniszeilen zusätzlich in eine Datei (UTF-8)
//   npm run test:vscode -- --hier            im aktuellen Terminal statt in einem eigenen PowerShell-Fenster
//                                             (das eigene Fenster gibt es nur unter Windows bei Start von Hand)
//   (lädt beim ersten Mal ein Test-VS-Code nach .vscode-test/)
//
// Von Hand gestartet (Terminal, nicht CI) bleibt das Test-VS-Code nach dem letzten Test offen, bis man es schließt –
// so lassen sich das Terminal „Struktograf: erzeugter Code“ und die Ergebnisse in Ruhe ansehen. Das Ergebnis liest
// run.js danach aus ergebnis.json im Arbeitsordner.
//
// Der Arbeitsordner liegt im Temp-Verzeichnis; seine Dateien (z. B. von fileCreate) bleiben nach einem Fehlschlag
// zum Nachsehen liegen, nach einem Erfolg wird er gelöscht.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const ROOT = path.resolve(__dirname, '..', '..');
const SAMPLES = path.join(ROOT, 'test', 'samples');
const ALL = process.argv.includes('--alle');
// --log datei: Ergebniszeilen zusätzlich als UTF-8 in diese Datei
const LOG = process.argv.includes('--log') ? path.resolve(process.argv[process.argv.indexOf('--log') + 1]) : '';

/** ausgewählte Beispiele im Arbeitsordner: Zieldatei <- Quelle in test/samples, mit ihren Eingaben */
const FIXTURES = {
  '01_dateien.nsd': ['files/01_write_read.nsd', [['5']]],
  '02_fileread.nsd': ['files/03_fileread_typed.nsd', [[]]],
  '03_fehlertexte.nsd': ['try_catch/11_error_texts.nsd', [['abc', '1,5']]],
  '04_unendlich.nsd': ['expressions/16_float_div_zero.nsd', [[]]],
  '05_texte.nsd': ['expressions/15_text_edges.nsd', [['Öl']]],
  '06_eingabe.nsd': ['types/03_input_mixed.nsd', [['Jörg Ä', '30', '2.5']]],
};
// für die Meldungen beim Erzeugen (nicht ausgeführt)
const EXTRA = { '07_nicht_uebersetzbar.nsd': 'checks/untranslatable.nsd' };

/** --alle: jeder Ordner von test/samples (ohne erzeugten Code und Kopien) mit seinen Testfällen */
function allSamples(ws) {
  const list = [];
  for (const dir of fs.readdirSync(SAMPLES, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('.') || ['codefiles', 'ausprobieren'].includes(dir.name)) continue;
    const src = path.join(SAMPLES, dir.name);
    const dst = path.join(ws, 'samples', dir.name);
    fs.mkdirSync(dst, { recursive: true });
    let inputs = {};
    try { inputs = JSON.parse(fs.readFileSync(path.join(src, 'inputs.json'), 'utf8')); } catch (e) { /* keine Testfälle */ }
    for (const f of fs.readdirSync(src).sort()) {
      const p = path.join(src, f);
      if (!fs.statSync(p).isFile()) continue;
      fs.copyFileSync(p, path.join(dst, f)); // auch Datendateien neben den Struktogrammen
      // Testfälle wie im Aufgabentest: Liste von Eingabefolgen, sonst einmal mit 5
      if (/\.nsd$/i.test(f)) list.push({ file: `samples/${dir.name}/${f}`, cases: Array.isArray(inputs[f]) && inputs[f].length ? inputs[f].map((c) => c.map(String)) : [['5']] });
    }
  }
  return list;
}

/**
 * Windows, von Hand gestartet: den Test in einem eigenen PowerShell-Fenster laufen lassen (klassisch blau, eigener
 * Titel, ohne die Rauschmeldungen des Test-VS-Code). --hier: im aktuellen Terminal. In der CI bzw. bei umgeleiteter
 * Ausgabe läuft der Test immer direkt.
 */
function inOwnWindow() {
  if (process.platform !== 'win32' || !process.stdout.isTTY || process.env.CI || process.env.STRUKTOGRAF_IM_FENSTER || process.argv.includes('--hier')) return false;
  const args = process.argv.slice(2).map((a) => `'${a.replace(/'/g, "''")}'`).join(' ');
  const noise = 'ChatModelSelection|AgentHost|RemoteAgentHost|AccountPolicyGate|CloudSandboxApi|Settings Sync|API proposal|^\\[main ';
  const ps = `$env:STRUKTOGRAF_IM_FENSTER = '1'; chcp 65001 > $null; [Console]::OutputEncoding = [Text.Encoding]::UTF8; ` +
    `$Host.UI.RawUI.WindowTitle = 'Struktograf: Test im echten VS Code'; Set-Location '${ROOT.replace(/'/g, "''")}'; ` +
    `node test/vscode/run.js ${args} 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -notmatch '${noise}' }`;
  // EncodedCommand (UTF-16LE, Base64): keine Probleme mit Anführungszeichen; „start“ öffnet ein neues Konsolenfenster
  const enc = Buffer.from(ps, 'utf16le').toString('base64');
  require('child_process').spawn('cmd.exe', ['/c', 'start', '"Struktograf"', 'powershell.exe', '-NoExit', '-EncodedCommand', enc], { detached: true, stdio: 'ignore' }).unref();
  console.log('Der Test läuft in einem eigenen Fenster („Struktograf: Test im echten VS Code“). Im aktuellen Terminal: --hier');
  return true;
}

(async () => {
  if (inOwnWindow()) return;
  if (LOG) fs.writeFileSync(LOG, '');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'struktograf-vscode-'));
  const fixtures = [];
  for (const [dst, [src, cases]] of Object.entries(FIXTURES)) { fs.copyFileSync(path.join(SAMPLES, src), path.join(ws, dst)); fixtures.push({ file: dst, cases }); }
  for (const [dst, src] of Object.entries(EXTRA)) fs.copyFileSync(path.join(SAMPLES, src), path.join(ws, dst));
  if (ALL) fixtures.push(...allSamples(ws));
  fs.writeFileSync(path.join(ws, 'manifest.json'), JSON.stringify({ all: ALL, fixtures }, null, 1));
  console.log(`VS-Code-Test: ${fixtures.length} Struktogramme${ALL ? ' (alle aus test/samples)' : ''} – Arbeitsordner ${ws}`);
  // von Hand gestartet: Test-VS-Code am Ende offen lassen (in der CI und ohne Terminal schließt es sich selbst)
  const keepOpen = !process.env.CI && !!(process.env.STRUKTOGRAF_IM_FENSTER || process.stdout.isTTY);
  let runError = null;
  try {
    await runTests({
      extensionDevelopmentPath: ROOT,
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      launchArgs: [ws, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
      extensionTestsEnv: { STRUKTOGRAF_TEST_WS: ws, STRUKTOGRAF_TEST_OFFEN: keepOpen ? '1' : '', STRUKTOGRAF_TEST_LOG: LOG },
    });
  } catch (e) { runError = e; }
  // Ergebnis aus der Datei der Testsuite – das Fenster kann von Hand geschlossen worden sein (dann meldet VS Code
  // einen Abbruch, obwohl alle Tests fertig waren)
  let result = null;
  try { result = JSON.parse(fs.readFileSync(path.join(ws, 'ergebnis.json'), 'utf8')); } catch (e) { /* nicht fertig geworden */ }
  const ok = result ? result.ok : !runError;
  const line = result ? result.summary : runError ? `VS-Code-Test abgebrochen (${runError.message || runError})` : 'VS-Code-Test beendet';
  const NL = '\n';
  console.log(NL + (ok ? '\x1b[32m' : '\x1b[31m') + '■ ' + line + '\x1b[0m' +
    (result && result.failed.length ? NL + result.failed.map((f) => '  ✗ ' + f).join(NL) : '') +
    (ok ? '' : NL + 'Arbeitsordner zum Nachsehen: ' + ws));
  if (LOG && !result) fs.appendFileSync(LOG, line + NL);
  if (ok) fs.rmSync(ws, { recursive: true, force: true });
  process.exitCode = ok ? 0 : 1;
})();
