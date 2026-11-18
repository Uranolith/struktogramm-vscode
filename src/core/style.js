'use strict';
/**
 * Schreibweise der Zuweisung im Struktogramm.
 *
 * Die Extension schreibt Zuweisungen mit "=" und Vergleiche mit "==" / "!=":
 *     x = 5          if x == 0          while a != b          for i = 1 to 10
 * Structorizer selbst arbeitet mit "<-" (bzw. ":=") für Zuweisungen und "=" / "<>" für Vergleiche.
 *
 *  modernize(doc)      Structorizer-Schreibweise -> "="-Schreibweise (nach Code-Import / Structorizer-Import)
 *  toStructorizer(doc) "="-Schreibweise -> Structorizer-Schreibweise (vor Übergabe an Structorizer.jar)
 *  splitInstructions   jede Anweisung in einen eigenen Block
 */
const { tokenize, findTop } = require('./tokenizer');
const { sequencesOf } = require('./model');

/** Tokens im Originaltext ersetzen (Leerraum und Strings bleiben unverändert) */
function replaceTokens(text, fn) {
  const s = String(text == null ? '' : text);
  let toks;
  try { toks = tokenize(s, 'pseudo'); } catch (e) { return s; }
  let out = '', pos = 0;
  toks.forEach((t, i) => {
    const r = fn(t, i, toks);
    if (r == null || r === t.v) return;
    out += s.slice(pos, t.start) + r;
    pos = t.end;
  });
  return out + s.slice(pos);
}

const isOp = (t, v) => t && t.t === 'op' && t.v === v;

/** Bedingung: "=" -> "==", "<>" -> "!=" */
function condToEq(text) {
  return replaceTokens(text, (t) => (isOp(t, '=') ? '==' : isOp(t, '<>') ? '!=' : null));
}

/** Anweisungszeile in Structorizer-Schreibweise -> "="-Schreibweise */
function lineToEq(text) {
  const toks = safeTok(text);
  const old = toks.some((t) => isOp(t, '<-') || isOp(t, ':='));
  return replaceTokens(text, (t) => {
    if (isOp(t, '<-') || isOp(t, ':=')) return '=';
    if (isOp(t, '<>')) return '!=';
    if (old && isOp(t, '=')) return '==';
    return null;
  });
}

/** "="-Schreibweise -> Structorizer: erste Zuweisung "=" auf oberster Ebene wird "<-" */
function lineToArrow(text) {
  const toks = safeTok(text);
  if (toks.some((t) => isOp(t, '<-') || isOp(t, ':='))) return String(text);
  const k = findTop(toks, (t) => isOp(t, '='));
  if (k <= 0) return String(text);
  return replaceTokens(text, (t, i) => (i === k ? '<-' : null));
}

function safeTok(text) {
  try { return tokenize(String(text == null ? '' : text), 'pseudo'); } catch (e) { return []; }
}

const COND_TYPES = new Set(['alternative', 'while', 'repeat']);
const LINE_TYPES = new Set(['instruction', 'call', 'jump', 'for']);

function mapDoc(doc, condFn, lineFn) {
  const visit = (seq) => {
    for (const el of seq) {
      if (COND_TYPES.has(el.type)) el.text = el.text.map(condFn);
      else if (LINE_TYPES.has(el.type)) el.text = el.text.map(lineFn);
      for (const s of sequencesOf(el)) visit(s.seq);
    }
  };
  for (const r of doc.roots || []) visit(r.children);
  return doc;
}

/** Mehrzeilige Anweisungen in einzelne Blöcke aufteilen (Kommentar/Farbe bleiben am ersten) */
function splitInstructions(doc) {
  const visit = (seq) => {
    for (let i = 0; i < seq.length; i++) {
      const el = seq[i];
      for (const s of sequencesOf(el)) visit(s.seq);
      if (el.type !== 'instruction') continue;
      const lines = el.text.filter((l) => l.trim());
      if (lines.length <= 1) continue;
      const parts = lines.map((l, k) => {
        const n = { type: 'instruction', text: [l] };
        if (el.color) n.color = el.color;
        if (el.disabled) n.disabled = true;
        if (k === 0 && el.comment && el.comment.length) n.comment = el.comment;
        return n;
      });
      seq.splice(i, 1, ...parts);
      i += parts.length - 1;
    }
  };
  for (const r of doc.roots || []) visit(r.children);
  return doc;
}

const modernize = (doc) => mapDoc(doc, condToEq, lineToEq);
const toStructorizer = (doc) => mapDoc(doc, (s) => s, lineToArrow);

module.exports = { modernize, toStructorizer, splitInstructions, condToEq, lineToEq, lineToArrow };
