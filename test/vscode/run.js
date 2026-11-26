// Test in einem echten VS Code (Plan: „Ausprobieren“ automatisch): startet VS Code mit der Entwicklungsversion der
// Erweiterung (@vscode/test-electron), öffnet einen Arbeitsordner mit Beispiel-Struktogrammen und führt dort
// test/vscode/suite.js aus – Ausführen über den echten Befehl, Code erzeugen, Meldungen, Live-Code.
//
//   npm run test:vscode               läuft durch (CI)
//   npm run test:vscode -- --schritt  zum Zuschauen: nach jedem Programm im Terminal „Struktograf: erzeugter Code“
//                                     auf Enter warten
//   (lädt beim ersten Mal ein Test-VS-Code nach .vscode-test/)
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

/** Beispiele im Arbeitsordner: Zieldatei <- Quelle in test/samples */
const FIXTURES = {
  '01_dateien.nsd': 'files/01_write_read.nsd',
  '02_fileread.nsd': 'files/03_fileread_typed.nsd',
  '03_fehlertexte.nsd': 'try_catch/11_error_texts.nsd',
  '04_unendlich.nsd': 'expressions/16_float_div_zero.nsd',
  '05_texte.nsd': 'expressions/15_text_edges.nsd',
  '06_eingabe.nsd': 'types/03_input_mixed.nsd',
  '07_nicht_uebersetzbar.nsd': 'checks/untranslatable.nsd',
};

(async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'struktograf-vscode-'));
  for (const [dst, src] of Object.entries(FIXTURES)) fs.copyFileSync(path.join(SAMPLES, src), path.join(ws, dst));
  let failed = false;
  try {
    await runTests({
      extensionDevelopmentPath: ROOT,
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      launchArgs: [ws, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
      // --schritt: nach jedem Programm im Terminal auf Enter warten (zum Zuschauen), ohne: durchlaufen (CI)
      extensionTestsEnv: { STRUKTOGRAF_TEST_WS: ws, STRUKTOGRAF_TEST_SCHRITT: process.argv.includes('--schritt') ? '1' : '' },
    });
  } catch (e) {
    failed = true;
    console.error(`\nVS-Code-Test fehlgeschlagen (${e.message || e}) – Arbeitsordner: ${ws}`);
  }
  if (!failed) fs.rmSync(ws, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
})();
