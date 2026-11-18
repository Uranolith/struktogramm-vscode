'use strict';
/**
 * Parser für C, C++, Java, C#, JavaScript und TypeScript -> Struktogramm-Modell.
 * Kein vollständiger Compiler-Parser, sondern ein robuster, fehlertoleranter
 * Anweisungs-Parser, der die Kontrollstrukturen erkennt.
 */
const { tokenize, joinTokens, matchClose, splitTop, findTop, isWrapped } = require('../tokenizer');
const { mk } = require('../model');
const { negateCond, addConst, typeEnd } = require('../pseudo');
const { outputLine, inputLine, litContent, stripTrailingNewline, refine, addComment } = require('./common');

const CONTROL = new Set(['if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default', 'return', 'break', 'continue',
  'throw', 'try', 'catch', 'finally', 'goto', 'foreach', 'using', 'lock', 'synchronized', 'new', 'delete', 'sizeof',
  'typeof', 'instanceof', 'yield', 'await', 'function', 'class', 'struct', 'enum', 'interface', 'namespace', 'import',
  'package', 'export', 'extends', 'implements', 'in', 'of', 'var', 'let', 'const', 'with', 'fixed', 'checked', 'unchecked', 'super', 'this']);
const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'native',
  'virtual', 'inline', 'extern', 'override', 'async', 'unsafe', 'constexpr', 'export', 'default', 'partial', 'sealed',
  'internal', 'readonly', 'transient', 'volatile', 'strictfp', 'explicit', 'friend', 'register', 'mutable', 'declare', 'new']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=', '>>>=', '**=', '??=']);
const MATHF = new Set(['sqrt', 'abs', 'pow', 'floor', 'ceil', 'random']);
const OUT_LN = new Set(['System.out.println', 'System.err.println', 'Console.WriteLine', 'Console.Error.WriteLine']);
const OUT_NOLN = new Set(['System.out.print', 'System.err.print', 'Console.Write']);
const OUT_FMT = new Set(['System.out.printf', 'System.out.format', 'printf', 'std::printf']);
const OUT_JS = new Set(['console.log', 'console.error', 'console.info', 'alert', 'document.write', 'document.writeln']);
const EXIT = new Set(['System.exit', 'exit', 'process.exit', 'Environment.Exit', 'std::exit', '_exit']);

const canEnd = (t) => t.t === 'id' || t.t === 'num' || t.t === 'str' || [')', ']', '}', '++', '--'].includes(t.v);
const canStart = (t) => (t.t === 'id' && !['in', 'of', 'instanceof', 'as', 'satisfies'].includes(t.v)) || t.t === 'num' || t.t === 'str' ||
  ['{', '!', '++', '--', '~', '@'].includes(t.v);

class CParser {
  /**
   * @param {string} src
   * @param {string} lang c|cpp|java|csharp|javascript|typescript
   * @param {{name?:string}} opts
   */
  constructor(src, lang, opts = {}) {
    this.lang = lang;
    this.opts = opts;
    this.T = tokenize(src, 'c');
    this.script = lang === 'javascript' || lang === 'typescript';
    this.roots = [];
    this.className = null;
    this.scannerVars = new Set();
    this.userFuncs = this.prescan();
    this.p = 0;
  }

  /* ------------------------------------------------------------ */
  parse() {
    const T = this.T;
    if (this.script) {
      const body = this.statementsUntil(T.length);
      const prog = refine(body);
      const onlyMainCall = prog.length === 1 && /^main\s*\(\s*\)$/.test(prog[0].text.join(''));
      if (prog.length && !(onlyMainCall && this.roots.some((r) => r.rootType === 'program'))) {
        this.roots.unshift(mk.root(this.opts.name || 'Hauptprogramm', 'program', prog));
      }
    } else {
      this.members(T.length);
      if (!this.roots.length) {
        this.p = 0;
        const body = this.statementsUntil(T.length);
        this.roots.push(mk.root(this.opts.name || 'Hauptprogramm', 'program', refine(body)));
      }
    }
    this.roots.sort((a, b) => (a.rootType === 'program' ? 0 : 1) - (b.rootType === 'program' ? 0 : 1));
    return { roots: this.roots };
  }

  /** Namen aller im Quelltext definierten Funktionen sammeln (für Aufruf-Elemente) */
  prescan() {
    const T = this.T, set = new Set();
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      if (t.t !== 'id') continue;
      if (t.v === 'function' && T[i + 1] && T[i + 1].t === 'id') { set.add(T[i + 1].v); continue; }
      if (this.script && T[i + 1] && T[i + 1].v === '=' && T[i + 2]) {
        let k = i + 2;
        if (T[k].v === 'async') k++;
        if (T[k] && T[k].v === 'function') { set.add(t.v); continue; }
        if (T[k] && T[k].v === '(') { const c = matchClose(T, k); if (c > 0 && T[c + 1] && T[c + 1].v === '=>') { set.add(t.v); continue; } }
        if (T[k] && T[k].t === 'id' && T[k + 1] && T[k + 1].v === '=>') { set.add(t.v); continue; }
      }
      if (CONTROL.has(t.v) || !T[i + 1] || T[i + 1].v !== '(') continue;
      if (T[i - 1] && (T[i - 1].v === '.' || T[i - 1].v === 'new')) continue;
      const c = matchClose(T, i + 1);
      if (c < 0) continue;
      let k = c + 1, steps = 0;
      while (T[k] && steps < 24 && (T[k].t === 'id' || [',', '.', ':', '<', '>', '[', ']', '?', '|', '&', '*', '::'].includes(T[k].v))) { k++; steps++; }
      if (T[k] && T[k].v === '{') set.add(t.v);
    }
    return set;
  }

  /* ------------------------------------------------------------ */
  /* Deklarationsebene (Datei, Klasse, Namespace)                  */
  /* ------------------------------------------------------------ */
  members(end) {
    const T = this.T;
    while (this.p < end) {
      const start = this.p;
      const t = T[this.p];
      if (t.v === ';' || t.v === '}') { this.p++; continue; }
      if (t.v === '@' && T[this.p + 1] && T[this.p + 1].v !== 'interface') { this.skipAnnotation(); continue; }
      if (t.v === '[' && this.lang === 'csharp') { this.p = matchClose(T, this.p) + 1 || this.p + 1; continue; }
      if (['import', 'package'].includes(t.v) || (t.v === 'using' && T[this.p + 1] && T[this.p + 1].v !== '(')) {
        const e = this.stmtEnd(this.p, end); this.p = e.end + 1; continue;
      }
      if (t.v === 'template' && T[this.p + 1] && T[this.p + 1].v === '<') { this.skipAngle(this.p + 1); continue; }
      const h = this.headerEnd(this.p, end);
      if (h.term === '{') {
        const hdr = T.slice(this.p, h.end);
        const close = matchClose(T, h.end);
        const kw = hdr.find((x) => ['class', 'interface', 'struct', 'enum', 'namespace', 'record', 'union', 'object'].includes(x.v));
        if (kw && (kw.v === 'enum' || kw.v === 'union' || (kw.v === 'struct' && this.lang === 'c') || hdr[0].v === 'typedef')) {
          this.p = close + 1;
          const e = this.stmtEnd(this.p, end);
          if (T[e.end] && T[e.end].v === ';') this.p = e.end + 1;
          continue;
        }
        if (kw) {
          const nameTok = hdr[hdr.indexOf(kw) + 1];
          const prev = this.className;
          if (nameTok && nameTok.t === 'id' && kw.v !== 'namespace') this.className = nameTok.v;
          this.p = h.end + 1;
          this.members(close < 0 ? end : close);
          this.className = prev;
          this.p = close < 0 ? end : close + 1;
          continue;
        }
        if (hdr.length === 2 && hdr[0].v === 'extern' && hdr[1].t === 'str') { this.p = h.end + 1; continue; } // extern "C" {
        const info = this.funcHeader(this.p, h.end);
        if (info) {
          this.p = h.end;
          const body = this.block();
          this.addFunction(info, body);
          continue;
        }
        // Initialisierer, Properties etc. überspringen
        this.p = close < 0 ? end : close + 1;
        if (hdr.some((x) => x.v === '=')) { const e = this.stmtEnd(this.p, end); this.p = e.end + 1; }
        continue;
      }
      this.p = h.end + 1;
      if (this.p <= start) this.p = start + 1;
    }
  }

  skipAnnotation() {
    const T = this.T;
    this.p++; // @
    while (T[this.p] && (T[this.p].t === 'id' || T[this.p].v === '.')) this.p++;
    if (T[this.p] && T[this.p].v === '(') this.p = matchClose(T, this.p) + 1;
  }

  skipAngle(i) {
    const T = this.T;
    let depth = 0;
    for (let k = i; k < T.length; k++) {
      if (T[k].v === '<') depth++;
      else if (T[k].v === '>') depth--;
      else if (T[k].v === '>>') depth -= 2;
      if (depth <= 0) { this.p = k + 1; return; }
    }
    this.p = T.length;
  }

  /** Ende eines Kopfes: erstes ; { } auf Klammerebene 0 (Klammern ( [ werden übersprungen) */
  headerEnd(i, end) {
    const T = this.T;
    let depth = 0;
    for (let k = i; k < end; k++) {
      const v = T[k].t === 'op' ? T[k].v : '';
      if (v === '(' || v === '[') depth++;
      else if (v === ')' || v === ']') depth--;
      else if (depth <= 0 && (v === ';' || v === '{' || v === '}')) return { end: k, term: v };
      else if (depth <= 0 && this.script && k > i && T[k].nl && canEnd(T[k - 1]) && canStart(T[k]) && T[k].v !== '{') return { end: k, term: 'nl' };
    }
    return { end, term: 'eof' };
  }

  /** Ende einer einfachen Anweisung (geschweifte Klammern werden mitgezählt) */
  stmtEnd(i, end) {
    const T = this.T;
    let depth = 0;
    for (let k = i; k < end; k++) {
      const v = T[k].t === 'op' ? T[k].v : '';
      if (v === '(' || v === '[' || v === '{') depth++;
      else if (v === ')' || v === ']' || v === '}') { if (depth === 0) return { end: k, term: v }; depth--; }
      else if (depth === 0 && v === ';') return { end: k, term: ';' };
      else if (depth === 0 && this.script && k > i && T[k].nl && canEnd(T[k - 1]) && canStart(T[k])) return { end: k, term: 'nl' };
    }
    return { end, term: 'eof' };
  }

  /** Erkennt Funktionsköpfe vor '{' */
  funcHeader(start, braceIdx) {
    const T = this.T;
    let hdr = T.slice(start, braceIdx);
    // Annotationen / Attribute entfernen
    const clean = [];
    for (let k = 0; k < hdr.length; k++) {
      if (hdr[k].v === '@' && hdr[k + 1] && hdr[k + 1].t === 'id') {
        k++;
        while (hdr[k + 1] && (hdr[k + 1].v === '.' || (hdr[k].v === '.' && hdr[k + 1].t === 'id'))) k++;
        if (hdr[k + 1] && hdr[k + 1].v === '(') k = matchClose(hdr, k + 1);
        continue;
      }
      if (this.lang === 'csharp' && hdr[k].v === '[' && clean.length === 0) { k = matchClose(hdr, k); continue; }
      clean.push(hdr[k]);
    }
    hdr = clean;
    if (!hdr.length) return null;
    if (this.script) {
      if (hdr[hdr.length - 1].v === '=>') {
        const eq = findTop(hdr, (x) => x.v === '=');
        if (eq <= 0 || hdr[eq - 1].t !== 'id') return null;
        const ps = hdr.slice(eq + 1, -1).filter((x) => x.v !== 'async');
        let paramToks = ps, retAfter = [];
        if (ps[0] && ps[0].v === '(') {
          const c = matchClose(ps, 0);
          paramToks = ps.slice(1, c);
          if (ps[c + 1] && ps[c + 1].v === ':') retAfter = ps.slice(c + 2);
        }
        return { name: hdr[eq - 1].v, paramToks, retToks: [], retAfter };
      }
      const fi = hdr.findIndex((x) => x.v === 'function');
      if (fi >= 0) {
        const open = hdr.findIndex((x, k) => k > fi && x.v === '(');
        if (open < 0) return null;
        const close = matchClose(hdr, open);
        let name = hdr[open - 1] && hdr[open - 1].t === 'id' && hdr[open - 1].v !== 'function' ? hdr[open - 1].v : null;
        if (!name) { const eq = findTop(hdr, (x) => x.v === '='); if (eq > 0) name = hdr[eq - 1].v; }
        if (!name) return null;
        const retAfter = hdr[close + 1] && hdr[close + 1].v === ':' ? hdr.slice(close + 2) : [];
        return { name, paramToks: hdr.slice(open + 1, close), retToks: [], retAfter };
      }
    }
    // generisch: letzte ')' auf oberster Ebene
    let close = -1, depth = 0;
    for (let k = 0; k < hdr.length; k++) {
      if (hdr[k].v === '(') depth++;
      else if (hdr[k].v === ')') { depth--; if (depth === 0) close = k; }
    }
    if (close < 0) return null;
    let open = -1; depth = 0;
    for (let k = close; k >= 0; k--) {
      if (hdr[k].v === ')') depth++;
      else if (hdr[k].v === '(') { depth--; if (depth === 0) { open = k; break; } }
    }
    const nameTok = hdr[open - 1];
    if (!nameTok || nameTok.t !== 'id' || (CONTROL.has(nameTok.v) && nameTok.v !== 'constructor')) return null;
    const before = hdr.slice(0, open - 1);
    if (before.some((x) => ['=', '.', 'return', 'new', '(', ')', '<<', '+', '?'].includes(x.v) || x.t === 'str' || x.t === 'num')) return null;
    const after = hdr.slice(close + 1);
    if (after.some((x) => x.t === 'str' || x.t === 'num' || !(x.t === 'id' || [',', '.', ':', '<', '>', '[', ']', '?', '|', '&', '*', '::', '->'].includes(x.v)))) return null;
    let retToks = before.filter((x) => !MODIFIERS.has(x.v) && x.v !== 'get' && x.v !== 'set');
    // Klasse::methode
    if (retToks.length >= 2 && retToks[retToks.length - 1].v === '::') retToks = retToks.slice(0, -2);
    if (this.script) retToks = [];
    const retAfter = (this.script || this.lang === 'cpp') && after[0] && (after[0].v === ':' || after[0].v === '->') ? after.slice(1) : [];
    return { name: nameTok.v, paramToks: hdr.slice(open + 1, close), retToks, retAfter };
  }

  addFunction(info, body) {
    if (/^main$/i.test(info.name)) {
      const last = body[body.length - 1];
      if (last && last.type === 'jump' && /^return( 0)?$/.test(last.text.join(''))) body.pop();
    }
    const params = this.params(info.paramToks);
    let ret = joinTokens(info.retToks) || joinTokens(info.retAfter) || null;
    if (ret && /^(void|Promise\s*<\s*void\s*>|auto)$/.test(ret)) ret = null;
    const isMain = /^main$/i.test(info.name) && (this.className || !this.script || params.length === 0);
    let text;
    if (isMain) text = this.className && (this.lang === 'java' || this.lang === 'csharp') ? this.className : info.name;
    else {
      const ps = params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(params.some((p) => p.type) ? '; ' : ', ');
      text = `${info.name}(${ps})` + (ret ? `: ${ret}` : '');
    }
    this.roots.push(mk.root(text, isMain ? 'program' : 'sub', refine(body)));
  }

  params(toks) {
    const res = [];
    if (!toks.length || (toks.length === 1 && toks[0].v === 'void')) return res;
    for (let part of splitTop(toks, ',')) {
      part = part.filter((x) => !['final', 'const', 'ref', 'out', 'in', 'params', 'readonly', 'public', 'private', 'protected', 'this'].includes(x.v));
      // Annotationen
      while (part[0] && part[0].v === '@') { part = part.slice(2); if (part[0] && part[0].v === '(') part = part.slice(matchClose(part, 0) + 1); }
      const eq = findTop(part, (x) => x.v === '=');
      if (eq >= 0) part = part.slice(0, eq);
      part = part.filter((x) => x.v !== '...');
      if (!part.length) continue;
      if (this.script) {
        const colon = findTop(part, (x) => x.v === ':' || x.v === '?');
        const name = part[0].v;
        const tstart = part.findIndex((x) => x.v === ':');
        res.push({ name, type: tstart >= 0 ? joinTokens(part.slice(tstart + 1)) : null });
        void colon;
        continue;
      }
      let suffix = '';
      while (part.length > 2 && part[part.length - 1].v === ']' && part[part.length - 2].v === '[') { part = part.slice(0, -2); suffix += '[]'; }
      const k = part.length - 1;
      if (part[k].t !== 'id') continue;
      const type = joinTokens(part.slice(0, k)).replace(/\s*\*\s*$/, '*').replace(/\s*&\s*$/, '');
      res.push({ name: part[k].v, type: (type + suffix) || null });
    }
    return res;
  }

  /* ------------------------------------------------------------ */
  /* Anweisungen                                                  */
  /* ------------------------------------------------------------ */
  statementsUntil(end) {
    const out = [];
    while (this.p < end) {
      const before = this.p;
      out.push(...this.statement(end));
      if (this.p === before) this.p++;
    }
    return out;
  }

  block() {
    const T = this.T;
    const close = matchClose(T, this.p);
    const end = close < 0 ? T.length : close;
    this.p++;
    const stmts = this.statementsUntil(end);
    this.p = end + 1;
    return stmts;
  }

  body(end) {
    if (this.T[this.p] && this.T[this.p].v === '{') return this.block();
    return this.statement(end);
  }

  group() {
    // erwartet '(' bei p; liefert Tokens dazwischen
    const T = this.T;
    if (!T[this.p] || T[this.p].v !== '(') return [];
    const c = matchClose(T, this.p);
    const inner = T.slice(this.p + 1, c < 0 ? T.length : c);
    this.p = c < 0 ? T.length : c + 1;
    return inner;
  }

  statement(end) {
    const T = this.T;
    const t = T[this.p];
    if (!t) return [];
    if (t.t === 'op') {
      if (t.v === '{') return this.block();
      if (t.v === ';' || t.v === '}') { this.p++; return []; }
      if (t.v === '@') { this.skipAnnotation(); return []; }
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': return this.ifStmt(end);
        case 'while': return this.whileStmt(end);
        case 'do': return this.doStmt(end);
        case 'for': case 'foreach': return this.forStmt(end);
        case 'switch': return this.switchStmt(end);
        case 'try': return this.tryStmt(end);
        case 'else': this.p++; return [];
        case 'synchronized': case 'lock': case 'fixed': case 'checked': case 'unchecked': case 'unsafe':
          this.p++;
          if (T[this.p] && T[this.p].v === '(') this.group();
          return this.body(end);
        case 'using':
          if (T[this.p + 1] && T[this.p + 1].v === '(') { this.p++; this.group(); return this.body(end); }
          break;
        case 'import': case 'package': { const e = this.stmtEnd(this.p, end); this.p = e.end + (e.term === ';' ? 1 : 0); return []; }
        case 'export': if (this.script) { this.p++; if (T[this.p] && T[this.p].v === 'default') this.p++; return this.statement(end); } break;
        case 'class': case 'interface': case 'enum': case 'struct': {
          const h = this.headerEnd(this.p, end);
          if (h.term === '{') {
            const close = matchClose(T, h.end);
            const nameTok = T[this.p + 1];
            const prev = this.className;
            if (t.v !== 'enum' && !(t.v === 'struct' && this.lang === 'c')) {
              if (nameTok && nameTok.t === 'id') this.className = nameTok.v;
              this.p = h.end + 1;
              this.members(close);
              this.className = prev;
            }
            this.p = close + 1;
            return [];
          }
          break;
        }
        case 'case': case 'default': {
          if (T[this.p + 1] && (T[this.p + 1].v === ':' || t.v === 'case')) { const e = findTop(T.slice(this.p), (x) => x.v === ':'); this.p += e + 1; return []; }
          break;
        }
        default: break;
      }
      // Sprungmarke
      if (T[this.p + 1] && T[this.p + 1].v === ':' && !this.script && !CONTROL.has(t.v)) { this.p += 2; return []; }
    }
    // Funktions-/Arrow-Definition?
    const h = this.headerEnd(this.p, end);
    if (h.term === '{') {
      const info = this.funcHeader(this.p, h.end);
      if (info) {
        this.p = h.end;
        const body = this.block();
        this.addFunction(info, body);
        if (T[this.p] && T[this.p].v === ';') this.p++;
        return [];
      }
    }
    const e = this.stmtEnd(this.p, end);
    const toks = T.slice(this.p, e.end);
    this.p = e.end + (e.term === ';' ? 1 : 0);
    return this.simple(toks);
  }

  ifStmt(end) {
    this.p++;
    const cond = this.expr(this.group());
    const thenB = this.body(end);
    let elseB = [];
    if (this.T[this.p] && this.T[this.p].v === 'else') { this.p++; elseB = this.body(end); }
    return [mk.alternative(cond, thenB, elseB)];
  }

  whileStmt(end) {
    this.p++;
    const condToks = this.group();
    const body = this.body(end);
    const cond = this.expr(condToks);
    if (/^(true|1)$/.test(cond)) return [mk.forever(body)];
    return [mk.while('while ' + cond, body)];
  }

  doStmt(end) {
    this.p++;
    const body = this.body(end);
    let cond = 'false';
    if (this.T[this.p] && this.T[this.p].v === 'while') { this.p++; cond = this.expr(this.group()); }
    if (this.T[this.p] && this.T[this.p].v === ';') this.p++;
    if (/^(true|1)$/.test(cond)) return [mk.forever(body)];
    return [mk.repeat('until ' + negateCond(cond), body)];
  }

  forStmt(end) {
    this.p++;
    if (this.T[this.p] && this.T[this.p].v === 'await') this.p++;
    const inner = this.group();
    const body = this.body(end);
    const semis = [];
    { let depth = 0; inner.forEach((x, k) => { if ('([{'.includes(x.v) && x.t === 'op') depth++; else if (')]}'.includes(x.v) && x.t === 'op') depth--; else if (depth === 0 && x.v === ';') semis.push(k); }); }
    if (semis.length < 2) {
      const k = findTop(inner, (x) => x.v === ':' || x.v === 'of' || x.v === 'in');
      if (k > 0) {
        const left = inner.slice(0, k).filter((x) => x.t === 'id' || x.v === '[' || x.v === ']' || x.v === ',' || x.v === '{' || x.v === '}');
        let varName = left.length && left[left.length - 1].t === 'id' ? left[left.length - 1].v : joinTokens(inner.slice(0, k));
        if (inner[0] && (inner[0].v === '[' || inner[0].v === '{')) varName = joinTokens(inner.slice(0, k));
        else if (['let', 'const', 'var'].includes(inner[0].v) && (inner[1].v === '[' || inner[1].v === '{')) varName = joinTokens(inner.slice(1, k));
        const coll = this.expr(inner.slice(k + 1));
        return [mk.for(`foreach ${varName} in ${coll}`, body)];
      }
      return [mk.forever(body)];
    }
    const init = inner.slice(0, semis[0]);
    const cond = inner.slice(semis[0] + 1, semis[1]);
    const upd = inner.slice(semis[1] + 1);
    const canon = this.canonicalFor(init, cond, upd);
    if (canon) return [mk.for(canon, body)];
    // allgemeine for-Schleife -> while
    const out = [];
    if (init.length) {
      const d = this.declaration(init);
      if (d) out.push(...d);
      else for (const part of splitTop(init, ',')) out.push(...this.simple(part));
    }
    const updEls = [];
    for (const part of splitTop(upd, ',')) updEls.push(...this.simple(part));
    // vor jedem continue muss die Fortschaltung ausgeführt werden
    const fixContinue = (seq) => {
      for (let i = 0; i < seq.length; i++) {
        const el = seq[i];
        if (el.type === 'jump' && el.text.join('').trim() === 'continue') {
          const upd = JSON.parse(JSON.stringify(updEls));
          seq.splice(i, 0, ...upd);
          i += upd.length;
          continue;
        }
        if (['for', 'while', 'repeat', 'forever'].includes(el.type)) continue;
        for (const k of ['qTrue', 'qFalse']) if (el[k]) fixContinue(el[k]);
        if (el.branches) el.branches.forEach(fixContinue);
      }
    };
    if (updEls.length) fixContinue(body);
    const loopBody = body.concat(updEls);
    if (!cond.length) out.push(mk.forever(loopBody));
    else out.push(mk.while('while ' + this.expr(cond), loopBody));
    return out;
  }

  canonicalFor(init, cond, upd) {
    // init: [Typ] i = a
    let i0 = 0;
    if (['let', 'var', 'auto'].includes(init[0] && init[0].v)) i0 = 1;
    else { const te = typeEnd(init, 0, false); if (te > 0 && init[te] && init[te].t === 'id' && init[te + 1] && init[te + 1].v === '=') i0 = te; }
    if (!init[i0] || init[i0].t !== 'id' || !init[i0 + 1] || init[i0 + 1].v !== '=') return null;
    if (findTop(init, (x) => x.v === ',') >= 0) return null;
    const v = init[i0].v;
    const start = this.expr(init.slice(i0 + 2));
    // cond
    const rk = findTop(cond, (x) => ['<', '<=', '>', '>=', '!='].includes(x.v));
    if (rk < 0) return null;
    let op = cond[rk].v, L = cond.slice(0, rk), R = cond.slice(rk + 1);
    if (findTop(R, (x) => ['&&', '||', '<', '>', '<=', '>='].includes(x.v)) >= 0) return null;
    if (!(L.length === 1 && L[0].v === v)) {
      if (R.length === 1 && R[0].v === v) { [L, R] = [R, L]; op = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '!=': '!=' }[op]; }
      else return null;
    }
    const bound = this.expr(R);
    // update
    let step = null;
    const u = upd.map((x) => x.v).join(' ');
    if (u === `${v} ++` || u === `++ ${v}`) step = '1';
    else if (u === `${v} --` || u === `-- ${v}`) step = '-1';
    else if (upd.length >= 3 && upd[0].v === v && (upd[1].v === '+=' || upd[1].v === '-=')) {
      const k = this.expr(upd.slice(2));
      step = upd[1].v === '+=' ? k : (/^\d+$/.test(k) ? '-' + k : `-(${k})`);
    } else if (upd.length >= 5 && upd[0].v === v && upd[1].v === '=' && upd[2].v === v && (upd[3].v === '+' || upd[3].v === '-')) {
      const k = this.expr(upd.slice(4));
      step = upd[3].v === '+' ? k : (/^\d+$/.test(k) ? '-' + k : `-(${k})`);
    }
    if (!step) return null;
    const neg = step.startsWith('-');
    let endE;
    if (!neg && op === '<') endE = addConst(bound, -1);
    else if (!neg && op === '<=') endE = bound;
    else if (!neg && op === '!=' && step === '1') endE = addConst(bound, -1);
    else if (neg && op === '>') endE = addConst(bound, 1);
    else if (neg && op === '>=') endE = bound;
    else return null;
    return `for ${v} <- ${start} to ${endE}` + (step !== '1' ? ` by ${step}` : '');
  }

  switchStmt(end) {
    const T = this.T;
    this.p++;
    const disc = this.expr(this.group());
    if (!T[this.p] || T[this.p].v !== '{') return [mk.instruction('switch ' + disc)];
    const close = matchClose(T, this.p);
    this.p++;
    const groups = [];
    let cur = null;
    while (this.p < close) {
      const t = T[this.p];
      if (t.v === 'case' || (t.v === 'default' && T[this.p + 1] && (T[this.p + 1].v === ':' || T[this.p + 1].v === '->'))) {
        const isDefault = t.v === 'default';
        this.p++;
        let k = this.p;
        let depth = 0;
        while (k < close) {
          const v = T[k].v;
          if ('([{'.includes(v) && T[k].t === 'op') depth++;
          else if (')]}'.includes(v) && T[k].t === 'op') depth--;
          else if (depth === 0 && (v === ':' || v === '->')) break;
          k++;
        }
        const arrow = T[k] && T[k].v === '->';
        let labelToks = T.slice(this.p, k);
        const when = labelToks.findIndex((x) => x.v === 'when');
        if (when >= 0) labelToks = labelToks.slice(0, when);
        const label = isDefault ? 'default' : this.expr(labelToks);
        this.p = k + 1;
        if (cur && !cur.stmts.length && !cur.arrow) { if (isDefault) cur.isDefault = true; else cur.labels.push(label); }
        else { cur = { labels: isDefault ? [] : [label], isDefault, stmts: [], arrow }; groups.push(cur); }
        if (arrow) {
          cur.stmts.push(...this.body(close));
          cur = null;
        }
        continue;
      }
      const before = this.p;
      const st = this.statement(close);
      if (!cur) { cur = { labels: [], isDefault: false, stmts: [] }; groups.push(cur); }
      cur.stmts.push(...st);
      if (this.p === before) this.p++;
    }
    this.p = close + 1;
    for (const g of groups) {
      const last = g.stmts[g.stmts.length - 1];
      if (last && last.type === 'jump' && last.text.join('') === 'leave') g.stmts.pop();
    }
    const def = groups.find((g) => g.isDefault);
    const normal = groups.filter((g) => g !== def && g.labels.length);
    const labels = normal.map((g) => g.labels.join(', '));
    const branches = normal.map((g) => g.stmts);
    if (def) { labels.push('default'); branches.push(def.stmts); }
    else { labels.push('%'); branches.push([]); }
    return [mk.case(disc, labels, branches)];
  }

  tryStmt(end) {
    const T = this.T;
    this.p++;
    if (T[this.p] && T[this.p].v === '(') this.group();
    const body = this.body(end);
    let hadCatch = false;
    let fin = [];
    while (T[this.p] && (T[this.p].v === 'catch' || T[this.p].v === 'finally')) {
      if (T[this.p].v === 'catch') {
        this.p++; hadCatch = true;
        if (T[this.p] && T[this.p].v === '(') this.group();
        this.body(end);
      } else { this.p++; fin = this.body(end); }
    }
    const out = body.concat(fin);
    if (hadCatch && out.length) addComment(out[0], 'try/catch: Fehlerbehandlung wird im Struktogramm nicht dargestellt');
    return out;
  }

  /* ------------------------------------------------------------ */
  /* einfache Anweisungen                                         */
  /* ------------------------------------------------------------ */
  simple(toks) {
    toks = toks.slice();
    while (toks.length && toks[toks.length - 1].v === ';') toks.pop();
    if (!toks.length) return [];
    const v0 = toks[0].v;
    if (toks.length === 1 && toks[0].t === 'str') return [];
    switch (v0) {
      case 'return': return [mk.jump(toks.length > 1 ? 'return ' + this.expr(toks.slice(1)) : 'return')];
      case 'break': return [mk.jump('leave')];
      case 'continue': return [mk.jump('continue')];
      case 'throw': return [mk.jump('throw ' + this.expr(toks.slice(1)))];
      case 'import': case 'package': case 'using': case 'typedef': return [];
      case 'goto': return [mk.jump(joinTokens(toks))];
      default: break;
    }
    // cout / cin
    let k = 0;
    if (v0 === 'std' && toks[1] && toks[1].v === '::') k = 2;
    if (toks[k] && (toks[k].v === 'cout' || toks[k].v === 'cerr') && toks[k + 1] && toks[k + 1].v === '<<') return this.cout(toks.slice(k + 1));
    if (toks[k] && toks[k].v === 'cin' && toks[k + 1] && toks[k + 1].v === '>>') {
      const vars = splitTop(toks.slice(k + 2), (x) => x.v === '>>').map((p) => this.expr(p)).filter(Boolean);
      return [mk.instruction(inputLine(null, vars))];
    }
    const d = this.declaration(toks);
    if (d) return d;
    const eq = findTop(toks, (x) => x.t === 'op' && ASSIGN.has(x.v));
    if (eq > 0) return this.assignment(toks.slice(0, eq), toks[eq].v, toks.slice(eq + 1));
    const last = toks[toks.length - 1];
    if ((last.v === '++' || last.v === '--') && toks.length > 1) {
      const tg = this.expr(toks.slice(0, -1));
      return [mk.instruction(`${tg} <- ${tg} ${last.v[0]} 1`)];
    }
    if ((v0 === '++' || v0 === '--') && toks.length > 1) {
      const tg = this.expr(toks.slice(1));
      return [mk.instruction(`${tg} <- ${tg} ${v0[0]} 1`)];
    }
    if (v0 === 'await' || v0 === 'yield') return [mk.instruction(this.expr(toks))];
    const call = this.callInfo(toks);
    if (call) {
      const io = this.ioCall(call);
      if (io) return io;
      if (this.userFuncs.has(call.name) && !call.callee.includes('.')) return [mk.call(this.expr(toks))];
      if (this.userFuncs.has(call.name) && /^this\./.test(call.callee)) return [mk.call(this.expr(toks.slice(2)))];
    }
    return [mk.instruction(this.expr(toks))];
  }

  callInfo(toks) {
    if (!toks.length || toks[toks.length - 1].v !== ')') return null;
    let depth = 0, open = -1;
    for (let k = toks.length - 1; k >= 0; k--) {
      if (toks[k].v === ')') depth++;
      else if (toks[k].v === '(') { depth--; if (depth === 0) { open = k; break; } }
    }
    if (open <= 0) return null;
    const head = toks.slice(0, open);
    for (let k = 0; k < head.length; k++) {
      const ok = k % 2 === 0 ? head[k].t === 'id' : ['.', '::', '->', '?.'].includes(head[k].v);
      if (!ok) return null;
    }
    if (head.length % 2 === 0) return null;
    const inner = toks.slice(open + 1, -1);
    return {
      callee: head.map((x) => x.v).join(''),
      name: head[head.length - 1].v,
      args: inner.length ? splitTop(inner, ',') : [],
    };
  }

  ioCall(call) {
    const n = call.callee;
    const a = call.args;
    if (OUT_LN.has(n) || OUT_NOLN.has(n)) {
      let parts;
      if (a.length > 1 && a[0].length === 1 && a[0][0].t === 'str' && /\{\d+/.test(a[0][0].v)) parts = this.compositeParts(a);
      else parts = a.length ? this.concatParts(a[0]) : [];
      return this.outEl(parts, OUT_LN.has(n));
    }
    if (OUT_FMT.has(n)) return this.printfEl(a);
    if (n === 'puts' || n === 'putchar') return this.outEl(a.length ? this.concatParts(a[0]) : [], true);
    if (OUT_JS.has(n)) {
      const parts = [];
      a.forEach((arg, k) => { if (k) parts.push({ lit: ' ' }); parts.push(...this.concatParts(arg)); });
      return this.outEl(parts, true);
    }
    if (n === 'scanf' || n === 'std::scanf' || n === 'scanf_s') {
      const vars = a.slice(1).map((arg) => this.expr(arg[0] && arg[0].v === '&' ? arg.slice(1) : arg));
      return [mk.instruction(inputLine(null, vars))];
    }
    if ((n === 'getline' || n === 'std::getline') && a.length >= 2) return [mk.instruction(inputLine(null, [this.expr(a[1])]))];
    if (n === 'fgets' && a.length >= 1) return [mk.instruction(inputLine(null, [this.expr(a[0])]))];
    if (EXIT.has(n)) return [mk.jump('exit' + (a.length ? ' ' + this.expr(a[0]) : ''))];
    const m = /^(\w+)\.close$/.exec(n);
    if (m && this.scannerVars.has(m[1])) return [];
    if (/^(System\.out\.flush|fflush|Console\.ReadKey|system)$/.test(n)) return [];
    return null;
  }

  outEl(parts, newline) {
    if (newline || true) stripTrailingNewline(parts);
    const el = mk.instruction(outputLine(parts));
    if (!newline && parts.length === 1 && parts[0].lit != null) el._prompt = parts[0].lit;
    return [el];
  }

  /** "Text " + x + y -> Teile */
  concatParts(toks) {
    if (toks.length === 1 && toks[0].t === 'str') return this.strParts(toks[0]);
    const terms = splitTop(toks, '+');
    const firstStr = terms.findIndex((t) => t.length === 1 && t[0].t === 'str');
    if (firstStr < 0 || terms.length === 1) return [{ expr: this.unwrap(toks) }];
    const parts = [];
    if (firstStr > 0) {
      const head = [].concat(...terms.slice(0, firstStr).map((t, k) => (k ? [{ t: 'op', v: '+', ws: true }, ...t] : t)));
      parts.push({ expr: firstStr === 1 ? this.unwrap(terms[0]) : '(' + this.expr(head) + ')' });
    }
    for (let k = firstStr; k < terms.length; k++) {
      const t = terms[k];
      if (t.length === 1 && t[0].t === 'str') parts.push(...this.strParts(t[0]));
      else parts.push({ expr: this.unwrap(t) });
    }
    return parts;
  }

  unwrap(toks) {
    if (isWrapped(toks)) return this.expr(toks.slice(1, -1));
    // String.valueOf(x), toString
    return this.expr(toks);
  }

  strParts(tok) {
    const v = tok.v;
    if (v[0] === '`') return this.holeParts(v.slice(1, -1), '${');
    if (v[0] === '$' && v[1] === '"') return this.holeParts(v.slice(2, -1), '{');
    if (v[0] === '@' && v[1] === '"') return [{ lit: v.slice(2, -1).replace(/\\/g, '\\\\').replace(/""/g, '\\"') }];
    if (v[0] === "'" && this.script) return [{ lit: litContent(v) }];
    return [{ lit: litContent(v) }];
  }

  holeParts(inner, open) {
    const parts = [];
    let lit = '';
    for (let i = 0; i < inner.length; i++) {
      if (open === '{' && inner[i] === '{' && inner[i + 1] === '{') { lit += '{'; i++; continue; }
      if (open === '{' && inner[i] === '}' && inner[i + 1] === '}') { lit += '}'; i++; continue; }
      if (inner.startsWith(open, i)) {
        let depth = 0, j = i + open.length;
        for (; j < inner.length; j++) {
          if (inner[j] === '{') depth++;
          else if (inner[j] === '}') { if (depth === 0) break; depth--; }
        }
        let hole = inner.slice(i + open.length, j);
        const fmt = findTop(tokenize(hole, 'c'), (x) => x.v === ':' || x.v === ',');
        if (open === '{' && fmt >= 0) hole = joinTokens(tokenize(hole, 'c').slice(0, fmt));
        if (lit) { parts.push({ lit: lit.replace(/"/g, '\\"') }); lit = ''; }
        parts.push({ expr: this.expr(tokenize(hole, 'c')) });
        i = j;
        continue;
      }
      lit += inner[i];
    }
    if (lit) parts.push({ lit: lit.replace(/(^|[^\\])"/g, '$1\\"') });
    return parts;
  }

  compositeParts(args) {
    const fmt = litContent(args[0][0].v);
    const parts = [];
    let last = 0;
    const re = /\{(\d+)(?:[,:][^}]*)?\}/g;
    let m;
    while ((m = re.exec(fmt))) {
      if (m.index > last) parts.push({ lit: fmt.slice(last, m.index) });
      const arg = args[1 + parseInt(m[1], 10)];
      if (arg) parts.push({ expr: this.unwrap(arg) });
      last = m.index + m[0].length;
    }
    if (last < fmt.length) parts.push({ lit: fmt.slice(last) });
    return parts;
  }

  printfEl(args) {
    if (!args.length) return [mk.instruction('OUTPUT')];
    const f = args[0];
    if (!(f.length === 1 && f[0].t === 'str')) return [mk.instruction(outputLine(args.map((a) => ({ expr: this.unwrap(a) }))))];
    const fmt = litContent(f[0].v);
    const parts = [];
    let last = 0, ai = 1, m;
    const re = /%[-+ #0]*(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|L|z|j|t)?([diouxXfFeEgGaAcspn%])/g;
    while ((m = re.exec(fmt))) {
      if (m.index > last) parts.push({ lit: fmt.slice(last, m.index) });
      if (m[4] === '%') parts.push({ lit: '%' });
      else if (args[ai]) parts.push({ expr: this.unwrap(args[ai++]) });
      last = m.index + m[0].length;
    }
    if (last < fmt.length) parts.push({ lit: fmt.slice(last) });
    const newline = /\\n$/.test(fmt);
    return this.outEl(parts, newline);
  }

  cout(rest) {
    const pieces = splitTop(rest, (x) => x.v === '<<').filter((p) => p.length);
    const parts = [];
    let newline = false;
    for (const p of pieces) {
      const s = joinTokens(p).replace(/\s+/g, '');
      if (s === 'endl' || s === 'std::endl') { newline = true; continue; }
      if (p.length === 1 && p[0].t === 'str') parts.push(...this.strParts(p[0]));
      else parts.push({ expr: this.unwrap(p) });
    }
    const lastLit = parts[parts.length - 1];
    if (lastLit && lastLit.lit != null && /\\n$/.test(lastLit.lit)) newline = true;
    if (lastLit && lastLit.lit === "\\n" ) newline = true;
    return this.outEl(parts, newline);
  }

  /** Eingabe-Ausdrücke erkennen: sc.nextInt(), Console.ReadLine(), prompt() ... */
  inputInfo(toks) {
    if (toks[0] && toks[0].v === '+' && toks.length > 1) { const r = this.inputInfo(toks.slice(1)); if (r) return { ...r, type: 'double' }; }
    if (isWrapped(toks)) return this.inputInfo(toks.slice(1, -1));
    const call = this.callInfo(toks);
    if (!call) return null;
    const n = call.callee;
    const m = /^(\w+)\.(nextInt|nextDouble|nextLine|next|nextBoolean|nextLong|nextFloat|nextShort|nextByte)$/.exec(n);
    if (m && !call.args.length) {
      return { prompt: null, type: { nextInt: 'int', nextLong: 'int', nextShort: 'int', nextByte: 'int', nextDouble: 'double', nextFloat: 'double', nextBoolean: 'boolean' }[m[2]] || 'String' };
    }
    if ((n === 'Console.ReadLine' || /^\w+\.readLine$/.test(n)) && !call.args.length) return { prompt: null, type: 'string' };
    if (['prompt', 'window.prompt', 'readlineSync.question', 'input'].includes(n)) {
      const a = call.args[0];
      return { prompt: a && a.length === 1 && a[0].t === 'str' ? '"' + litContent(a[0].v) + '"' : null, type: 'string' };
    }
    if (call.args.length >= 1) {
      const inner = this.inputInfo(call.args[0]);
      if (inner) {
        if (/^(Integer\.parseInt|Integer\.valueOf|Long\.parseLong|int\.Parse|long\.Parse|Convert\.ToInt32|Convert\.ToInt64|parseInt|Math\.trunc|stoi|atoi)$/.test(n)) return { ...inner, type: 'int' };
        if (/^(Double\.parseDouble|Double\.valueOf|Float\.parseFloat|double\.Parse|float\.Parse|Convert\.ToDouble|parseFloat|Number|stod|atof)$/.test(n)) return { ...inner, type: 'double' };
        if (/^(Boolean\.parseBoolean|bool\.Parse|Convert\.ToBoolean)$/.test(n)) return { ...inner, type: 'boolean' };
      }
    }
    return null;
  }

  declaration(toks) {
    let i = 0;
    while (toks[i] && (MODIFIERS.has(toks[i].v) || (toks[i].v === 'const' && !this.script) || toks[i].v === 'final')) i++;
    const kw = toks[i] && toks[i].v;
    if ((this.script && ['let', 'const', 'var'].includes(kw)) || (this.lang === 'csharp' && kw === 'var' && toks[i + 1] && toks[i + 1].t === 'id')) {
      const out = [];
      for (const part of splitTop(toks.slice(i + 1), ',')) {
        if (!part.length) continue;
        const eq = findTop(part, (x) => x.v === '=');
        if (part[0].t !== 'id') { out.push(mk.instruction(this.expr(eq >= 0 ? part.slice(0, eq) : part) + (eq >= 0 ? ' <- ' + this.expr(part.slice(eq + 1)) : ''))); continue; }
        if (eq < 0) continue;
        out.push(...this.assignLike(null, part[0].v, part.slice(eq + 1)));
      }
      return out;
    }
    if (this.script) return null;
    if (!toks[i] || toks[i].t !== 'id' || CONTROL.has(toks[i].v) || ['return', 'delete', 'throw', 'else', 'goto', 'new'].includes(toks[i].v)) return null;
    if (toks[i].v === 'struct' || toks[i].v === 'unsigned' || toks[i].v === 'signed') { /* Teil des Typs */ }
    let ts = i;
    if (toks[i].v === 'struct' || toks[i].v === 'enum') i++;
    const te = typeEnd(toks, i, false);
    if (te < 0 || !toks[te] || toks[te].t !== 'id') return null;
    const after = toks[te + 1];
    if (after && !['=', ',', '['].includes(after.v)) return null;
    let type = joinTokens(toks.slice(ts, te)).replace(/\s+\*/g, '*');
    if (type === 'var' || type === 'auto') type = null;
    if (type && /^(Scanner|BufferedReader|InputStreamReader|StreamReader)$/.test(type)) {
      this.scannerVars.add(toks[te].v);
      return [];
    }
    const out = [];
    const noInit = [];
    for (const part of splitTop(toks.slice(te), ',')) {
      if (!part.length || part[0].t !== 'id') return null;
      let j = 1, suffix = '';
      while (part[j] && part[j].v === '[') { const c = matchClose(part, j); if (c < 0) return null; suffix += joinTokens(part.slice(j, c + 1)); j = c + 1; }
      const name = part[0].v + suffix;
      if (part[j] && part[j].v === '=') {
        if (noInit.length) { out.push(mk.instruction(`var ${noInit.join(', ')}: ${type}`)); noInit.length = 0; }
        out.push(...this.assignLike(type, name, part.slice(j + 1)));
      } else if (part[j] && part[j].v === '(') { // C++ Konstruktor-Init: int x(5)
        out.push(mk.instruction(`${type} ${name} <- ${this.expr(part.slice(j + 1, -1))}`));
      } else if (!part[j]) noInit.push(name);
      else return null;
    }
    if (noInit.length) out.push(mk.instruction(type ? `var ${noInit.join(', ')}: ${type}` : noInit.join(', ')));
    return out;
  }

  assignLike(type, target, rhs) {
    const inp = this.inputInfo(rhs);
    if (inp) {
      const lines = [];
      if (type) lines.push(`var ${target}: ${type}`);
      else if (inp.type && !/^string$/i.test(inp.type) && !this.script) lines.push(`var ${target}: ${inp.type}`);
      lines.push(inputLine(inp.prompt, [target]));
      return [mk.instruction(lines)];
    }
    if (rhs.length >= 2 && rhs[0].v === 'new' && rhs[1] && /^(Scanner|BufferedReader)$/.test(rhs[1].v)) { this.scannerVars.add(target); return []; }
    const r = this.expr(rhs);
    const call = this.callInfo(rhs);
    const line = type ? `${type} ${target} <- ${r}` : `${target} <- ${r}`;
    return [call && this.userFuncs.has(call.name) && !call.callee.includes('.') ? mk.call(line) : mk.instruction(line)];
  }

  assignment(lhs, op, rhs) {
    const target = this.expr(lhs);
    if (op === '=') {
      const eq2 = findTop(rhs, (x) => x.t === 'op' && x.v === '=');
      if (eq2 > 0) {
        const inner = this.assignment(rhs.slice(0, eq2), '=', rhs.slice(eq2 + 1));
        return inner.concat([mk.instruction(`${target} <- ${this.expr(rhs.slice(0, eq2))}`)]);
      }
      return this.assignLike(null, target, rhs);
    }
    const o = op.slice(0, -1);
    const r = this.expr(rhs);
    const paren = rhs.length > 1 && o !== '+';
    return [mk.instruction(`${target} <- ${target} ${o} ${paren ? '(' + r + ')' : r}`)];
  }

  /** C-Ausdruck -> Pseudocode */
  expr(toks) {
    const out = [];
    let forceWs = false;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const nt = { ...t };
      if (forceWs) { nt.ws = true; forceWs = false; }
      // C-Cast (int) x -> int(x)
      if (t.v === '(' && toks[i + 1] && /^(int|long|short|double|float)$/.test(toks[i + 1].v) && toks[i + 2] && toks[i + 2].v === ')' && toks[i + 3]) {
        let j = i + 3;
        if (toks[j].v === '(') j = matchClose(toks, j);
        else {
          while (toks[j + 1] && (toks[j + 1].v === '.' || toks[j + 1].v === '(' || toks[j + 1].v === '[')) {
            if (toks[j + 1].v === '.') j += 2; else j = matchClose(toks, j + 1);
            if (j < 0) break;
          }
        }
        if (j > i + 2) {
          let inner = toks.slice(i + 3, j + 1);
          if (isWrapped(inner)) inner = inner.slice(1, -1);
          out.push({ t: 'id', v: (/^(double|float)$/.test(toks[i + 1].v) ? 'float' : 'int') + '(' + this.expr(inner) + ')', ws: t.ws });
          i = j;
          continue;
        }
      }
      if (t.t === 'op') {
        if (t.v === '==' || t.v === '===') nt.v = '=';
        else if (t.v === '!=' || t.v === '!==') nt.v = '<>';
        else if (t.v === '&&') { nt.v = 'and'; nt.t = 'id'; nt.ws = true; forceWs = true; }
        else if (t.v === '||') { nt.v = 'or'; nt.t = 'id'; nt.ws = true; forceWs = true; }
        else if (t.v === '!') { nt.v = 'not'; nt.t = 'id'; forceWs = true; }
      } else if (t.t === 'str' && (t.v[0] === '`' || (t.v[0] === '$' && t.v[1] === '"'))) {
        const parts = this.strParts(t);
        nt.v = parts.map((p) => (p.lit != null ? '"' + p.lit + '"' : (/[^\w.()[\]]/.test(p.expr) ? '(' + p.expr + ')' : p.expr))).join(' + ') || '""';
        if (parts.length > 1 || (parts[0] && parts[0].expr)) nt.t = 'id';
      } else if (t.t === 'id') {
        if ((t.v === 'Math' || t.v === 'math') && toks[i + 1] && toks[i + 1].v === '.' && toks[i + 2] && MATHF.has(toks[i + 2].v.toLowerCase()) && toks[i + 3] && toks[i + 3].v === '(') {
          nt.v = toks[i + 2].v.toLowerCase(); i += 2;
        } else if (t.v === 'NULL' || t.v === 'nullptr') nt.v = 'null';
        else if (t.v === 'std' && toks[i + 1] && toks[i + 1].v === '::') { i++; forceWs = t.ws; continue; }
        else if (t.v === 'this' && toks[i + 1] && toks[i + 1].v === '.' && this.script) { /* this.x bleibt */ }
      }
      out.push(nt);
    }
    return joinTokens(out);
  }
}

function parseCFamily(src, lang, opts) {
  return new CParser(src, lang, opts).parse();
}

module.exports = { parseCFamily };
