'use strict';
const { parseCFamily } = require('./cfamily');
const { parsePython } = require('./python');
const { parseKotlin, parseRust } = require('./modern');
const { modernize, splitInstructions } = require('../style');

/** VS-Code-languageId -> interner Parser-Name */
const LANG_MAP = {
  python: 'python',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  'cuda-cpp': 'cpp',
  arduino: 'cpp',
  csharp: 'csharp',
  javascript: 'javascript',
  javascriptreact: 'javascript',
  typescript: 'typescript',
  typescriptreact: 'typescript',
  processing: 'java',
  kotlin: 'kotlin',
  rust: 'rust',
};

const EXT_MAP = { py: 'python', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', ino: 'cpp', cs: 'csharp', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', pde: 'java', kt: 'kotlin', kts: 'kotlin', rs: 'rust' };

function supportedLanguage(languageId, fileName) {
  if (LANG_MAP[languageId]) return LANG_MAP[languageId];
  const m = /\.([a-z0-9]+)$/i.exec(fileName || '');
  return m ? EXT_MAP[m[1].toLowerCase()] || null : null;
}

/**
 * Quelltext in ein Struktogramm-Dokument umwandeln.
 * @param {string} src
 * @param {string} lang interner Name (python, java, c, cpp, csharp, javascript, typescript, kotlin, rust)
 * @param {{name?:string}} opts
 */
function parseCode(src, lang, opts = {}) {
  const doc = lang === 'python' ? parsePython(src, opts)
    : lang === 'kotlin' ? parseKotlin(src, opts)
      : lang === 'rust' ? parseRust(src, opts)
        : parseCFamily(src, lang, opts);
  // Zuweisung mit "=", Vergleich mit "=="; jede Anweisung ein eigener Block
  return splitInstructions(modernize(doc));
}

module.exports = { parseCode, supportedLanguage };
