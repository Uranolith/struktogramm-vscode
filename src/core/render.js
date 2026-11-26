'use strict';
/**
 * Layout + Darstellung als SVG (klassischer Nassi-Shneiderman-Stil).
 * Monospace-Schrift -> Textbreiten sind ohne Browser berechenbar,
 * dadurch funktioniert das Rendern auch im Extension-Host (SVG-Export).
 */

const FS = 14;          // Schriftgröße
const CW = FS * 0.6;    // Zeichenbreite (Courier/Consolas)
const LH = 18;          // Zeilenhöhe
const PAD = 7;          // horizontaler Textabstand
const VPAD = 5;         // vertikaler Textabstand
const BAR = 22;         // Breite des Schleifenbalkens
const CALL_INSET = 7;
const NOTCH = 12;
const INSET = 10;       // Rand im Diagrammrahmen
const EMPTY_W = 44;
const FOOT = 10;

const PRETTY = [[/<-/g, '←'], [/<>/g, '≠'], [/!=/g, '≠'], [/<=/g, '≤'], [/>=/g, '≥']];

// Syntaxhervorhebung: Schlüsselwörter, Datentypen, Zeichenketten.
// Schlüsselwörter hängen vom Zusammenhang ab, damit gleichnamige Variablen (by, to, step, in, new …) Variablen bleiben:
//  - Operatorwörter überall
//  - Anweisungswörter nur am Zeilenanfang
//  - Kontextwörter nur an ihrer Stelle (to/by/step im Zählschleifenkopf – gelesen wie von Interpreter und Generator)
//  - vor einer Zuweisung (by := 5) ist jedes Wort eine Variable
const P = require('./pseudo');
const OPWORDS = new Set(['and', 'or', 'not', 'xor', 'shl', 'shr', 'true', 'false']);
const STARTERS = new Set(['input', 'output', 'var', 'dim', 'const', 'for', 'foreach', 'while', 'until', 'repeat', 'if', 'else',
  'return', 'exit', 'leave', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'type']);
const CONTEXT_WORDS = new Set(['to', 'downto', 'by', 'step', 'in', 'each', 'of', 'do', 'then', 'as', 'record', 'struct', 'enum', 'new']);
const nows = (x) => String(x || '').replace(/\s+/g, '');
function isKeyword(str, word, index) {
  const lw = word.toLowerCase();
  const after = str.slice(index + word.length);
  if (/^\s*(:=|<-|←)/.test(after)) return false; // Zuweisungsziel: Variable
  if (OPWORDS.has(lw)) return true;
  const before = str.slice(0, index);
  if (STARTERS.has(lw)) return !before.trim() || (lw === 'for' && /^\s*$/.test(before));
  if (!CONTEXT_WORDS.has(lw)) return false;
  const head = ((/^\s*([\p{L}_][\p{L}\p{N}_]*)/u.exec(str) || [])[1] || '').toLowerCase();
  const code = before.replace(/"[^"]*"|'[^']*'/g, '');
  switch (lw) {
    case 'to': case 'downto': {
      // das erste to/downto nach der Zuweisung im Zählschleifenkopf
      const f = P.parseForText(str);
      return !!f && f.kind === 'count' && /(:=|<-|←|=)/.test(code) && !/\b(to|downto|bis)\b/i.test(code.replace(/^\s*\S+/, ''));
    }
    case 'by': case 'step': {
      const f = P.parseForText(str);
      return !!f && f.kind === 'count' && nows(after) !== '' && nows(after) === nows(f.step);
    }
    case 'in': case 'of': {
      const f = P.parseForText(str);
      return !!f && f.kind === 'each' && nows(after) === nows(f.coll);
    }
    case 'each': return (head === 'for' || head === 'für') && /^\s*\S+\s*$/.test(before);
    case 'do': return !after.trim() && ['while', 'for', 'foreach', 'solange'].includes(head);
    case 'then': return !after.trim() && ['if', 'wenn'].includes(head);
    case 'as': return ['var', 'dim', 'const'].includes(head);
    case 'record': case 'struct': case 'enum': return head === 'type';
    case 'new': return /^\s*[\p{L}_][\p{L}\p{N}_]*\s*\[/u.test(after);
    default: return false;
  }
}
const TYPES = new Set(['int', 'integer', 'long', 'short', 'byte', 'double', 'float', 'real', 'string', 'char', 'bool',
  'boolean', 'void', 'array', 'of']);
// Gruppen: 1 String, 2 Wort, 3 Operator (längste zuerst; auch die „hübschen“ Zeichen ← ≠ ≤ ≥)
const TOKEN_RE = /("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|([\p{L}_][\p{L}\p{N}_]*)|(<-|:=|==|!=|<>|<=|>=|\+=|-=|\*=|\/=|[=<>←≠≤≥+\-*/%])/gu;
const ARITH_WORDS = new Set(['div', 'mod']);

/* Typen an ihrer Stelle erkennen (auch eigene wie Punkt): Deklarationen und Signaturen von Unterprogrammen */
const { tokenize } = require('./tokenizer');
const OPEN_B = new Set(['(', '[', '{']), CLOSE_B = new Set([')', ']', '}']);
const tokAt = (str) => { try { return tokenize(str, 'pseudo'); } catch (e) { return null; } };
const isOpT = (t, ...v) => t && t.t === 'op' && v.includes(t.v);

/** Typ in einer Deklaration: „var a, b: Typ := …“, „var x as Typ“, „Typ name = …“ -> [[start, end]] */
function declTypeRanges(str) {
  const ts = tokAt(str);
  if (!ts || ts.length < 2 || ts[0].t !== 'id') return [];
  if (['var', 'dim', 'const'].includes(ts[0].v.toLowerCase())) {
    let depth = 0;
    for (let i = 1; i < ts.length; i++) {
      const t = ts[i];
      if (isOpT(t, ...OPEN_B)) depth++;
      else if (isOpT(t, ...CLOSE_B)) depth--;
      else if (depth === 0 && isOpT(t, ':=', '=', '<-')) return [];
      else if (depth === 0 && (isOpT(t, ':') || (t.t === 'id' && t.v.toLowerCase() === 'as'))) {
        let end = i + 1;
        while (end < ts.length && !isOpT(ts[end], ':=', '=', '<-')) end++;
        return end > i + 1 ? [[ts[i + 1].start, ts[end - 1].end]] : [];
      }
    }
    return [];
  }
  const c = P.classifyLine(str); // C-Stil: int x = 5
  if (c.kind !== 'decl' || !c.type || !c.decls.length || !c.decls.every((d) => 'suffix' in d)) return [];
  const k = ts.findIndex((t, i) => i > 0 && t.t === 'id' && t.v === c.decls[0].name);
  return k > 0 ? [[ts[0].start, ts[k - 1].end]] : [];
}

/** Typen in einer Signatur: „fib(n: int, a: Punkt): int“, „int summe(int a, int b)“ -> [[start, end], …] */
function sigTypeRanges(str) {
  const ts = tokAt(str);
  if (!ts) return [];
  const open = ts.findIndex((t) => isOpT(t, '('));
  if (open < 1) return [];
  let depth = 0, close = -1;
  for (let i = open; i < ts.length; i++) {
    if (isOpT(ts[i], ...OPEN_B)) depth++;
    else if (isOpT(ts[i], ...CLOSE_B) && --depth === 0) { close = i; break; }
  }
  if (close < 0) return [];
  const R = [];
  let seg = [];
  const flush = () => {
    if (!seg.length) return;
    const ci = seg.findIndex((t) => isOpT(t, ':'));
    if (ci >= 0) { if (ci < seg.length - 1) R.push([seg[ci + 1].start, seg[seg.length - 1].end]); }
    else {
      const ids = seg.filter((t) => t.t === 'id');
      const li = seg.lastIndexOf(ids[ids.length - 1]);
      if (ids.length >= 2 && li > 0) R.push([seg[0].start, seg[li - 1].end]); // C-Stil: int a
    }
    seg = [];
  };
  depth = 0;
  for (let i = open + 1; i < close; i++) {
    const t = ts[i];
    if (isOpT(t, ...OPEN_B)) depth++;
    else if (isOpT(t, ...CLOSE_B)) depth--;
    if (depth === 0 && isOpT(t, ',')) { flush(); continue; }
    seg.push(t);
  }
  flush();
  const after = ts.slice(close + 1);
  if (after.length >= 2 && isOpT(after[0], ':')) R.push([after[1].start, after[after.length - 1].end]);
  // C-Stil: Rückgabetyp vor dem Namen
  const pre = ts.slice(0, open - 1).filter((t) => t.t === 'id' && !/^(function|procedure|sub|def|func|funktion|prozedur)$/i.test(t.v));
  if (pre.length) R.push([pre[0].start, ts[open - 2].end]);
  return R;
}

/** Name eines Unterprogramms im Kopf: „fib(…)“ bzw. ohne Klammern das einzelne Wort -> [[start, end]] */
function sigNameRange(str) {
  const ts = tokAt(str);
  if (!ts || !ts.length) return [];
  const open = ts.findIndex((t) => isOpT(t, '('));
  if (open >= 1 && ts[open - 1].t === 'id') return [[ts[open - 1].start, ts[open - 1].end]];
  if (open < 0 && ts.length === 1 && ts[0].t === 'id') return [[ts[0].start, ts[0].end]];
  return [];
}

/** Kopf eines Unterprogramms: Name in der Farbe für Funktionen, Typen farbig, der Rest wie die Überschrift */
function highlightTypes(str, ranges, nameRanges = []) {
  let out = '', pos = 0, m;
  const WORD = /[\p{L}_][\p{L}\p{N}_]*/gu;
  while ((m = WORD.exec(str))) {
    const inName = nameRanges.some(([a, b]) => m.index >= a && m.index < b);
    if (!inName && !ranges.some(([a, b]) => m.index >= a && m.index < b)) continue;
    out += esc(str.slice(pos, m.index)) + `<tspan class="${inName ? 'hf' : 'ht'}">${esc(m[0])}</tspan>`;
    pos = m.index + m[0].length;
  }
  return out + esc(str.slice(pos));
}

/** Zuweisungs-, Vergleichs- und Rechenoperatoren bekommen alle dieselbe Farbe (.ho) */
function highlight(str) {
  let out = '', pos = 0, m;
  const typeRanges = declTypeRanges(str);
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(str))) {
    let cls = null;
    if (m[1]) cls = 'hs';
    else if (m[2] && typeRanges.some(([a, b]) => m.index >= a && m.index < b)) cls = 'ht';
    else if (m[3]) cls = 'ho';
    else if (ARITH_WORDS.has(m[2].toLowerCase())) cls = 'ho';
    else if (isKeyword(str, m[2], m.index)) cls = 'hk';
    else if (/^\s*\(/.test(str.slice(m.index + m[0].length))) cls = 'hf'; // Funktionsaufruf name(…)
    else if (TYPES.has(m[2].toLowerCase())) cls = 'ht';
    if (!cls) continue;
    out += esc(str.slice(pos, m.index)) + `<tspan class="${cls}">${esc(m[0])}</tspan>`;
    pos = m.index + m[0].length;
  }
  return out + esc(str.slice(pos));
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Erstes Zuweisungszeichen (:= oder <-) einer Zuweisung, Deklaration oder Zählschleife als op anzeigen.
 * Vergleiche, Texte und andere Zeilen bleiben unverändert; beide Zeichen sind gleich lang.
 */
function assignAs(line, op, type) {
  const P = require('./pseudo');
  if (type !== 'for') {
    const c = P.classifyLine(line);
    if (c.kind !== 'assign' && c.kind !== 'decl') return line;
  }
  let toks;
  try { toks = require('./tokenizer').tokenize(line, 'pseudo'); } catch (e) { return line; }
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) depth++;
    else if (t.t === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) depth--;
    else if (depth === 0 && t.t === 'op' && (t.v === ':=' || t.v === '<-')) {
      return t.v === op ? line : line.slice(0, t.start) + op + line.slice(t.end);
    }
  }
  return line;
}

class Renderer {
  constructor(opts = {}) {
    this.opts = { trueLabel: require('../i18n').t('core.trueLabel'), falseLabel: require('../i18n').t('core.falseLabel'), pretty: true, highlight: true, theme: 'light', ...opts };
    this.themeName = this.opts.theme === 'dark' ? 'dark' : 'light';
    this.colors = THEMES[this.themeName];
    this.cache = new Map();
  }

  disp(lines, type) {
    let arr = (lines && lines.length ? lines : ['']).map((l) => String(l));
    // Zuweisung einheitlich anzeigen (Einstellung struktogramm.assignmentOperator) – nur die Anzeige, nicht die Datei
    const op = this.opts.assign;
    if ((op === ':=' || op === '<-') && ['instruction', 'call', 'jump', 'for'].includes(type)) arr = arr.map((l) => assignAs(l, op, type));
    if (!this.opts.pretty) return arr;
    return arr.map((l) => {
      // Operatoren außerhalb von Strings verschönern
      return l.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/).map((part, i) => {
        if (i % 2 === 1) return part;
        for (const [re, r] of PRETTY) part = part.replace(re, r);
        return part;
      }).join('');
    });
  }

  tw(lines) { return Math.max(...lines.map((l) => [...l].length), 0) * CW; }
  textW(lines) { return Math.ceil(this.tw(lines) + 2 * PAD); }
  textH(lines) { return Math.max(1, lines.length) * LH + 2 * VPAD; }
  get EMPTY_H() { return LH + 2 * VPAD; }

  /* ---------------------------- Messen ---------------------------- */
  seqSize(seq) {
    if (!seq.length) return { w: EMPTY_W, h: this.EMPTY_H };
    let w = 0, h = 0;
    for (const el of seq) { const s = this.size(el); w = Math.max(w, s.w); h += s.h; }
    return { w, h };
  }

  headerH(nLines) {
    const yb = VPAD + Math.max(1, nLines) * LH;
    return Math.max(yb + LH + VPAD, 2 * yb);
  }

  caseLayout(el) {
    const labels = el.text.slice(1);
    const n = el.branches.length;
    const hideDefault = n > 0 && String(labels[n - 1] == null ? '' : labels[n - 1]).trim() === '%';
    const cols = [];
    for (let k = 0; k < n; k++) {
      if (hideDefault && k === n - 1) continue;
      const lab = this.disp([labels[k] == null ? '' : labels[k]])[0];
      const s = this.seqSize(el.branches[k]);
      cols.push({ k, label: lab, w: Math.max(s.w, Math.ceil([...lab].length * CW * 0.86 + 2 * PAD), EMPTY_W), h: s.h, isDefault: !hideDefault && k === n - 1 });
    }
    return { cols, hideDefault };
  }

  size(el) {
    if (this.cache.has(el)) return this.cache.get(el);
    let s;
    const lines = this.disp(el.text, el.type);
    switch (el.type) {
      case 'instruction': s = { w: this.textW(lines), h: this.textH(lines) }; break;
      case 'call': s = { w: this.textW(lines) + 2 * CALL_INSET, h: this.textH(lines) }; break;
      case 'jump': s = { w: this.textW(lines) + NOTCH, h: this.textH(lines) }; break;
      case 'alternative': {
        const t = this.seqSize(el.qTrue), f = this.seqSize(el.qFalse);
        const H = this.headerH(lines.length);
        const labelsW = ([...this.opts.trueLabel].length + [...this.opts.falseLabel].length) * CW * 0.86 + 4 * PAD;
        s = { w: Math.ceil(Math.max(t.w + f.w, 2 * this.tw(lines) + 2 * PAD, labelsW)), h: H + Math.max(t.h, f.h), H };
        break;
      }
      case 'case': {
        const { cols, hideDefault } = this.caseLayout(el);
        const lns = this.disp([el.text[0] || '']);
        const base = this.headerH(lns.length);
        const sum = cols.reduce((a, c) => a + c.w, 0);
        const normal = cols.filter((c) => !c.isDefault);
        const xsW = normal.reduce((a, c) => a + c.w, 0) || 1;
        let H = base;
        const last = normal[normal.length - 1];
        if (last && normal.length > 1) H = Math.min(Math.max(base, ((LH + VPAD) * xsW) / last.w), base * 3);
        void hideDefault;
        s = { w: Math.ceil(Math.max(sum, 2 * this.tw(lns) + 2 * PAD)), h: H + Math.max(...cols.map((c) => c.h), this.EMPTY_H), H };
        break;
      }
      case 'for': case 'while': {
        const b = this.seqSize(el.body);
        s = { w: Math.max(this.textW(lines), BAR + b.w), h: this.textH(lines) + b.h };
        break;
      }
      case 'repeat': {
        const b = this.seqSize(el.body);
        s = { w: Math.max(this.textW(lines), BAR + b.w), h: this.textH(lines) + b.h };
        break;
      }
      case 'forever': {
        const b = this.seqSize(el.body);
        const ln = this.foreverText(el);
        s = { w: Math.max(this.textW(ln), BAR + b.w), h: this.textH(ln) + b.h + FOOT };
        break;
      }
      case 'try': {
        const a = this.seqSize(el.qTry || []), b = this.seqSize(el.qCatch || []), c = this.seqSize(el.qFinally || []);
        const hdr = this.textH(['try']);
        s = { w: Math.max(this.textW(this.tryHeads(el)), BAR + Math.max(a.w, b.w, c.w)), h: 3 * hdr + a.h + b.h + c.h + FOOT };
        break;
      }
      case 'parallel': {
        const cols = el.branches.map((b) => this.seqSize(b));
        s = { w: Math.max(cols.reduce((a, c) => a + c.w, 0), 80), h: 2 * LH + Math.max(...cols.map((c) => c.h), this.EMPTY_H) };
        break;
      }
      case 'root': {
        const b = this.seqSize(el.children);
        s = { w: Math.max(this.textW(lines) + 2 * INSET, b.w + 2 * INSET, 160), h: this.textH(lines) + b.h + INSET };
        break;
      }
      default: s = { w: this.textW(lines), h: this.textH(lines) };
    }
    this.cache.set(el, s);
    return s;
  }

  /** Kopfzeilen des TRY-Elements */
  tryHeads(el) {
    const v = String((el.text || [])[0] || '').trim();
    return ['try', 'catch' + (v ? ' ' + v : ''), 'finally'];
  }

  foreverText(el) {
    const t = (el.text || []).filter((l) => String(l).trim());
    return t.length ? this.disp(t) : [require('../i18n').t('render.endless')];
  }

  /* ---------------------------- Zeichnen ---------------------------- */
  rect(x, y, w, h, el, extra = '') {
    const c = this.colors;
    let fill = c.bg;
    if (el && el.disabled) fill = c.disabled;
    else if (el && el.color) fill = this.themeName === 'dark' ? darkTint(el.color, c.bg) : '#' + el.color;
    return `<rect class="bg" x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;
  }

  line(x1, y1, x2, y2, diag) {
    return `<line class="ln${diag ? ' dg' : ''}" x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}"/>`;
  }

  text(x, y, str, anchor = 'start', cls = '') {
    const hl = this.opts.highlight && !/\b(lbl|muted|title)\b/.test(cls);
    return `<text class="t${cls ? ' ' + cls : ''}" x="${r(x)}" y="${r(y)}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} xml:space="preserve">${hl ? highlight(str) : esc(str)}</text>`;
  }

  textBlock(lines, x, y, cls = '') {
    return lines.map((l, k) => this.text(x, y + VPAD + k * LH + LH * 0.74, l, 'start', cls)).join('');
  }

  open(el, path) {
    const cls = ['el', 'el-' + el.type];
    if (el.disabled) cls.push('disabled');
    const cm = (el.comment || []).filter((c) => String(c).trim());
    return `<g class="${cls.join(' ')}" data-path="${esc(path)}">` + (cm.length ? `<title>${esc(cm.join('\n'))}</title>` : '');
  }

  seq(seq, x, y, w, h, path, out) {
    if (!seq.length) {
      out.push(`<g class="el empty" data-path="${esc(path + '/#')}">`, this.rect(x, y, w, h, null), this.text(x + w / 2, y + VPAD + LH * 0.74, '∅', 'middle', 'muted'), '</g>');
      return;
    }
    // ist der Block höher als sein Inhalt (kürzerer Zweig einer Verzweigung, Fallauswahl oder Parallelverarbeitung),
    // wird das letzte Element auf die volle Höhe gestreckt – wie im Structorizer
    const total = seq.reduce((a, el) => a + this.size(el).h, 0);
    const extra = h > total ? h - total : 0;
    let cy = y;
    seq.forEach((el, i) => {
      const eh = this.size(el).h + (i === seq.length - 1 ? extra : 0);
      this.draw(el, x, cy, w, `${path}/${i}`, out, eh);
      cy += eh;
    });
  }

  /** Element zeichnen; hh = Höhe, falls es gestreckt wird (sonst seine eigene) */
  draw(el, x, y, w, path, out, hh) {
    const s = this.size(el);
    const h = hh > s.h ? hh : s.h;
    const lines = this.disp(el.text, el.type);
    out.push(this.open(el, path));
    const tcls = el.disabled ? 'muted' : '';
    switch (el.type) {
      case 'instruction':
        out.push(this.rect(x, y, w, h, el), this.textBlock(lines, x + PAD, y, tcls));
        break;
      case 'call':
        out.push(this.rect(x, y, w, h, el), this.line(x + CALL_INSET, y, x + CALL_INSET, y + h), this.line(x + w - CALL_INSET, y, x + w - CALL_INSET, y + h), this.textBlock(lines, x + CALL_INSET + PAD, y, tcls));
        break;
      case 'jump':
        out.push(this.rect(x, y, w, h, el), `<polyline class="ln dg" points="${r(x + NOTCH)},${r(y)} ${r(x + 1)},${r(y + h / 2)} ${r(x + NOTCH)},${r(y + h)}"/>`, this.textBlock(lines, x + NOTCH + PAD, y, tcls));
        break;
      case 'alternative': {
        const t = this.seqSize(el.qTrue), f = this.seqSize(el.qFalse);
        const H = s.H;
        const extra = w - (t.w + f.w);
        const wT = Math.round(t.w + extra / 2);
        const xs = x + wT;
        out.push(this.rect(x, y, w, h, el));
        out.push(this.line(x, y, xs, y + H, true), this.line(x + w, y, xs, y + H, true));
        lines.forEach((l, k) => {
          const yr = (VPAD + (k + 1) * LH) / H;
          const cx = x + (w + yr * (2 * wT - w)) / 2;
          out.push(this.text(cx, y + VPAD + k * LH + LH * 0.74, l, 'middle', 'halo ' + tcls));
        });
        out.push(this.text(x + PAD - 2, y + H - VPAD - 2, this.opts.trueLabel, 'start', 'lbl'), this.text(x + w - PAD + 2, y + H - VPAD - 2, this.opts.falseLabel, 'end', 'lbl'));
        const bh = h - H;
        this.seq(el.qTrue, x, y + H, wT, bh, path + '/qTrue', out);
        this.seq(el.qFalse, xs, y + H, w - wT, bh, path + '/qFalse', out);
        break;
      }
      case 'case': {
        const { cols } = this.caseLayout(el);
        const H = s.H;
        const minSum = cols.reduce((a, c) => a + c.w, 0);
        const add = cols.length ? (w - minSum) / cols.length : 0;
        let cx = x;
        const pos = cols.map((c, i) => { const cw = i === cols.length - 1 ? x + w - cx : Math.round(c.w + add); const p = { ...c, x: cx, w: cw }; cx += cw; return p; });
        const def = pos.find((p) => p.isDefault);
        const xs = def ? def.x : x + w;
        out.push(this.rect(x, y, w, h, el));
        out.push(this.line(x, y, xs, y + H, true));
        if (def) out.push(this.line(x + w, y, xs, y + H, true));
        // Trennlinien im Kopf
        pos.forEach((p, i) => {
          if (i === 0) return;
          const bx = p.x;
          let yl;
          if (bx <= xs) yl = y + (H * (bx - x)) / Math.max(1, xs - x);
          else yl = y + (H * (x + w - bx)) / Math.max(1, x + w - xs);
          out.push(this.line(bx, yl, bx, y + H));
        });
        const dl = this.disp([el.text[0] || '']);
        dl.forEach((l, k) => {
          const yr = (VPAD + (k + 1) * LH) / H;
          const left = x + (xs - x) * yr;
          const right = def ? x + w - (x + w - xs) * yr : x + w;
          out.push(this.text((left + right) / 2, y + VPAD + k * LH + LH * 0.74, l, 'middle', 'halo ' + tcls));
        });
        const bh = h - H;
        pos.forEach((p) => {
          if (p.isDefault) out.push(this.text(p.x + p.w - PAD + 2, y + H - VPAD - 2, p.label, 'end', 'lbl halo'));
          else out.push(this.text(p.x + PAD - 2, y + H - VPAD - 2, p.label, 'start', 'lbl halo'));
          this.seq(el.branches[p.k], p.x, y + H, p.w, bh, `${path}/branches/${p.k}`, out);
        });
        break;
      }
      case 'for': case 'while': {
        const hh = this.textH(lines);
        out.push(this.rect(x, y, w, h, el), this.textBlock(lines, x + PAD, y, tcls));
        this.seq(el.body, x + BAR, y + hh, w - BAR, h - hh, path + '/body', out);
        break;
      }
      case 'repeat': {
        const hh = this.textH(lines);
        out.push(this.rect(x, y, w, h, el), this.textBlock(lines, x + PAD, y + h - hh, tcls));
        this.seq(el.body, x + BAR, y, w - BAR, h - hh, path + '/body', out);
        break;
      }
      case 'forever': {
        const ln = this.foreverText(el);
        const hh = this.textH(ln);
        out.push(this.rect(x, y, w, h, el), this.textBlock(ln, x + PAD, y, el.text && el.text.some((t) => String(t).trim()) ? tcls : 'muted'));
        this.seq(el.body, x + BAR, y + hh, w - BAR, h - hh - FOOT, path + '/body', out);
        break;
      }
      case 'try': {
        const [tTry, tCatch, tFin] = this.tryHeads(el);
        const hdr = this.textH(['try']);
        const parts = [[tTry, el.qTry || [], '/qTry'], [tCatch, el.qCatch || [], '/qCatch'], [tFin, el.qFinally || [], '/qFinally']];
        out.push(this.rect(x, y, w, h, el));
        let cy = y;
        for (const [head, seq, key] of parts) {
          out.push(this.textBlock([head], x + PAD, cy, tcls));
          cy += hdr;
          const sh = key === '/qFinally' ? y + h - FOOT - cy : this.seqSize(seq).h;
          this.seq(seq, x + BAR, cy, w - BAR, sh, path + key, out);
          cy += sh;
        }
        break;
      }
      case 'parallel': {
        const cols = el.branches.map((b) => this.seqSize(b));
        const minSum = cols.reduce((a, c) => a + c.w, 0);
        const add = cols.length ? (w - minSum) / cols.length : 0;
        out.push(this.rect(x, y, w, h, el));
        out.push(this.line(x, y, x + LH, y + LH, true), this.line(x + w, y, x + w - LH, y + LH, true));
        out.push(this.line(x, y + h, x + LH, y + h - LH, true), this.line(x + w, y + h, x + w - LH, y + h - LH, true));
        out.push(this.text(x + w / 2, y + LH * 0.78, 'parallel', 'middle', 'lbl'));
        let cx = x;
        el.branches.forEach((b, i) => {
          const cw = i === cols.length - 1 ? x + w - cx : Math.round(cols[i].w + add);
          this.seq(b, cx, y + LH, cw, h - 2 * LH, `${path}/branches/${i}`, out);
          cx += cw;
        });
        break;
      }
      default:
        out.push(this.rect(x, y, w, h, el), this.textBlock(lines, x + PAD, y, tcls));
    }
    out.push('</g>');
  }

  root(root, x, y, w, path, out) {
    const s = this.size(root);
    const lines = this.disp(root.text);
    const hh = this.textH(lines);
    out.push(this.open(root, path));
    const rx = root.rootType === 'sub' ? ' rx="14" ry="14"' : root.rootType === 'includable' ? ' rx="4" ry="4"' : '';
    out.push(this.rect(x, y, w, s.h, root, rx));
    // Kopf: Parametertypen und Rückgabetyp farbig (fib(n: int): int); bei Unterprogrammen auch der Name
    const sub = root.rootType === 'sub';
    out.push(lines.map((l, k) => {
      const ty = this.opts.highlight ? sigTypeRanges(l) : [];
      const nm = this.opts.highlight && sub && k === 0 ? sigNameRange(l) : [];
      if (!ty.length && !nm.length) return this.text(x + PAD + 4, y + VPAD + k * LH + LH * 0.74, l, 'start', 'title');
      return `<text class="t title" x="${r(x + PAD + 4)}" y="${r(y + VPAD + k * LH + LH * 0.74)}" xml:space="preserve">${highlightTypes(l, ty, nm)}</text>`;
    }).join(''));
    out.push('</g>');
    this.seq(root.children, x + INSET, y + hh, w - 2 * INSET, s.h - hh - INSET, path + '/children', out);
  }
}

function r(v) { return Math.round(v * 10) / 10; }

/**
 * Farbschemata. Alle Textfarben haben auf dem Elementhintergrund mindestens 4,5:1 Kontrast
 * (auch auf den Markierungsfarben für Auswahl/Ausführung im Editor).
 */
const THEMES = {
  light: {
    paper: '#ffffff', bg: '#ffffff', disabled: '#e4e4e4', line: '#222222',
    text: '#111111', lbl: '#333333', muted: '#888888', halo: '#ffffff',
    kw: '#0000d0', type: '#0f5566', fn: '#6b4800', str: '#a31515',
    op: '#7400a8',
  },
  dark: {
    paper: '#1e1e1e', bg: '#252526', disabled: '#2e2e2e', line: '#a8a8a8',
    text: '#e0e0e0', lbl: '#b8b8b8', muted: '#7a7a7a', halo: '#252526',
    kw: '#79b8ff', type: '#4ec9b0', fn: '#f0d860', str: '#f0a080',
    op: '#d7a0ff',
  },
};

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Elementfarbe (helle Pastellfarbe aus der Datei) für das dunkle Schema abdunkeln – Farbton bleibt erhalten */
function darkTint(hex, base) {
  const hsl = hexToHsl(hex);
  if (!hsl) return base;
  const [h, s, l] = hsl;
  if (s < 0.06) return l > 0.97 ? base : hslToHex(0, 0, 0.21); // Weiß bzw. Grau
  return hslToHex(h, Math.min(s, 0.4), 0.2);
}

function styleFor(c) {
  return `.t{font-family:Consolas,"DejaVu Sans Mono","Liberation Mono","Courier New",monospace;font-size:${FS}px;fill:${c.text}}
.lbl{font-size:${Math.round(FS * 0.86)}px;fill:${c.lbl}}
.title{font-weight:bold}
.muted{fill:${c.muted}}
.bg{stroke:${c.line};stroke-width:1;shape-rendering:crispEdges}
.ln{stroke:${c.line};stroke-width:1;fill:none;shape-rendering:crispEdges}
.ln.dg{shape-rendering:geometricPrecision}
.halo{paint-order:stroke;stroke:${c.halo};stroke-width:3px;stroke-linejoin:round}
.hk{fill:${c.kw};font-weight:bold}
.ht{fill:${c.type}}
.hf{fill:${c.fn};font-weight:bold}
.hs{fill:${c.str}}
.ho{fill:${c.op};font-weight:bold}`;
}

/**
 * @param {{roots:any[]}} doc
 * @param {{trueLabel?:string,falseLabel?:string,pretty?:boolean,highlight?:boolean,theme?:"light"|"dark",only?:number}} opts
 * @returns {{svg:string,width:number,height:number}}
 */
function renderSvg(doc, opts = {}) {
  const R = new Renderer(opts);
  const out = [];
  const M = 12, GAP = 28;
  let y = M, width = 0;
  const roots = opts.only != null ? [doc.roots[opts.only]].filter(Boolean) : doc.roots;
  roots.forEach((root) => {
    const idx = doc.roots.indexOf(root);
    const s = R.size(root);
    R.root(root, M, y, s.w, `roots/${idx}`, out);
    y += s.h + GAP;
    width = Math.max(width, s.w);
  });
  const W = Math.ceil(width + 2 * M) + 1;
  const H = Math.ceil(Math.max(y - GAP + M, 40)) + 1;
  const theme = R.themeName;
  const c = R.colors;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="theme-${theme}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${styleFor(c)}</style><rect x="0" y="0" width="${W}" height="${H}" fill="${c.paper}" class="paper"/>${out.join('')}</svg>`;
  return { svg, width: W, height: H };
}

module.exports = { renderSvg, THEMES, darkTint, isKeyword };
