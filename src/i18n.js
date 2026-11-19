'use strict';
/**
 * Übersetzungen (Englisch = Standard, Deutsch).
 * Texte stehen in src/i18n/en.json und src/i18n/de.json, Platzhalter {0}, {1} …
 * Fehlt ein Text in der gewählten Sprache, wird der englische verwendet.
 * Ohne Abhängigkeit von VS Code, damit auch Ausführer und Generatoren ihn nutzen können.
 */
const DICTS = {
  en: require('./i18n/en.json'),
  de: require('./i18n/de.json'),
};

let lang = 'en';

/** Sprache aus einem VS-Code-Sprachkürzel setzen (de, de-DE, de-AT … → de, sonst en) */
function setLanguage(tag) {
  lang = /^de\b/i.test(String(tag || '')) ? 'de' : 'en';
  return lang;
}

function getLanguage() { return lang; }

/** Text zum Schlüssel, Platzhalter {0}, {1} … durch die Argumente ersetzt */
function t(key, ...args) {
  const s = (DICTS[lang] && DICTS[lang][key]) ?? DICTS.en[key] ?? key;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m)) : s;
}

/** alle Texte der aktuellen Sprache (für die Webview), englische als Rückfall */
function allStrings() {
  return { ...DICTS.en, ...(DICTS[lang] || {}) };
}

module.exports = { t, setLanguage, getLanguage, allStrings };
