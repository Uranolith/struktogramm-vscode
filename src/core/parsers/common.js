'use strict';
const { mk, sequencesOf } = require('../model');
const { negateCond } = require('../pseudo');

/**
 * Ausgabe-Teile zu OUTPUT-Zeile zusammenbauen.
 * parts: [{lit: string} | {expr: string}] – lit ist der rohe Inhalt eines String-Literals (Escapes erhalten)
 */
function outputLine(parts, kw = 'OUTPUT') {
  const merged = [];
  for (const p of parts) {
    if (p.lit != null) {
      if (p.lit === '') continue;
      const last = merged[merged.length - 1];
      if (last && last.lit != null) last.lit += p.lit; else merged.push({ lit: p.lit });
    } else if (p.expr) merged.push({ expr: p.expr });
  }
  if (!merged.length) return kw;
  return kw + ' ' + merged.map((p) => (p.lit != null ? '"' + p.lit + '"' : p.expr)).join(', ');
}

function inputLine(prompt, vars, kw = 'INPUT') {
  const p = prompt ? (/^["']/.test(prompt) ? prompt : '"' + prompt + '"') + (vars.length ? ', ' : '') : '';
  return `${kw} ${p}${vars.join(', ')}`.trim();
}

/** Inhalt eines Literals in Pseudocode-Doppelquote-Form bringen */
function litContent(raw) {
  const q = raw[0];
  let inner = raw.slice(1, -1);
  if (q === "'") inner = inner.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"');
  return inner;
}

/** Trailing "\n" aus Literalen am Ende entfernen */
function stripTrailingNewline(parts) {
  const last = parts[parts.length - 1];
  if (last && last.lit != null) {
    last.lit = last.lit.replace(/(\\n|\\r\\n)+$/, '');
    if (last.lit === '') parts.pop();
    return true;
  }
  return false;
}

/**
 * Nachbearbeitung einer Folge (rekursiv):
 *  - Prompt-Ausgabe + Eingabe zusammenfassen
 *  - Endlosschleife mit "if c then leave" am Ende -> Fußschleife
 *  - Endlosschleife mit "if c then leave" am Anfang -> Kopfschleife
 */
function refine(seq) {
  for (const el of seq) for (const s of sequencesOf(el)) refine(s.seq);
  for (let i = 0; i < seq.length; i++) {
    const el = seq[i];
    // Prompt + INPUT
    if (el._prompt && seq[i + 1] && seq[i + 1].type === 'instruction') {
      const nx = seq[i + 1];
      const idx = nx.text.findIndex((l) => /^INPUT\s+(?!")/.test(l));
      if (idx >= 0) {
        nx.text[idx] = nx.text[idx].replace(/^INPUT\s+/, `INPUT "${el._prompt}", `);
        seq.splice(i, 1);
        i--;
        continue;
      }
    }
    if (el.type === 'forever' && el.body.length) {
      const last = el.body[el.body.length - 1];
      const first = el.body[0];
      if (isBreakIf(last) && countLeaves(el.body) === 1) {
        seq[i] = { ...mk.repeat('until ' + last.text[0], el.body.slice(0, -1)), ...extra(el) };
      } else if (isBreakIf(first) && countLeaves(el.body) === 1 && el.body.length > 1) {
        seq[i] = { ...mk.while('while ' + negateCond(first.text[0]), el.body.slice(1)), ...extra(el) };
      }
    }
  }
  for (const el of seq) delete el._prompt;
  return seq;
}

function extra(el) {
  const o = {};
  if (el.comment && el.comment.length) o.comment = el.comment;
  return o;
}

function isBreakIf(el) {
  return el && el.type === 'alternative' && el.qFalse.length === 0 && el.qTrue.length === 1 &&
    el.qTrue[0].type === 'jump' && /^(leave|break)$/i.test(el.qTrue[0].text.join(' ').trim());
}

/** Zahl der leave-Sprünge, die sich auf diese Schleife beziehen */
function countLeaves(seq) {
  let n = 0;
  for (const el of seq) {
    if (el.type === 'jump' && /^(leave|break)$/i.test(el.text.join(' ').trim())) n++;
    if (['for', 'while', 'repeat', 'forever'].includes(el.type)) continue; // innere Schleife
    if (el.type === 'case') continue; // break in switch gehört zum switch
    for (const s of sequencesOf(el)) n += countLeaves(s.seq);
  }
  return n;
}

function addComment(el, text) {
  if (!el) return;
  el.comment = (el.comment || []).concat(String(text).split('\n'));
}

module.exports = { outputLine, inputLine, litContent, stripTrailingNewline, refine, addComment };
