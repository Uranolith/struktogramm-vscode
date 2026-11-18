'use strict';
/**
 * Schreibweise im Struktogramm = Structorizer-Schreibweise:
 *
 *     x := 5          if x = 0          while a <> b          for i := 1 to 10
 *
 * Zuweisung ":=", Vergleich "=" und "<>". Damit lassen sich .nsd-Dateien 1:1 im Original-Structorizer öffnen.
 *
 *  normalize(doc)      jede andere Schreibweise -> Structorizer-Schreibweise:
 *                        "<-" -> ":="   "==" -> "="   "!=" -> "<>"   "div" -> "/"
 *                        sowie "="-Zuweisungen älterer Versionen dieser Extension (x = 5 -> x := 5)
 *  modernize / toStructorizer   Aliase von normalize (ältere Aufrufer)
 *  splitInstructions   jede Anweisung in einen eigenen Block
 */
const { tokenize, findTop, matchClose } = require('./tokenizer');
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
/** "div" (Ganzzahldivision) wird immer als "/" geschrieben */
const isDiv = (t) => t && t.t === 'id' && t.v.toLowerCase() === 'div';

function safeTok(text) {
  try { return tokenize(String(text == null ? '' : text), 'pseudo'); } catch (e) { return []; }
}

/** Gemeinsame Ersetzungen für Bedingungen und Zeilen */
function common(t) {
  if (isOp(t, '==') || isOp(t, '===')) return '=';
  if (isOp(t, '!=') || isOp(t, '!==')) return '<>';
  if (isDiv(t)) return '/';
  return null;
}

/** Bedingung: "==" -> "=", "!=" -> "<>" */
function normCond(text) {
  return replaceTokens(text, common);
}

/** Zuweisungsziel: x | a[i] | p.x | a, b */
function isTarget(toks) {
  if (!toks.length) return false;
  let i = 0;
  for (;;) {
    if (!toks[i] || toks[i].t !== 'id') return false;
    i++;
    while (i < toks.length && (isOp(toks[i], '.') || isOp(toks[i], '['))) {
      if (isOp(toks[i], '.')) { if (!toks[i + 1] || toks[i + 1].t !== 'id') return false; i += 2; }
      else { const c = matchClose(toks, i); if (c < 0) return false; i = c + 1; }
    }
    if (i === toks.length) return true;
    if (!isOp(toks[i], ',')) return false;
    i++;
  }
}

const NO_ASSIGN = /^(type|return|exit|throw|raise|output|ausgabe|print|write|writeln|input|eingabe|read|readln|leave|break|continue|if|while|until|case|foreach)$/i;

/** Index des "=" einer alten Zuweisung "x = 5" (oder -1) */
function legacyAssignIdx(toks) {
  if (!toks.length || toks.some((t) => isOp(t, '<-') || isOp(t, ':='))) return -1;
  const first = toks[0].t === 'id' ? toks[0].v.toLowerCase() : '';
  if (NO_ASSIGN.test(first)) return -1;
  const k = findTop(toks, (t) => isOp(t, '='));
  if (k <= 0) return -1;
  let head = toks.slice(0, k);
  if (first === 'for') head = head.slice(1);
  else if (['var', 'dim', 'const', 'let'].includes(first)) {
    head = head.slice(1);
    const colon = findTop(head, (t) => isOp(t, ':') || (t.t === 'id' && t.v.toLowerCase() === 'as'));
    if (colon >= 0) head = head.slice(0, colon);
  } else if (head.length >= 2 && head[0].t === 'id' && head[1].t === 'id') {
    head = head.slice(1); // C-artige Deklaration "int x = 5"
  }
  return isTarget(head) ? k : -1;
}

/** Anweisungszeile -> Structorizer-Schreibweise */
function normLine(text) {
  const k = legacyAssignIdx(safeTok(text));
  return replaceTokens(text, (t, i) => {
    if (i === k) return ':=';
    if (isOp(t, '<-')) return ':=';
    return common(t);
  });
}

const COND_TYPES = new Set(['alternative', 'while', 'repeat']);
const LINE_TYPES = new Set(['instruction', 'call', 'jump', 'for']);

function mapDoc(doc, condFn, lineFn) {
  const visit = (seq) => {
    for (const el of seq) {
      if (COND_TYPES.has(el.type)) el.text = el.text.map(condFn);
      else if (LINE_TYPES.has(el.type)) el.text = el.text.map(lineFn);
      else if (el.type === 'case' && el.text.length) el.text = [condFn(el.text[0]), ...el.text.slice(1)];
      for (const s of sequencesOf(el)) visit(s.seq);
    }
  };
  for (const r of doc.roots || []) visit(r.children || []);
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

const normalize = (doc) => mapDoc(doc, normCond, normLine);

module.exports = { normalize, modernize: normalize, toStructorizer: normalize, splitInstructions, normCond, normLine };
