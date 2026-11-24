'use strict';
/**
 * Lesen/Schreiben des Structorizer-Formats (.nsd, XML).
 * Eine Datei mit genau einem Diagramm ist ein normales Structorizer-<root>.
 * Mehrere Diagramme werden in <roots> ... </roots> zusammengefasst (Erweiterung dieser Extension).
 */
const { mk, clone } = require('./model');
const { normalize } = require('./style');
const { t } = require('../i18n');

/* ------------------------------ XML-Parser ------------------------------ */
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
  });
}

function parseXml(text) {
  let i = 0;
  const n = text.length;
  const root = { name: '#doc', attrs: {}, children: [] };
  const stack = [root];
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<?', lt)) { i = text.indexOf('?>', lt) + 2; continue; }
    if (text.startsWith('<!--', lt)) { i = text.indexOf('-->', lt) + 3; continue; }
    if (text.startsWith('<!', lt)) { i = text.indexOf('>', lt) + 1; continue; }
    if (text[lt + 1] === '/') {
      const gt = text.indexOf('>', lt);
      const name = text.slice(lt + 2, gt).trim();
      while (stack.length > 1) { const top = stack.pop(); if (top.name === name) break; }
      i = gt + 1;
      continue;
    }
    // Start-Tag
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(text[j])) j++;
    const el = { name: text.slice(lt + 1, j), attrs: {}, children: [], pos: lt };
    const attrRe = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
    for (;;) {
      attrRe.lastIndex = j;
      const m = attrRe.exec(text);
      if (!m) break;
      el.attrs[m[1]] = decodeEntities(m[3] != null ? m[3] : m[4]);
      j = attrRe.lastIndex;
    }
    const gt = text.indexOf('>', j);
    if (gt < 0) throw new Error(t('nsd.unclosed'));
    const selfClose = text[gt - 1] === '/';
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
    i = gt + 1;
  }
  return root;
}

/* ---------------------- Structorizer-StringList ------------------------- */
/** "a","b" -> ['a','b'] (doppelte Anführungszeichen innerhalb werden zu ") */
function parseCommaText(s) {
  if (s == null) return [];
  const res = [];
  let i = 0;
  const n = s.length;
  if (!s.trim()) return [''];
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (s[i] === '"') {
      let v = '';
      i++;
      while (i < n) {
        if (s[i] === '"') {
          if (s[i + 1] === '"') { v += '"'; i += 2; continue; }
          i++;
          break;
        }
        v += s[i++];
      }
      res.push(v);
      while (i < n && s[i] !== ',') i++;
      i++;
    } else {
      const k = s.indexOf(',', i);
      res.push(s.slice(i, k < 0 ? n : k));
      i = k < 0 ? n : k + 1;
    }
  }
  return res;
}

function toCommaText(lines) {
  return (lines || []).map((l) => '"' + String(l).replace(/"/g, '""') + '"').join(',');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&#60;').replace(/>/g, '&#62;').replace(/"/g, '&#34;')
    .replace(/\n/g, '&#10;').replace(/\r/g, '').replace(/\t/g, '&#9;');
}

/* ------------------------------ Einlesen -------------------------------- */
function common(x, el) {
  const comment = parseCommaText(x.attrs.comment).filter((l, i, a) => a.length > 1 || l);
  if (comment.length) el.comment = comment;
  if (x.attrs.color && !/^ffffff$/i.test(x.attrs.color)) el.color = x.attrs.color.toLowerCase();
  if (x.attrs.disabled === '1' || x.attrs.disabled === 'true') el.disabled = true;
  return el;
}

function child(x, name) { return x.children.find((c) => c.name === name); }

function readSeq(container) {
  const out = [];
  if (!container) return out;
  for (const c of container.children) out.push(...readElement(c));
  return out;
}

function readElement(x) {
  const text = parseCommaText(x.attrs.text);
  switch (x.name) {
    case 'instruction': return [common(x, mk.instruction(text))];
    case 'call': return [common(x, mk.call(text))];
    case 'jump': return [common(x, mk.jump(text))];
    case 'alternative': return [common(x, mk.alternative(text, readSeq(child(x, 'qTrue')), readSeq(child(x, 'qFalse'))))];
    case 'case': {
      const branches = x.children.filter((c) => c.name === 'qCase').map(readSeq);
      const labels = text.slice(1);
      while (labels.length < branches.length) labels.push('');
      while (branches.length < labels.length) branches.push([]);
      return [common(x, mk.case(text[0] || '', labels, branches))];
    }
    case 'for': return [common(x, mk.for(text, readSeq(child(x, 'qFor'))))];
    case 'while': return [common(x, mk.while(text, readSeq(child(x, 'qWhile'))))];
    case 'repeat': return [common(x, mk.repeat(text, readSeq(child(x, 'qRepeat'))))];
    case 'forever': return [common(x, mk.forever(readSeq(child(x, 'qForever'))))];
    case 'try': return [common(x, mk.try(text.length && text.some((l) => l.trim()) ? text : [t('core.defErrorVar')], readSeq(child(x, 'qTry')), readSeq(child(x, 'qCatch')), readSeq(child(x, 'qFinally'))))];
    case 'parallel': {
      let paras = x.children.filter((c) => c.name === 'qPara');
      if (paras.length === 1 && paras[0].children.every((c) => c.name === 'qPara')) paras = paras[0].children;
      return [common(x, mk.parallel(paras.map(readSeq)))];
    }
    default:
      return [mk.instruction(t('nsd.unknownEl', x.name))];
  }
}

function readRoot(x) {
  const r = mk.root(parseCommaText(x.attrs.text), x.attrs.type === 'sub' ? 'sub' : x.attrs.type === 'includable' ? 'includable' : 'program', readSeq(child(x, 'children')));
  const comment = parseCommaText(x.attrs.comment).filter((l, i, a) => a.length > 1 || l);
  r.comment = comment;
  const meta = {};
  for (const k of ['author', 'created']) if (x.attrs[k]) meta[k] = x.attrs[k];
  if (Object.keys(meta).length) r.meta = meta;
  if (x.attrs.color && !/^ffffff$/i.test(x.attrs.color)) r.color = x.attrs.color.toLowerCase();
  // eingebundene Diagramme (Structorizer: Includable-Diagramme mit Konstanten, Typen, Variablen)
  if (x.attrs.includeList) r.includeList = x.attrs.includeList.split(',').map((t) => t.trim()).filter(Boolean);
  return r;
}

/**
 * Zeile (0-basiert) jedes Elements in der .nsd-Datei – für die zeilenbasierten Haltepunkte von VS Code.
 * Liefert { pathToLine, lineToPath } mit Pfaden wie im Modell (roots/0/children/2, …/qTrue/0, …/branches/1/0).
 * Beginnen mehrere Elemente in derselben Zeile, gilt das erste.
 */
function elementLines(text) {
  const pathToLine = new Map(), lineToPath = new Map();
  if (!text || !text.trim()) return { pathToLine, lineToPath };
  const nl = [];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) nl.push(i);
  const lineOf = (pos) => { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < pos) lo = m + 1; else hi = m; } return lo; };
  const note = (path, x) => {
    const line = lineOf(x.pos);
    pathToLine.set(path, line);
    if (!lineToPath.has(line)) lineToPath.set(line, path);
  };
  const seq = (container, base) => {
    if (!container) return;
    container.children.forEach((c, k) => element(c, `${base}/${k}`));
  };
  const element = (x, path) => {
    note(path, x);
    switch (x.name) {
      case 'alternative': seq(child(x, 'qTrue'), path + '/qTrue'); seq(child(x, 'qFalse'), path + '/qFalse'); break;
      case 'case': x.children.filter((c) => c.name === 'qCase').forEach((c, k) => seq(c, `${path}/branches/${k}`)); break;
      case 'for': seq(child(x, 'qFor'), path + '/body'); break;
      case 'while': seq(child(x, 'qWhile'), path + '/body'); break;
      case 'repeat': seq(child(x, 'qRepeat'), path + '/body'); break;
      case 'forever': seq(child(x, 'qForever'), path + '/body'); break;
      case 'try': seq(child(x, 'qTry'), path + '/qTry'); seq(child(x, 'qCatch'), path + '/qCatch'); seq(child(x, 'qFinally'), path + '/qFinally'); break;
      case 'parallel': {
        let paras = x.children.filter((c) => c.name === 'qPara');
        if (paras.length === 1 && paras[0].children.every((c) => c.name === 'qPara')) paras = paras[0].children;
        paras.forEach((c, k) => seq(c, `${path}/branches/${k}`));
        break;
      }
      default: break;
    }
  };
  const doc = parseXml(text);
  const top = doc.children.find((c) => c.name === 'root' || c.name === 'roots');
  if (!top) return { pathToLine, lineToPath };
  const roots = top.name === 'root' ? [top] : top.children.filter((c) => c.name === 'root');
  roots.forEach((r, i) => { note(`roots/${i}`, r); seq(child(r, 'children'), `roots/${i}/children`); });
  return { pathToLine, lineToPath };
}

/** XML-Text -> Dokument {roots} */
function fromNsd(text) {
  if (!text || !text.trim()) return { roots: [] };
  const doc = parseXml(text);
  const top = doc.children.find((c) => c.name === 'root' || c.name === 'roots');
  if (!top) throw new Error(t('nsd.noRoot'));
  // immer Structorizer-Schreibweise (x := 5, if x = 0) – auch für Dateien älterer Versionen
  if (top.name === 'root') return normalize({ roots: [readRoot(top)] });
  return normalize({ roots: top.children.filter((c) => c.name === 'root').map(readRoot) });
}

/* ------------------------------ Schreiben ------------------------------- */
function attrs(el, extra = '') {
  const color = el.color || 'ffffff';
  return `text="${escAttr(toCommaText(el.text || []))}" comment="${escAttr(toCommaText(el.comment && el.comment.length ? el.comment : ['']))}" color="${color}"${extra} disabled="${el.disabled ? 1 : 0}"`;
}

function writeSeq(seq, ind) {
  return seq.map((el) => writeElement(el, ind)).join('');
}

function writeElement(el, ind) {
  const I = ind + '\t';
  switch (el.type) {
    case 'instruction': return `${ind}<instruction ${attrs(el, ' rotated="0"')}></instruction>\n`;
    case 'call': return `${ind}<call ${attrs(el)}></call>\n`;
    case 'jump': return `${ind}<jump ${attrs(el)}></jump>\n`;
    case 'alternative':
      return `${ind}<alternative ${attrs(el)}>\n${I}<qTrue>\n${writeSeq(el.qTrue, I + '\t')}${I}</qTrue>\n${I}<qFalse>\n${writeSeq(el.qFalse, I + '\t')}${I}</qFalse>\n${ind}</alternative>\n`;
    case 'case':
      return `${ind}<case ${attrs(el)}>\n${el.branches.map((b) => `${I}<qCase>\n${writeSeq(b, I + '\t')}${I}</qCase>\n`).join('')}${ind}</case>\n`;
    case 'for': {
      const P = require('./pseudo');
      const f = P.parseForText((el.text || []).join(' '));
      let extra = ' style="FREETEXT"';
      if (f && f.kind === 'count') extra = ` counterVar="${escAttr(f.var)}" startValue="${escAttr(f.start)}" endValue="${escAttr(f.end)}" stepConst="${escAttr(f.step)}" style="COUNTER"`;
      else if (f && f.kind === 'each') extra = ` counterVar="${escAttr(f.var)}" startValue="" stepConst="" style="TRAVERSAL" insep="in"`;
      return `${ind}<for ${attrs(el, extra)}>\n${I}<qFor>\n${writeSeq(el.body, I + '\t')}${I}</qFor>\n${ind}</for>\n`;
    }
    case 'try':
      return `${ind}<try ${attrs(el)}>\n` +
        `${I}<qTry>\n${writeSeq(el.qTry, I + '\t')}${I}</qTry>\n` +
        `${I}<qCatch>\n${writeSeq(el.qCatch, I + '\t')}${I}</qCatch>\n` +
        `${I}<qFinally>\n${writeSeq(el.qFinally, I + '\t')}${I}</qFinally>\n` +
        `${ind}</try>\n`;
    case 'while': return `${ind}<while ${attrs(el)}>\n${I}<qWhile>\n${writeSeq(el.body, I + '\t')}${I}</qWhile>\n${ind}</while>\n`;
    case 'repeat': return `${ind}<repeat ${attrs(el)}>\n${I}<qRepeat>\n${writeSeq(el.body, I + '\t')}${I}</qRepeat>\n${ind}</repeat>\n`;
    case 'forever': return `${ind}<forever comment="${escAttr(toCommaText(el.comment && el.comment.length ? el.comment : ['']))}" color="${el.color || 'ffffff'}" disabled="${el.disabled ? 1 : 0}">\n${I}<qForever>\n${writeSeq(el.body, I + '\t')}${I}</qForever>\n${ind}</forever>\n`;
    case 'parallel':
      return `${ind}<parallel ${attrs({ ...el, text: [String(el.branches.length)] })}>\n${I}<qPara>\n${el.branches.map((b) => `${I}\t<qPara>\n${writeSeq(b, I + '\t\t')}${I}\t</qPara>\n`).join('')}${I}</qPara>\n${ind}</parallel>\n`;
    default: return '';
  }
}

function isoNow() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function writeRoot(r, ind, withNs) {
  const ns = withNs ? ' xmlns:nsd="https://structorizer.fisch.lu" version="3.32" preRepeat="until " postFor="to" preReturn="return" postForIn="in" preWhile="while " output="OUTPUT" input="INPUT" preFor="for" preExit="exit" preLeave="leave" ignoreCase="true" preThrow="throw" preForIn="foreach" stepFor="by"' : '';
  const m = r.meta || {};
  const meta = ` author="${escAttr(m.author || '')}" created="${escAttr(m.created || isoNow())}" changedby="" changed="${isoNow()}" origin="Struktograf (VS Code)"`;
  const inc = r.includeList && r.includeList.length ? ` includeList="${escAttr(r.includeList.join(','))}"` : '';
  return `${ind}<root${ns}${meta} text="${escAttr(toCommaText(r.text || ['']))}" comment="${escAttr(toCommaText(r.comment && r.comment.length ? r.comment : ['']))}" color="${r.color || 'ffffff'}" type="${r.rootType || 'program'}"${inc} style="nice">\n${ind}\t<children>\n${writeSeq(r.children || [], ind + '\t\t')}${ind}\t</children>\n${ind}</root>\n`;
}

/** Dokument -> XML-Text */
function toNsd(doc) {
  doc = normalize(clone(doc));
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n';
  if (doc.roots.length === 1) return head + writeRoot(doc.roots[0], '', true);
  return head + '<roots xmlns:nsd="https://structorizer.fisch.lu">\n' + doc.roots.map((r) => writeRoot(r, '\t', true)).join('') + '</roots>\n';
}

/** Einzelnes Diagramm als eigenständige Structorizer-Datei */
function rootToNsd(root) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + writeRoot(normalize({ roots: [clone(root)] }).roots[0], '', true);
}

module.exports = { fromNsd, toNsd, rootToNsd, parseCommaText, toCommaText, parseXml, elementLines };
