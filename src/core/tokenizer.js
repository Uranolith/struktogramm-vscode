'use strict';
/**
 * Generischer Tokenizer für C-artige Sprachen, Python und den neutralen
 * Struktogramm-Pseudocode.
 *
 * Token: { t: 'id'|'num'|'str'|'op', v: string, ws: boolean, nl: boolean, line: number }
 *   ws = vor dem Token stand Leerraum, nl = vor dem Token stand ein Zeilenumbruch
 */

const C_OPS = ['>>>=', '===', '!==', '<<=', '>>=', '>>>', '**=', '...', '->', '=>', '==', '!=', '<=', '>=', '&&', '||',
  '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '::', '**', '?.', '??'];
const PY_OPS = ['**=', '//=', '>>=', '<<=', '...', '->', ':=', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '<<', '>>', '**', '//', '<>'];
const PSEUDO_OPS = ['===', '!==', '<-', ':=', '<>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=',
  '/=', '%=', '->', '=>', '::', '**', '//', '<<', '>>'];

const UNICODE_PSEUDO = { '←': '<-', '≠': '<>', '≤': '<=', '≥': '>=' };

const ID_START = /[\p{L}_$]/u;
const ID_REST = /^[\p{L}\p{N}_$]+/u;
const NUM_RE = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)[a-zA-Z]*/;

/**
 * @param {string} src
 * @param {'c'|'python'|'pseudo'} mode
 */
function tokenize(src, mode) {
  const toks = [];
  const n = src.length;
  const ops = mode === 'python' ? PY_OPS : mode === 'pseudo' ? PSEUDO_OPS : C_OPS;
  let i = 0, line = 1, ws = false, nl = false, lineStart = true;

  const push = (t, v, start) => {
    toks.push({ t, v, ws, nl, line, start, end: i });
    ws = false; nl = false; lineStart = false;
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; ws = true; nl = true; lineStart = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') { i++; ws = true; continue; }

    if (mode === 'c') {
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; ws = true; continue; }
      if (c === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2);
        const end = e < 0 ? n : e + 2;
        for (let k = i; k < end; k++) if (src[k] === '\n') { line++; nl = true; }
        i = end; ws = true; continue;
      }
      if (c === '#' && lineStart) { // Präprozessor-Zeile überspringen
        while (i < n && src[i] !== '\n') { if (src[i] === '\\' && src[i + 1] === '\n') { i++; line++; } i++; }
        ws = true; continue;
      }
    }
    if (mode === 'python' && c === '#') { while (i < n && src[i] !== '\n') i++; ws = true; continue; }

    const start = i;
    // Strings (inkl. Python-Präfixe)
    let prefixLen = 0;
    if (mode === 'python') {
      const m = /^[rRbBfFuU]{1,2}(?=['"])/.exec(src.slice(i, i + 3));
      if (m) prefixLen = m[0].length;
    } else if (mode === 'c' && (c === '$' || c === '@') && (src[i + 1] === '"')) {
      prefixLen = 1; // C#-Interpolation/verbatim
    }
    const q = src[i + prefixLen];
    if (q === '"' || q === "'" || (q === '`' && mode === 'c')) {
      let j = i + prefixLen;
      if (mode === 'python' && src.startsWith(q + q + q, j)) {
        const e = src.indexOf(q + q + q, j + 3);
        j = e < 0 ? n : e + 3;
      } else {
        j++;
        while (j < n && src[j] !== q) {
          if (src[j] === '\\') j += 2;
          else if (src[j] === '\n' && q !== '`') break;
          else j++;
        }
        j++;
      }
      j = Math.min(j, n);
      for (let k = i; k < j; k++) if (src[k] === '\n') line++;
      i = j;
      push('str', src.slice(start, j), start);
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = NUM_RE.exec(src.slice(i, i + 64));
      if (m) { i += m[0].length; push('num', m[0], start); continue; }
    }

    if (ID_START.test(c)) {
      const m = ID_REST.exec(src.slice(i, i + 256));
      i += m[0].length;
      push('id', m[0], start);
      continue;
    }

    if (mode === 'pseudo' && UNICODE_PSEUDO[c]) { i++; push('op', UNICODE_PSEUDO[c], start); continue; }

    let op = null;
    for (const o of ops) if (src.startsWith(o, i)) { op = o; break; }
    if (op) { i += op.length; push('op', op, start); continue; }
    i++;
    push('op', c, start);
  }
  return toks;
}

function isWordy(t) { return t && (t.t === 'id' || t.t === 'num' || t.t === 'str'); }

/** Tokens wieder zu Text zusammensetzen (Leerraum wird erhalten). */
function joinTokens(toks) {
  let s = '';
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (k > 0 && (t.ws || (isWordy(toks[k - 1]) && isWordy(t)))) s += ' ';
    s += t.v;
  }
  return s.trim();
}

const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = { ')': '(', ']': '[', '}': '{' };

/** Index der passenden schließenden Klammer zu toks[i] (oder -1). */
function matchClose(toks, i) {
  let depth = 0;
  for (let k = i; k < toks.length; k++) {
    const v = toks[k].t === 'op' ? toks[k].v : '';
    if (OPEN[v]) depth++;
    else if (CLOSE[v]) { depth--; if (depth === 0) return k; }
  }
  return -1;
}

/** Tokens an Trennzeichen auf oberster Ebene aufteilen. */
function splitTop(toks, sep) {
  const parts = [];
  let cur = [], depth = 0;
  const isSep = typeof sep === 'function' ? sep : (t) => t.v === sep;
  for (const t of toks) {
    if (t.t === 'op' && OPEN[t.v]) depth++;
    else if (t.t === 'op' && CLOSE[t.v]) depth--;
    if (depth === 0 && isSep(t)) { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  parts.push(cur);
  return parts;
}

/** Index des ersten Tokens auf oberster Ebene, das pred erfüllt. */
function findTop(toks, pred, from = 0) {
  let depth = 0;
  for (let k = from; k < toks.length; k++) {
    const t = toks[k];
    if (depth === 0 && pred(t, k)) return k;
    if (t.t === 'op' && OPEN[t.v]) depth++;
    else if (t.t === 'op' && CLOSE[t.v]) depth--;
  }
  return -1;
}

/** Ist toks komplett von einem Klammerpaar umschlossen? */
function isWrapped(toks, open = '(') {
  return toks.length >= 2 && toks[0].v === open && matchClose(toks, 0) === toks.length - 1;
}

function tok(v, t = 'op', ws = true) { return { t, v, ws, nl: false, line: 0 }; }

module.exports = { tokenize, joinTokens, matchClose, splitTop, findTop, isWrapped, isWordy, tok, OPEN, CLOSE };
