'use strict';
/**
 * Bearbeitungsoperationen auf dem Dokument. Pfade sind JSON-Pfade,
 * z.B. "roots/0/children/2/qTrue/0"; leere Folgen: "roots/0/children/2/qTrue/#".
 */
const { defaultElement, clone, mk, toLines } = require('./model');
const { t } = require('../i18n');

function segs(path) {
  return String(path).split('/').filter((s) => s !== '').map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : s));
}

function get(doc, path) {
  let cur = doc;
  for (const s of segs(path)) {
    if (s === '#') return cur;
    if (cur == null) return undefined;
    cur = cur[s];
  }
  return cur;
}

/** Container-Array + Index eines Pfades */
function locate(doc, path) {
  const sg = segs(path);
  const last = sg[sg.length - 1];
  if (last === '#') return { arr: get(doc, sg.slice(0, -1).join('/')), index: 0, empty: true, base: sg.slice(0, -1).join('/') };
  if (typeof last === 'number') return { arr: get(doc, sg.slice(0, -1).join('/')), index: last, empty: false, base: sg.slice(0, -1).join('/') };
  return null;
}

function isRootPath(path) { return /^roots\/\d+$/.test(path); }

/**
 * Element einfügen.
 * @param where 'after' | 'before'
 * @returns neuer Pfad
 */
function insert(doc, path, element, where = 'after') {
  if (!path) path = doc.roots.length ? 'roots/0' : null;
  if (!path) { doc.roots.push(mk.root(t('core.mainProgram'), 'program', [])); path = 'roots/0'; }
  if (isRootPath(path)) {
    const root = get(doc, path);
    if (where === 'before') { root.children.unshift(element); return `${path}/children/0`; }
    root.children.push(element);
    return `${path}/children/${root.children.length - 1}`;
  }
  const loc = locate(doc, path);
  if (!loc || !Array.isArray(loc.arr)) throw new Error(t('edit.badPosition'));
  if (loc.empty) { loc.arr.push(element); return `${loc.base}/${loc.arr.length - 1}`; }
  const idx = where === 'before' ? loc.index : loc.index + 1;
  loc.arr.splice(idx, 0, element);
  return `${loc.base}/${idx}`;
}

function remove(doc, path) {
  if (isRootPath(path)) {
    const i = segs(path)[1];
    doc.roots.splice(i, 1);
    return doc.roots.length ? `roots/${Math.min(i, doc.roots.length - 1)}` : null;
  }
  const loc = locate(doc, path);
  if (!loc || loc.empty) return path;
  loc.arr.splice(loc.index, 1);
  if (!loc.arr.length) return `${loc.base}/#`;
  return `${loc.base}/${Math.min(loc.index, loc.arr.length - 1)}`;
}

function move(doc, path, dir) {
  if (isRootPath(path)) {
    const i = segs(path)[1];
    const j = i + dir;
    if (j < 0 || j >= doc.roots.length) return path;
    [doc.roots[i], doc.roots[j]] = [doc.roots[j], doc.roots[i]];
    return `roots/${j}`;
  }
  const loc = locate(doc, path);
  if (!loc || loc.empty) return path;
  const j = loc.index + dir;
  if (j < 0 || j >= loc.arr.length) return path;
  [loc.arr[loc.index], loc.arr[j]] = [loc.arr[j], loc.arr[loc.index]];
  return `${loc.base}/${j}`;
}

/** Text/Kommentar/Farbe/Typ eines Elements setzen */
function update(doc, path, props) {
  const el = get(doc, path);
  if (!el || typeof el !== 'object' || Array.isArray(el)) throw new Error(t('edit.notFound'));
  if (props.text != null) {
    const lines = toLines(props.text);
    if (el.type === 'case') {
      // Anzahl der Zweige an die Zahl der Marken anpassen
      // neue Zweige vor dem default-Zweig einfügen, beim Entfernen zuerst leere Zweige löschen
      const nBranches = Math.max(1, lines.length - 1);
      while (el.branches.length < nBranches) el.branches.splice(Math.max(0, el.branches.length - 1), 0, []);
      while (el.branches.length > nBranches) {
        let idx = -1;
        for (let k = el.branches.length - 2; k >= 0; k--) if (!el.branches[k].length) { idx = k; break; }
        if (idx < 0) idx = el.branches.length - 2;
        const [removed] = el.branches.splice(idx, 1);
        if (removed.length) el.branches[el.branches.length - 1].unshift(...removed); // nichts geht verloren
      }
    }
    if (el.type === 'parallel') {
      const n = Math.max(1, parseInt(lines[0], 10) || el.branches.length);
      while (el.branches.length < n) el.branches.push([]);
      while (el.branches.length > n && !el.branches[el.branches.length - 1].length) el.branches.pop();
      el.text = [];
    } else el.text = lines;
  }
  if (props.comment != null) {
    const c = toLines(props.comment);
    if (c.some((l) => l.trim())) el.comment = c; else delete el.comment;
  }
  if (props.color !== undefined) {
    const c = String(props.color || '').replace(/^#/, '').toLowerCase();
    if (c && c !== 'ffffff') el.color = c; else delete el.color;
  }
  if (props.disabled !== undefined && el.type !== 'root') { if (props.disabled) el.disabled = true; else delete el.disabled; }
  if (props.rootType && el.type === 'root') el.rootType = props.rootType;
  return path;
}

/** Element in eine Schleife/Verzweigung einpacken */
function wrap(doc, path, kind) {
  const loc = locate(doc, path);
  if (!loc || loc.empty) return path;
  const el = loc.arr[loc.index];
  const w = defaultElement(kind);
  if (w.body) w.body.push(el);
  else if (w.qTrue) w.qTrue.push(el);
  else if (w.qTry) w.qTry.push(el);
  else return path;
  loc.arr[loc.index] = w;
  return `${loc.base}/${loc.index}`;
}

/**
 * Elementtyp wechseln. Nichts geht verloren: enthaltene Elemente wandern in den ersten Block des neuen
 * Elements; wird ein Container zu einer einfachen Anweisung, stehen sie danach direkt dahinter.
 * Bedingungen werden übernommen (while c -> repeat until not c und umgekehrt).
 */
function changeType(doc, path, kind, props) {
  if (props) update(doc, path, props);
  const loc = locate(doc, path);
  if (!loc || loc.empty || !Array.isArray(loc.arr)) return path;
  const old = loc.arr[loc.index];
  if (!old || old.type === kind) return path;
  const P = require('./pseudo');
  const { sequencesOf } = require('./model');
  const SIMPLE = ['instruction', 'call', 'jump'];
  const nw = defaultElement(kind);
  for (const k of ['comment', 'color', 'disabled']) if (old[k] !== undefined) nw[k] = clone(old[k]);
  const seqs = sequencesOf(old).map((s) => s.seq);
  const kids = [].concat(...seqs);
  const lines = (old.text || []).map(String).filter((l) => l.trim());
  // Bedingung bzw. Ausdruck des alten Elements
  let cond = null;
  if (old.type === 'alternative') cond = lines.join(' ');
  else if (old.type === 'while') cond = P.stripKeyword(lines.join(' '), ['while', 'solange']);
  else if (old.type === 'repeat') cond = P.stripKeyword(lines.join(' '), ['until', 'bis']);
  else if (old.type === 'case') cond = lines[0] || null;
  else if (SIMPLE.includes(old.type) && lines.length === 1) cond = lines[0];
  switch (kind) {
    case 'instruction': case 'call': case 'jump':
      if (SIMPLE.includes(old.type) || old.type === 'for') nw.text = old.text.slice();
      else if (cond) nw.text = [cond];
      loc.arr.splice(loc.index, 1, nw, ...kids);
      return path;
    case 'alternative':
      if (cond) nw.text = [old.type === 'repeat' ? P.negateCond(cond) : cond];
      nw.qTrue = seqs[0] ? seqs[0] : [];
      nw.qFalse = [].concat(...seqs.slice(1));
      break;
    case 'case':
      if (cond) nw.text[0] = cond;
      if (old.type === 'alternative') {
        // "if note = 1" -> case note, Fall 1
        const { findTop, joinTokens } = require('./tokenizer');
        const t = P.ptoks(cond || '');
        const k = findTop(t, (x) => x.v === '=' || x.v === '==');
        const disc = k > 0 ? joinTokens(t.slice(0, k)) : nw.text[0];
        const val = k > 0 ? joinTokens(t.slice(k + 1)) : '1';
        nw.text = [disc, val, 'default'];
        nw.branches = [old.qTrue, old.qFalse];
      }
      else nw.branches[0] = kids;
      break;
    case 'while':
      if (old.type === 'repeat' && cond) nw.text = ['while ' + P.negateCond(cond)];
      else if (cond) nw.text = ['while ' + cond];
      nw.body = kids;
      break;
    case 'repeat':
      if (old.type === 'while' && cond) nw.text = ['until ' + P.negateCond(cond)];
      else if (cond) nw.text = ['until ' + cond];
      nw.body = kids;
      break;
    case 'for': case 'foreach': case 'forever':
      nw.body = kids;
      break;
    case 'try': nw.qTry = kids; break;
    case 'parallel': nw.branches[0] = kids; break;
    default: break;
  }
  loc.arr[loc.index] = nw;
  return path;
}

/** Pfad eines Objekts (Element, Root oder Folge) suchen */
function findPath(doc, obj) {
  const { sequencesOf } = require('./model');
  const visitSeq = (seq, path) => {
    if (seq === obj) return path + '/#';
    for (let i = 0; i < seq.length; i++) {
      const p = visitEl(seq[i], `${path}/${i}`);
      if (p) return p;
    }
    return null;
  };
  const visitEl = (el, path) => {
    if (el === obj) return path;
    for (const s of sequencesOf(el)) { const p = visitSeq(s.seq, `${path}/${s.key}`); if (p) return p; }
    return null;
  };
  for (let i = 0; i < doc.roots.length; i++) { const p = visitEl(doc.roots[i], `roots/${i}`); if (p) return p; }
  return null;
}

/** Element per Drag & Drop verschieben */
function moveTo(doc, from, to, where) {
  if (!from || !to || to === from || to.startsWith(from + '/') || isRootPath(from)) return from;
  const loc = locate(doc, from);
  if (!loc || loc.empty) return from;
  const el = loc.arr[loc.index];
  const tsg = segs(to);
  const target = tsg[tsg.length - 1] === '#' ? get(doc, tsg.slice(0, -1).join('/')) : get(doc, to);
  if (!target) return from;
  loc.arr.splice(loc.index, 1);
  let tp = findPath(doc, target);
  if (!tp) { loc.arr.splice(loc.index, 0, el); return from; }
  if (tsg[tsg.length - 1] !== '#' && tp.endsWith('/#')) tp = tp.slice(0, -2);
  return insert(doc, tp, el, where);
}

/**
 * Operation anwenden (verändert doc). Rückgabe: neuer Auswahlpfad.
 * op: {op:'insert', path, kind|element, where} | {op:'delete', path} | {op:'move', path, dir}
 *     {op:'update', path, text, comment, color, rootType} | {op:'paste', path, element, where}
 *     {op:'addRoot', rootType} | {op:'wrap', path, kind}
 */
function apply(doc, cmd) {
  switch (cmd.op) {
    case 'insert': return insert(doc, cmd.path, cmd.element ? clone(cmd.element) : defaultElement(cmd.kind), cmd.where);
    case 'paste': return insert(doc, cmd.path, clone(cmd.element), cmd.where);
    case 'delete': return remove(doc, cmd.path);
    case 'move': return move(doc, cmd.path, cmd.dir);
    case 'update': return update(doc, cmd.path, cmd);
    case 'wrap': return wrap(doc, cmd.path, cmd.kind);
    case 'changeType': return changeType(doc, cmd.path, cmd.kind, cmd.props);
    case 'moveTo': return moveTo(doc, cmd.from, cmd.to, cmd.where);
    case 'addRoot': {
      const sub = cmd.rootType === 'sub';
      doc.roots.push(mk.root(sub ? t('core.defSub') : t('core.mainProgram'), sub ? 'sub' : 'program', []));
      return `roots/${doc.roots.length - 1}`;
    }
    default: throw new Error('Unbekannte Operation: ' + cmd.op);
  }
}

module.exports = { apply, get, segs, findPath };
