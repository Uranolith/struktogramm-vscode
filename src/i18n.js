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

/** alle Texte der aktuellen Sprache (für die Webview), englische als Rückfall; auf dem Mac mit Mac-Tasten */
function allStrings(platform = process.platform) {
  const s = { ...DICTS.en, ...(DICTS[lang] || {}) };
  return platform === 'darwin' ? macKeys(s) : s;
}

/** Tasten, die es auf dem Mac nicht gibt oder die dort anders heißen (sprachunabhängig) */
const MAC_KEYS = {
  'web.key.del': '⌫',
  'web.key.redo': '⇧⌘Z',
  'web.help.k5': 'Fn+← / Fn+→',
  'web.help.k6': 'Fn+↑ / Fn+↓',
  'web.help.k11': '⇧F10',
};

/**
 * Tastenhinweise für macOS: Strg/Ctrl → ⌘ (die Webview wertet ⌘ wie Strg aus), Strg+Leertaste bleibt ⌃
 * (dazu ⌘I), Entf/Del → ⌫, Einfg/Insert entfällt (gibt es auf Mac-Tastaturen nicht).
 */
function macKeys(strings) {
  const out = {};
  for (const [k, v] of Object.entries(strings)) {
    out[k] = typeof v !== 'string' ? v : v
      .replace(/\s+(?:bzw\.|or)\s+(?:Umschalt|Shift)\s*\+\s*(?:Einfg|Insert)\b/g, '')
      .replace(/(?:Strg|Ctrl)\s*\+\s*(?:Umschalt|Shift)\s*\+\s*/g, '⇧⌘')
      .replace(/(?:Strg|Ctrl)\s*\+\s*(Leertaste|Space)/g, '⌃$1 / ⌘I')
      .replace(/(?:Strg|Ctrl)\s*\+\s*/g, '⌘')
      .replace(/\s*\/\s*(?:Einfg|Insert)\b/g, '')
      .replace(/\b(?:Entf|Del)\b(?=\s*[:·)]|\s*$)/g, '⌫');
  }
  return Object.assign(out, MAC_KEYS);
}

module.exports = { t, setLanguage, getLanguage, allStrings, macKeys };
