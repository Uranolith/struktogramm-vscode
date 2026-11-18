'use strict';
/**
 * Text-Exporte eines Struktogramms:
 *   toJson     – vollständige, sprechende JSON-Struktur
 *   toXml      – dieselbe Struktur als einfaches XML (Structorizer-XML gibt es weiterhin als .nsd)
 *   toCompact  – token-sparender Pseudocode für KI-Agents (Einrückung = Blockstruktur)
 */

const lines = (el) => (el.text || []).map((l) => String(l)).filter((l) => l.trim() !== '');
const one = (el) => lines(el).join(' ').trim();
const ROOT_KIND = { program: 'program', sub: 'function', includable: 'include' };

/** Fallauswahl: [{label, isDefault, body}] – letzte Marke ist default, "%" = kein default */
function caseBranches(el) {
  const labels = (el.text || []).slice(1).map((l) => String(l == null ? '' : l).trim());
  const out = [];
  el.branches.forEach((body, k) => {
    const isLast = k === el.branches.length - 1;
    if (isLast && labels[k] === '%') return;
    out.push({ label: labels[k] || '', isDefault: isLast, body });
  });
  return out;
}

function stripKw(text, kw) {
  const re = new RegExp('^\\s*' + kw + '\\b\\s*', 'i');
  return String(text).replace(re, '');
}

/* ------------------------------------------------------------------ JSON */

function jsonEl(el) {
  const o = { type: el.type === 'alternative' ? 'if' : el.type };
  switch (el.type) {
    case 'instruction': case 'call': case 'jump': o.text = lines(el).join('\n'); break;
    case 'alternative': o.condition = one(el); o.then = jsonSeq(el.qTrue); o.else = jsonSeq(el.qFalse); break;
    case 'case':
      o.expression = String((el.text || [])[0] || '').trim();
      o.branches = caseBranches(el).map((b) => (b.isDefault ? { default: true, body: jsonSeq(b.body) } : { values: b.label, body: jsonSeq(b.body) }));
      break;
    case 'for': o.head = one(el); o.body = jsonSeq(el.body); break;
    case 'while': o.condition = stripKw(one(el), 'while'); o.body = jsonSeq(el.body); break;
    case 'repeat': o.until = stripKw(one(el), 'until'); o.body = jsonSeq(el.body); break;
    case 'forever': o.body = jsonSeq(el.body); break;
    case 'parallel': o.threads = el.branches.map(jsonSeq); break;
    case 'try': o.catchVar = String((el.text || [])[0] || '').trim(); o.try = jsonSeq(el.qTry); o.catch = jsonSeq(el.qCatch); o.finally = jsonSeq(el.qFinally); break;
    default: o.text = lines(el).join('\n');
  }
  const cm = (el.comment || []).filter((c) => String(c).trim());
  if (cm.length) o.comment = cm.join('\n');
  if (el.color && el.color.toLowerCase() !== 'ffffff') o.color = '#' + el.color;
  if (el.disabled) o.disabled = true;
  return o;
}
const jsonSeq = (seq) => (seq || []).map(jsonEl);

function toJsonObject(doc) {
  return {
    format: 'struktogramm',
    version: 1,
    notation: { assign: ':=', compare: '=', notEqual: '<>', input: 'INPUT', output: 'OUTPUT' },
    diagrams: (doc.roots || []).map((r) => {
      const d = { kind: ROOT_KIND[r.rootType] || r.rootType, signature: (r.text || []).join(' ').trim() };
      const cm = (r.comment || []).filter((c) => String(c).trim());
      if (cm.length) d.comment = cm.join('\n');
      d.body = jsonSeq(r.children);
      return d;
    }),
  };
}

function toJson(doc) { return JSON.stringify(toJsonObject(doc), null, 2) + '\n'; }

/* ------------------------------------------------------------------- XML */

const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Textinhalt: Anführungszeichen müssen nicht maskiert werden */
const tesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function xmlNode(o, ind) {
  const I = ind + '  ';
  const attrs = [];
  if (o.disabled) attrs.push('disabled="true"');
  if (o.color) attrs.push(`color="${xesc(o.color)}"`);
  const a = attrs.length ? ' ' + attrs.join(' ') : '';
  const cm = o.comment ? `${I}<comment>${tesc(o.comment)}</comment>\n` : '';
  const seq = (tag, s, extra = '') => (s.length ? `${I}<${tag}${extra}>\n${s.map((x) => xmlNode(x, I + '  ')).join('')}${I}</${tag}>\n` : `${I}<${tag}${extra}/>\n`);
  const textEl = (tag) => {
    const ls = o.text ? o.text.split('\n') : [];
    if (ls.length <= 1 && !cm) return `${ind}<${tag}${a}>${tesc(ls[0] || '')}</${tag}>\n`;
    return `${ind}<${tag}${a}>\n${cm}${ls.map((l) => `${I}<line>${tesc(l)}</line>\n`).join('')}${ind}</${tag}>\n`;
  };
  switch (o.type) {
    case 'instruction': case 'call': case 'jump': return textEl(o.type);
    case 'if': return `${ind}<if${a}>\n${cm}${I}<condition>${tesc(o.condition)}</condition>\n${seq('then', o.then)}${seq('else', o.else)}${ind}</if>\n`;
    case 'case':
      return `${ind}<case${a}>\n${cm}${I}<expression>${tesc(o.expression)}</expression>\n` +
        o.branches.map((b) => seq('branch', b.body, b.default ? ' default="true"' : ` values="${xesc(b.values)}"`)).join('') + `${ind}</case>\n`;
    case 'for': return `${ind}<for${a} head="${xesc(o.head)}">\n${cm}${seq('body', o.body)}${ind}</for>\n`;
    case 'while': return `${ind}<while${a} condition="${xesc(o.condition)}">\n${cm}${seq('body', o.body)}${ind}</while>\n`;
    case 'repeat': return `${ind}<repeat${a} until="${xesc(o.until)}">\n${cm}${seq('body', o.body)}${ind}</repeat>\n`;
    case 'forever': return `${ind}<forever${a}>\n${cm}${seq('body', o.body)}${ind}</forever>\n`;
    case 'parallel': return `${ind}<parallel${a}>\n${cm}${o.threads.map((t) => seq('thread', t)).join('')}${ind}</parallel>\n`;
    case 'try': return `${ind}<try${a}>\n${cm}${seq('block', o.try)}${seq('catch', o.catch, ` var="${xesc(o.catchVar)}"`)}${seq('finally', o.finally)}${ind}</try>\n`;
    default: return textEl(o.type);
  }
}

function toXml(doc) {
  const j = toJsonObject(doc);
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Struktogramm (Nassi-Shneiderman). Zuweisung ":=", Vergleich "=" und "<>" (Structorizer-Schreibweise). -->\n<struktogramm version="1">\n';
  for (const d of j.diagrams) {
    s += `  <diagram kind="${d.kind}" signature="${xesc(d.signature)}">\n`;
    if (d.comment) s += `    <comment>${tesc(d.comment)}</comment>\n`;
    s += d.body.map((o) => xmlNode(o, '    ')).join('');
    s += '  </diagram>\n';
  }
  return s + '</struktogramm>\n';
}

/* ------------------------------------------------------------ KI-kompakt */

const COMPACT_HEADER = '# NSD pseudocode (Structorizer syntax). 1 space indent = nesting. ":=" assign, "=" "<>" compare. # = comment';

function compactSeq(seq, ind, out) {
  for (const el of seq || []) compactEl(el, ind, out);
}

function compactEl(el, ind, out) {
  const cm = (el.comment || []).map((c) => String(c).trim()).filter(Boolean).join(' ');
  const tail = (el.disabled ? ' # disabled' : '') + (cm ? ' # ' + cm : '');
  const push = (s, withTail) => out.push(ind + s + (withTail ? tail : ''));
  const I = ind + ' ';
  switch (el.type) {
    case 'instruction': case 'call': case 'jump': {
      const ls = lines(el);
      if (!ls.length) { if (tail) push('', true); return; }
      ls.forEach((l, k) => push(l.trim(), k === 0));
      return;
    }
    case 'alternative':
      push('if ' + one(el), true);
      compactSeq(el.qTrue, I, out);
      if (el.qFalse && el.qFalse.length) { push('else'); compactSeq(el.qFalse, I, out); }
      return;
    case 'case':
      push('case ' + String((el.text || [])[0] || '').trim(), true);
      for (const b of caseBranches(el)) {
        out.push(I + (b.isDefault ? 'default' : 'of ' + b.label));
        compactSeq(b.body, I + ' ', out);
      }
      return;
    case 'for': {
      const t = one(el);
      push(/^(for|foreach)\b/i.test(t) ? t : 'for ' + t, true);
      compactSeq(el.body, I, out);
      return;
    }
    case 'while': push('while ' + stripKw(one(el), 'while'), true); compactSeq(el.body, I, out); return;
    case 'repeat': push('repeat', true); compactSeq(el.body, I, out); push('until ' + stripKw(one(el), 'until')); return;
    case 'forever': push('loop', true); compactSeq(el.body, I, out); return;
    case 'parallel':
      push('parallel', true);
      el.branches.forEach((b) => { out.push(I + 'thread'); compactSeq(b, I + ' ', out); });
      return;
    case 'try': {
      const v = String((el.text || [])[0] || '').trim();
      push('try', true);
      compactSeq(el.qTry, I, out);
      push('catch' + (v ? ' ' + v : ''));
      compactSeq(el.qCatch, I, out);
      if (el.qFinally && el.qFinally.length) { push('finally'); compactSeq(el.qFinally, I, out); }
      return;
    }
    default: lines(el).forEach((l, k) => push(l.trim(), k === 0));
  }
}

function toCompact(doc) {
  const out = [COMPACT_HEADER];
  for (const r of doc.roots || []) {
    const kind = (ROOT_KIND[r.rootType] || r.rootType).toUpperCase();
    const cm = (r.comment || []).map((c) => String(c).trim()).filter(Boolean).join(' ');
    out.push(`${kind} ${(r.text || []).join(' ').trim()}${cm ? ' # ' + cm : ''}`);
    compactSeq(r.children, '', out);
  }
  return out.join('\n') + '\n';
}

module.exports = { toJson, toJsonObject, toXml, toCompact };
