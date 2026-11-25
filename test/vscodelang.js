'use strict';
/**
 * Sprache für Kommentare im erzeugten Code – wie in der Erweiterung (Einstellung struktogramm.language):
 * de / en wie eingestellt; „auto“ (Standard) folgt der Sprache der VS-Code-Oberfläche (Deutsch, sonst Englisch).
 * Gelesen werden die Arbeitsbereich-Einstellungen (test/samples, Projektordner) und die Benutzereinstellungen;
 * die Oberflächensprache steht in argv.json („locale“), ohne Eintrag ist sie Englisch.
 * Vorrang hat --sprache de|en bzw. die Umgebungsvariable STRUKTOGRAMM_LANGUAGE.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** JSON mit Kommentaren und Komma am Ende (wie settings.json) lesen */
function readJsonc(file) {
  let s;
  try { s = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  let out = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { out += c; if (c === '\\') { out += s[++i] || ''; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
    out += c;
  }
  try { return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')); } catch (e) { return null; }
}

function userDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Code', 'User');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Code', 'User');
}

/** {lang: 'de'|'en', source: Text für die Ausgabe} */
function codeLanguage(workspaces = []) {
  const argv = process.argv.slice(2);
  const k = argv.findIndex((a) => a === '--sprache' || a === '--lang');
  const forced = (k >= 0 ? argv[k + 1] : null) || process.env.STRUKTOGRAMM_LANGUAGE;
  if (forced) return { lang: /^de/i.test(forced) ? 'de' : 'en', source: 'vorgegeben' };
  const files = [...workspaces.map((w) => path.join(w, '.vscode', 'settings.json')), path.join(userDir(), 'settings.json')];
  for (const f of files) {
    const j = readJsonc(f);
    const v = j && j['struktogramm.language'];
    if (v === 'de' || v === 'en') return { lang: v, source: `Einstellung struktogramm.language in ${f}` };
    if (v === 'auto') break;
  }
  const argvJson = readJsonc(path.join(os.homedir(), '.vscode', 'argv.json'));
  const locale = argvJson && argvJson.locale;
  return { lang: /^de/i.test(locale || '') ? 'de' : 'en', source: `Automatisch – VS-Code-Oberfläche ${locale ? `„${locale}“` : 'Englisch (keine Sprache in argv.json)'}` };
}

module.exports = { codeLanguage, readJsonc };
