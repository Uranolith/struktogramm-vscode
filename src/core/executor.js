'use strict';
/**
 * Interpreter für Struktogramme (Pseudocode im Structorizer-Stil).
 *
 * Arbeitet als Generator: Vor jedem Element wird {type:'step'} geliefert, für Ein-/Ausgabe
 * {type:'input'} bzw. {type:'output'}. So kann die Oberfläche Schritt für Schritt ausführen,
 * pausieren, Haltepunkte setzen und Eingaben abfragen.
 */
const P = require('./pseudo');
const { splitTop, joinTokens, matchClose } = require('./tokenizer');

class ExecError extends Error {
  constructor(msg, path) { super(msg); this.path = path; }
}
class Signal { constructor(kind, value) { this.kind = kind; this.value = value; } }

const lc = (t) => (t && t.t === 'id' ? t.v.toLowerCase() : null);

/* ======================================================================== */
/* Ausdrucks-Parser (Pratt)                                                  */
/* ======================================================================== */
const BIN = {
  or: 1, '||': 1, xor: 1,
  and: 2, '&&': 2,
  '=': 4, '==': 4, '===': 4, '<>': 4, '!=': 4, '!==': 4, '<': 4, '>': 4, '<=': 4, '>=': 4, in: 4,
  '|': 5, '^': 5, '&': 5,
  '<<': 6, '>>': 6, shl: 6, shr: 6,
  '+': 7, '-': 7,
  '*': 8, '/': 8, '%': 8, div: 8, mod: 8, '//': 8,
  '**': 10,
};

function parseExpr(text) {
  const toks = P.ptoks(text);
  let i = 0;
  const peek = () => toks[i];
  const opOf = (t) => {
    if (!t) return null;
    if (t.t === 'op') return t.v;
    const l = lc(t);
    return ['and', 'or', 'xor', 'div', 'mod', 'in', 'shl', 'shr'].includes(l) ? l : null;
  };
  const expect = (v) => {
    if (!toks[i] || toks[i].v !== v) throw new Error(`„${v}“ erwartet in: ${text}`);
    i++;
  };

  function expr(minPrec = 0) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t && t.v === '?' && minPrec <= 0) {
        i++;
        const a = expr(0); expect(':');
        const b = expr(0);
        left = { k: 'cond', c: left, a, b };
        continue;
      }
      const op = opOf(t);
      if (!op || BIN[op] == null || BIN[op] < minPrec) break;
      const prec = BIN[op];
      i++;
      const right = expr(op === '**' ? prec : prec + 1);
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  }

  function unary() {
    const t = peek();
    if (!t) throw new Error('Unvollständiger Ausdruck: ' + text);
    const l = lc(t);
    if (l === 'not' || t.v === '!') { i++; return { k: 'not', a: expr(3) }; }
    if (t.v === '-' ) { i++; return { k: 'neg', a: unary() }; }
    if (t.v === '+') { i++; return unary(); }
    return postfix(primary());
  }

  function primary() {
    const t = toks[i++];
    if (!t) throw new Error('Unvollständiger Ausdruck: ' + text);
    if (t.t === 'num') {
      const v = t.v.replace(/_/g, '').replace(/[lLfFdDuU]+$/, '');
      const isFloat = /[.eE]/.test(v) && !/^0[xX]/.test(v);
      return { k: 'num', v: isFloat ? parseFloat(v) : Number(v), isFloat };
    }
    if (t.t === 'str') return { k: 'str', v: unquote(t.v), char: t.v[0] === "'" && unquote(t.v).length === 1 };
    if (t.v === '(') { const e = expr(0); expect(')'); return e; }
    if (t.v === '{' || t.v === '[') {
      const close = t.v === '{' ? '}' : ']';
      const items = [];
      if (peek() && peek().v !== close) {
        for (;;) { items.push(expr(0)); if (peek() && peek().v === ',') { i++; continue; } break; }
      }
      expect(close);
      return { k: 'arr', items };
    }
    if (t.t === 'id') {
      const l = t.v.toLowerCase();
      if (l === 'true' || l === 'wahr') return { k: 'lit', v: true };
      if (l === 'false' || l === 'falsch') return { k: 'lit', v: false };
      if (l === 'null' || l === 'nil' || l === 'none') return { k: 'lit', v: null };
      if (l === 'new' && peek() && peek().t === 'id') {
        // new int[10]
        const tn = toks[i++].v;
        if (peek() && peek().v === '[') { i++; const n = expr(0); expect(']'); return { k: 'newarr', type: tn, n }; }
        if (peek() && peek().v === '(') { const c = matchClose(toks, i); i = c + 1; }
        return { k: 'lit', v: null };
      }
      return { k: 'id', name: t.v };
    }
    throw new Error(`Unerwartetes Zeichen „${t.v}“ in: ${text}`);
  }

  function postfix(node) {
    for (;;) {
      const t = peek();
      if (!t) return node;
      if (t.v === '(') {
        i++;
        const args = [];
        if (peek() && peek().v !== ')') {
          for (;;) { args.push(expr(0)); if (peek() && peek().v === ',') { i++; continue; } break; }
        }
        expect(')');
        node = { k: 'call', fn: node, args };
      } else if (t.v === '[') {
        i++;
        const idx = [expr(0)];
        while (peek() && peek().v === ',') { i++; idx.push(expr(0)); }
        expect(']');
        for (const x of idx) node = { k: 'index', a: node, i: x };
      } else if (t.v === '.' && toks[i + 1] && toks[i + 1].t === 'id') {
        i += 2;
        node = { k: 'member', a: node, name: toks[i - 1].v };
      } else return node;
    }
  }

  const e = expr(0);
  if (i < toks.length) throw new Error(`Unerwartetes „${toks[i].v}“ in: ${text}`);
  return e;
}

function unquote(v) {
  const q = v[0];
  const inner = v.slice(1, v.endsWith(q) && v.length > 1 ? -1 : undefined);
  return inner.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, c) => {
    if (c[0] === 'u') return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'" }[c] != null ? { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'" }[c] : c;
  });
}

const cache = new Map();
function compile(text) {
  let e = cache.get(text);
  if (!e) { e = parseExpr(text); cache.set(text, e); if (cache.size > 5000) cache.clear(); }
  return e;
}

/* ======================================================================== */
/* Werte                                                                     */
/* ======================================================================== */
function fmt(v, inner) {
  if (v === null || v === undefined) return inner ? 'null' : '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '{' + v.map((x) => (typeof x === 'string' ? '"' + x + '"' : fmt(x, true))).join(', ') + '}';
  if (v instanceof Float) return Number.isInteger(v.v) ? v.v.toFixed(1) : String(v.v);
  return String(v);
}

/** Gleitkommazahlen werden markiert, damit 7.0 / 2 nicht ganzzahlig geteilt wird */
class Float { constructor(v) { this.v = v; } }
const num = (x) => (x instanceof Float ? x.v : x);
const isFloat = (x) => x instanceof Float;
const mkNum = (v, float) => (float ? new Float(v) : v);
const isNum = (x) => typeof x === 'number' || x instanceof Float;

function truthy(v) {
  v = num(v);
  if (typeof v === 'string') return v.length > 0 && v !== 'false';
  return !!v;
}

function equals(a, b) {
  a = num(a); b = num(b);
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !isNaN(Number(b))) return a === Number(b);
  if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a))) return b === Number(a);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, k) => equals(x, b[k]));
  return a === b;
}

function typeLabel(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Float) return 'double';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
  if (typeof v === 'string') return v.length === 1 ? 'char/string' : 'string';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) return 'array[' + v.length + ']';
  return typeof v;
}

/* ======================================================================== */
/* Interpreter                                                               */
/* ======================================================================== */
class Interpreter {
  /**
   * @param {{roots:any[]}} doc
   * @param {{maxDepth?:number, random?:()=>number}} opts
   */
  constructor(doc, opts = {}) {
    this.doc = doc;
    this.opts = opts;
    this.frames = [];
    this.random = opts.random || Math.random;
    this.subs = doc.roots.map((r, idx) => ({ root: r, idx, sig: P.parseSignature(r.text) }));
  }

  get frame() { return this.frames[this.frames.length - 1]; }

  /** Startet ein Diagramm (Index) – liefert einen Generator */
  *run(rootIndex, args = []) {
    const r = this.doc.roots[rootIndex];
    if (!r) throw new ExecError('Kein Diagramm zum Ausführen gefunden.');
    const sig = P.parseSignature(r.text);
    if (r.rootType !== 'program' && sig.params.length && !args.length) {
      // Parameter für Unterprogramm abfragen
      for (const p of sig.params) {
        const v = yield { type: 'input', prompt: `Parameter ${p.name}${p.type ? ' (' + p.type + ')' : ''}:`, name: p.name };
        args.push(this.convertInput(v, P.normType(p.type)));
      }
    }
    const result = yield* this.invoke(rootIndex, args, null);
    if (r.rootType !== 'program' && result !== undefined) yield { type: 'output', text: `Ergebnis von ${sig.name}: ${fmt(result)}`, info: true };
    return result;
  }

  *invoke(rootIndex, args, callPath) {
    const r = this.doc.roots[rootIndex];
    const sig = P.parseSignature(r.text);
    if (this.frames.length >= (this.opts.maxDepth || 800)) throw new ExecError('Zu viele verschachtelte Aufrufe (Endlos-Rekursion?)', callPath);
    const vars = new Map();
    const types = new Map();
    sig.params.forEach((p, k) => {
      const t = P.normType(p.type);
      if (t) types.set(p.name, t);
      vars.set(p.name, this.coerce(args[k], t));
    });
    this.frames.push({ name: sig.name, rootIndex, vars, types, sig });
    let result;
    try {
      yield* this.seq(r.children, `roots/${rootIndex}/children`);
    } catch (e) {
      if (e instanceof Signal && e.kind === 'return') result = e.value;
      else if (e instanceof Signal && (e.kind === 'leave' || e.kind === 'continue')) { /* außerhalb einer Schleife: ignorieren */ }
      else throw e;
    } finally {
      const f = this.frames.pop();
      if (result === undefined) {
        // Pascal-Stil: Ergebnis über Funktionsnamen oder "result"
        if (f.vars.has(sig.name)) result = f.vars.get(sig.name);
        else if (f.vars.has('result')) result = f.vars.get('result');
        else if (f.vars.has('Result')) result = f.vars.get('Result');
      }
    }
    return result;
  }

  *seq(list, path) {
    for (let i = 0; i < list.length; i++) yield* this.element(list[i], `${path}/${i}`);
  }

  *element(el, path) {
    if (el.disabled) return;
    yield { type: 'step', path, el };
    try {
      switch (el.type) {
        case 'instruction': case 'call': case 'jump': {
          const lines = (el.text || []).filter((l) => String(l).trim());
          if (el.type === 'jump' && !lines.length) throw new Signal('leave');
          for (const l of lines) yield* this.line(l, path);
          break;
        }
        case 'alternative': {
          const c = yield* this.evalCond(el.text, ['if', 'wenn', 'falls'], path);
          if (truthy(c)) yield* this.seq(el.qTrue, path + '/qTrue');
          else yield* this.seq(el.qFalse, path + '/qFalse');
          break;
        }
        case 'case': {
          const disc = yield* this.eval(el.text[0] || '', path);
          const labels = el.text.slice(1);
          const n = el.branches.length;
          let hit = -1;
          for (let k = 0; k < n && hit < 0; k++) {
            const label = String(labels[k] == null ? '' : labels[k]).trim();
            if (k === n - 1) { if (label !== '%') hit = k; break; }
            for (const part of splitTop(P.ptoks(label), ',')) {
              if (!part.length) continue;
              const v = yield* this.eval(joinTokens(part), path);
              if (equals(disc, v)) { hit = k; break; }
            }
          }
          if (hit >= 0) yield* this.seq(el.branches[hit], `${path}/branches/${hit}`);
          break;
        }
        case 'for': yield* this.forLoop(el, path); break;
        case 'while': {
          for (;;) {
            const c = yield* this.evalCond(el.text, ['while', 'solange', 'während'], path);
            if (!truthy(c)) break;
            if (yield* this.loopBody(el.body, path)) break;
            yield { type: 'step', path, el, loop: true };
          }
          break;
        }
        case 'repeat': {
          for (;;) {
            if (yield* this.loopBody(el.body, path)) break;
            yield { type: 'step', path, el, loop: true };
            const c = yield* this.evalCond(el.text, ['until', 'bis'], path);
            if (truthy(c)) break;
          }
          break;
        }
        case 'forever': {
          for (;;) {
            if (yield* this.loopBody(el.body, path)) break;
            yield { type: 'step', path, el, loop: true };
          }
          break;
        }
        case 'parallel':
          for (let k = 0; k < el.branches.length; k++) yield* this.seq(el.branches[k], `${path}/branches/${k}`);
          break;
        default: break;
      }
    } catch (e) {
      if (e instanceof Signal) throw e;
      if (e instanceof ExecError) { if (!e.path) e.path = path; throw e; }
      throw new ExecError(e.message, path);
    }
  }

  /** Schleifenrumpf; true = Schleife verlassen */
  *loopBody(body, path) {
    try {
      yield* this.seq(body, path + '/body');
    } catch (e) {
      if (e instanceof Signal && e.kind === 'leave') return true;
      if (e instanceof Signal && e.kind === 'continue') return false;
      throw e;
    }
    return false;
  }

  *forLoop(el, path) {
    const text = (el.text || []).join(' ');
    const f = P.parseForText(text);
    if (!f) throw new ExecError(`Schleifenkopf nicht verstanden: „${text}“ (erwartet z.B. for i := 1 to 10)`, path);
    if (f.kind === 'count') {
      let v = yield* this.eval(f.start, path);
      const end = yield* this.eval(f.end, path);
      const step = yield* this.eval(f.step || '1', path);
      if (num(step) === 0) throw new ExecError('Schrittweite 0 in Zählschleife', path);
      const fl = isFloat(v) || isFloat(step);
      for (;;) {
        const cur = num(v);
        if (num(step) > 0 ? cur > num(end) : cur < num(end)) break;
        this.assignVar(f.var, mkNum(cur, fl));
        if (yield* this.loopBody(el.body, path)) break;
        v = mkNum(num(this.lookup(f.var)) + num(step), fl);
        yield { type: 'step', path, el, loop: true };
      }
    } else {
      let coll = yield* this.eval(f.coll, path);
      if (typeof coll === 'string') coll = [...coll];
      if (!Array.isArray(coll)) throw new ExecError(`„${f.coll}“ ist keine Liste/kein Array`, path);
      const names = f.var.split(',').map((s) => s.trim());
      for (const item of coll.slice()) {
        if (names.length > 1 && Array.isArray(item)) names.forEach((n, k) => this.assignVar(n, item[k]));
        else this.assignVar(names[0], item);
        if (yield* this.loopBody(el.body, path)) break;
        yield { type: 'step', path, el, loop: true };
      }
    }
  }

  *evalCond(lines, kws, path) {
    let s = (lines || []).map((l) => String(l).trim()).filter(Boolean).join(' ');
    s = P.stripKeyword(s, kws).replace(/\s*\?$/, '');
    if (!s) return true;
    return yield* this.eval(s, path);
  }

  /** Eine Zeile Pseudocode ausführen */
  *line(text, path) {
    const c = P.classifyLine(text);
    switch (c.kind) {
      case 'empty': return;
      case 'decl':
        for (const d of c.decls) {
          const t = c.type ? P.normType(c.type) : null;
          if (t) this.frame.types.set(d.name, t + (d.suffix ? '[]' : ''));
          let v;
          if (d.init != null && d.init !== '') v = yield* this.eval(d.init, path);
          else if (d.suffix) {
            const dims = [...d.suffix.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]);
            v = yield* this.makeArray(dims, t, path);
          } else v = this.defaultValue(t);
          this.frame.vars.set(d.name, this.coerce(v, t));
        }
        return;
      case 'assign': {
        const v = yield* this.eval(c.expr, path);
        const targets = splitTop(P.ptoks(c.target), ',');
        if (targets.length > 1) {
          const vals = Array.isArray(v) ? v : [v];
          for (let k = 0; k < targets.length; k++) yield* this.assignTo(joinTokens(targets[k]), vals[k], path);
        } else yield* this.assignTo(c.target, v, path);
        return;
      }
      case 'input': {
        if (!c.vars.length) { yield { type: 'input', prompt: c.prompt ? unquote(c.prompt) : '(Weiter mit Enter)', name: '' }; return; }
        for (let k = 0; k < c.vars.length; k++) {
          const name = c.vars[k];
          const prompt = k === 0 && c.prompt ? unquote(c.prompt) : `${name}:`;
          const raw = yield { type: 'input', prompt, name };
          const base = name.replace(/\[.*$/, '');
          const t = this.frame.types.get(base);
          yield* this.assignTo(name, this.convertInput(raw, t && t.endsWith('[]') ? t.slice(0, -2) : t), path);
        }
        return;
      }
      case 'output': {
        const parts = [];
        for (const it of c.items) parts.push(fmt(yield* this.eval(it, path)));
        yield { type: 'output', text: parts.join('') };
        return;
      }
      case 'return': throw new Signal('return', c.expr ? yield* this.eval(c.expr, path) : undefined);
      case 'leave': throw new Signal('leave');
      case 'continue': throw new Signal('continue');
      case 'exit': throw new Signal('exit', c.expr ? yield* this.eval(c.expr, path) : 0);
      case 'throw': throw new ExecError('Ausnahme ausgelöst: ' + fmt(c.expr ? yield* this.eval(c.expr, path) : ''), path);
      default:
        yield* this.eval(c.expr, path);
    }
  }

  *makeArray(dims, t, path) {
    if (!dims.length) return this.defaultValue(t);
    const n = num(yield* this.eval(dims[0] || '0', path));
    const a = [];
    for (let k = 0; k < n; k++) a.push(yield* this.makeArray(dims.slice(1), t, path));
    return a;
  }

  defaultValue(t) {
    switch (t) {
      case 'int': return 0;
      case 'double': return new Float(0);
      case 'string': return '';
      case 'boolean': return false;
      case 'char': return ' ';
      default: return t && t.endsWith('[]') ? [] : null;
    }
  }

  coerce(v, t) {
    if (v === undefined) return v;
    if (t === 'double' && typeof v === 'number') return new Float(v);
    if (t === 'int' && v instanceof Float) return Math.trunc(v.v);
    if (t === 'string' && isNum(v)) return fmt(v);
    return v;
  }

  convertInput(raw, t) {
    const s = raw == null ? '' : String(raw);
    if (t === 'int') { const n = parseInt(s, 10); if (isNaN(n)) throw new ExecError(`„${s}“ ist keine ganze Zahl`); return n; }
    if (t === 'double') { const n = parseFloat(s.replace(',', '.')); if (isNaN(n)) throw new ExecError(`„${s}“ ist keine Zahl`); return new Float(n); }
    if (t === 'boolean') return /^(true|wahr|ja|1)$/i.test(s.trim());
    if (t === 'string' || t === 'char') return s;
    // ohne Typ: wie Structorizer – Zahl, wenn es wie eine Zahl aussieht
    const tr = s.trim();
    if (/^[+-]?\d+$/.test(tr)) return parseInt(tr, 10);
    if (/^[+-]?(\d+[.,]\d*|\d*[.,]\d+)([eE][+-]?\d+)?$/.test(tr)) return new Float(parseFloat(tr.replace(',', '.')));
    if (/^(true|false)$/i.test(tr)) return tr.toLowerCase() === 'true';
    return s;
  }

  lookup(name) {
    const f = this.frame;
    if (f.vars.has(name)) return f.vars.get(name);
    const g = this.frames[0];
    if (g && g.vars.has(name)) return g.vars.get(name);
    return undefined;
  }

  assignVar(name, v) {
    const t = this.frame.types.get(name);
    this.frame.vars.set(name, this.coerce(v, t));
  }

  *assignTo(target, v, path) {
    const node = compile(target);
    if (node.k === 'id') { this.assignVar(node.name, Array.isArray(v) ? v.slice() : v); return; }
    if (node.k === 'index') {
      const container = yield* this.evalNode(node.a, path);
      const idx = num(yield* this.evalNode(node.i, path));
      if (!Array.isArray(container)) throw new ExecError(`„${joinTokensSafe(target)}“: kein Array`, path);
      if (idx < 0) throw new ExecError(`Index ${idx} ist negativ`, path);
      while (container.length < idx) container.push(null);
      const base = rootName(node);
      const t = base ? this.frame.types.get(base) : null;
      container[idx] = this.coerce(v, t && t.endsWith('[]') ? t.replace(/\[\]$/, '') : null);
      return;
    }
    if (node.k === 'member') {
      const obj = yield* this.evalNode(node.a, path);
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof Float)) { obj[node.name] = v; return; }
    }
    throw new ExecError(`Zuweisung an „${target}“ nicht möglich`, path);
  }

  /* ---------------------------- Auswertung ---------------------------- */
  *eval(text, path) {
    let node;
    try { node = compile(String(text)); } catch (e) { throw new ExecError(e.message, path); }
    return yield* this.evalNode(node, path);
  }

  *evalNode(n, path) {
    switch (n.k) {
      case 'num': return n.isFloat ? new Float(n.v) : n.v;
      case 'str': return n.v;
      case 'lit': return n.v;
      case 'arr': { const a = []; for (const x of n.items) a.push(yield* this.evalNode(x, path)); return a; }
      case 'newarr': { const len = num(yield* this.evalNode(n.n, path)); return Array.from({ length: len }, () => this.defaultValue(P.normType(n.type))); }
      case 'id': {
        const v = this.lookup(n.name);
        if (v === undefined) {
          const sub = this.findSub(n.name, 0);
          if (sub) return yield* this.callSub(sub, [], path);
          if (/^(pi)$/i.test(n.name)) return new Float(Math.PI);
          throw new ExecError(`Variable „${n.name}“ hat noch keinen Wert`, path);
        }
        return v;
      }
      case 'not': return !truthy(yield* this.evalNode(n.a, path));
      case 'neg': { const v = yield* this.evalNode(n.a, path); return mkNum(-num(v), isFloat(v)); }
      case 'cond': return truthy(yield* this.evalNode(n.c, path)) ? yield* this.evalNode(n.a, path) : yield* this.evalNode(n.b, path);
      case 'bin': return yield* this.binary(n, path);
      case 'index': {
        const a = yield* this.evalNode(n.a, path);
        const i = num(yield* this.evalNode(n.i, path));
        if (typeof a === 'string') { if (i < 0 || i >= a.length) throw new ExecError(`Index ${i} außerhalb des Textes (Länge ${a.length})`, path); return a[i]; }
        if (!Array.isArray(a)) throw new ExecError('Indexzugriff auf etwas, das kein Array ist', path);
        if (i < 0 || i >= a.length) throw new ExecError(`Index ${i} außerhalb des Arrays (Länge ${a.length})`, path);
        return a[i];
      }
      case 'member': {
        const a = yield* this.evalNode(n.a, path);
        const m = n.name.toLowerCase();
        if ((m === 'length' || m === 'size') && (typeof a === 'string' || Array.isArray(a))) return a.length;
        if (a && typeof a === 'object' && !Array.isArray(a) && n.name in a) return a[n.name];
        throw new ExecError(`Unbekanntes Attribut „${n.name}“`, path);
      }
      case 'call': return yield* this.call(n, path);
      default: throw new ExecError('Unbekannter Ausdruck', path);
    }
  }

  *binary(n, path) {
    const op = n.op;
    if (op === 'and' || op === '&&') return truthy(yield* this.evalNode(n.a, path)) && truthy(yield* this.evalNode(n.b, path));
    if (op === 'or' || op === '||') return truthy(yield* this.evalNode(n.a, path)) || truthy(yield* this.evalNode(n.b, path));
    const A = yield* this.evalNode(n.a, path);
    const B = yield* this.evalNode(n.b, path);
    const a = num(A), b = num(B);
    const fl = isFloat(A) || isFloat(B);
    const needNums = () => {
      if (typeof a !== 'number' || typeof b !== 'number') throw new ExecError(`Rechnen mit „${fmt(A, true)}“ und „${fmt(B, true)}“ nicht möglich (${op})`, path);
    };
    switch (op) {
      case 'xor': return truthy(A) !== truthy(B);
      case '=': case '==': case '===': return equals(A, B);
      case '<>': case '!=': case '!==': return !equals(A, B);
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      case 'in': return Array.isArray(b) ? b.some((x) => equals(x, A)) : typeof b === 'string' ? b.includes(String(a)) : false;
      case '+':
        if (typeof a === 'string' || typeof b === 'string') return fmt(A) + fmt(B);
        if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
        needNums(); return mkNum(a + b, fl);
      case '-': needNums(); return mkNum(a - b, fl);
      case '*':
        if (typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, b));
        needNums(); return mkNum(a * b, fl);
      case '/':
        needNums();
        if (b === 0 && !fl) throw new ExecError('Division durch 0', path);
        if (!fl && Number.isInteger(a) && Number.isInteger(b)) return Math.trunc(a / b);
        return new Float(a / b);
      case 'div': case '//':
        needNums();
        if (b === 0) throw new ExecError('Division durch 0', path);
        return op === '//' ? Math.floor(a / b) : Math.trunc(a / b);
      case '%': case 'mod':
        needNums();
        if (b === 0) throw new ExecError('Division durch 0 (mod)', path);
        return mkNum(a % b, fl);
      case '**': needNums(); return mkNum(Math.pow(a, b), fl || b < 0);
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
      case '<<': case 'shl': return a << b;
      case '>>': case 'shr': return a >> b;
      default: throw new ExecError('Unbekannter Operator ' + op, path);
    }
  }

  findSub(name, argc) {
    return this.subs.find((s) => s.sig.name === name && s.root.rootType !== 'program' && (s.sig.params.length === argc)) ||
      this.subs.find((s) => s.sig.name === name && s.root.rootType !== 'program');
  }

  *callSub(sub, args, path) {
    yield { type: 'call', name: sub.sig.name, depth: this.frames.length };
    const r = yield* this.invoke(sub.idx, args, path);
    yield { type: 'return', name: sub.sig.name, depth: this.frames.length };
    return r;
  }

  *call(n, path) {
    // Methoden auf Werten: s.length(), s.substring(1, 2) ...
    if (n.fn.k === 'member') {
      const obj = yield* this.evalNode(n.fn.a, path);
      const args = [];
      for (const a of n.args) args.push(num(yield* this.evalNode(a, path)));
      return this.method(obj, n.fn.name, args, path);
    }
    if (n.fn.k !== 'id') throw new ExecError('Ungültiger Aufruf', path);
    const name = n.fn.name;
    const sub = this.findSub(name, n.args.length);
    const args = [];
    for (const a of n.args) args.push(yield* this.evalNode(a, path));
    if (sub) return yield* this.callSub(sub, args, path);
    return this.builtin(name, args, path);
  }

  method(obj, name, args, path) {
    const m = name.toLowerCase();
    if (typeof obj === 'string') {
      switch (m) {
        case 'length': case 'size': return obj.length;
        case 'charat': return obj.charAt(args[0]);
        case 'substring': return obj.substring(args[0], args[1]);
        case 'touppercase': case 'upper': return obj.toUpperCase();
        case 'tolowercase': case 'lower': return obj.toLowerCase();
        case 'indexof': return obj.indexOf(args[0]);
        case 'contains': return obj.includes(args[0]);
        case 'equals': return obj === args[0];
        case 'trim': case 'strip': return obj.trim();
        case 'startswith': return obj.startsWith(args[0]);
        case 'endswith': return obj.endsWith(args[0]);
        default: break;
      }
    }
    if (Array.isArray(obj)) {
      switch (m) {
        case 'length': case 'size': return obj.length;
        case 'append': case 'add': case 'push': obj.push(args[0]); return null;
        case 'pop': return obj.pop();
        case 'get': return obj[args[0]];
        case 'contains': return obj.some((x) => equals(x, args[0]));
        case 'indexof': return obj.findIndex((x) => equals(x, args[0]));
        default: break;
      }
    }
    throw new ExecError(`Unbekannte Methode „${name}“`, path);
  }

  builtin(name, args, path) {
    const a = args.map(num);
    const f = (v) => new Float(v);
    switch (name.toLowerCase()) {
      case 'sqrt': if (a[0] < 0) throw new ExecError('Wurzel aus negativer Zahl', path); return f(Math.sqrt(a[0]));
      case 'abs': return mkNum(Math.abs(a[0]), isFloat(args[0]));
      case 'pow': case 'power': return f(Math.pow(a[0], a[1]));
      case 'exp': return f(Math.exp(a[0]));
      case 'log': case 'ln': return f(Math.log(a[0]));
      case 'sin': return f(Math.sin(a[0]));
      case 'cos': return f(Math.cos(a[0]));
      case 'tan': return f(Math.tan(a[0]));
      case 'floor': return Math.floor(a[0]);
      case 'ceil': return Math.ceil(a[0]);
      case 'round': return Math.round(a[0]);
      case 'trunc': case 'int': {
        if (typeof a[0] === 'string') { const n = parseInt(a[0], 10); if (isNaN(n)) throw new ExecError(`„${a[0]}“ ist keine ganze Zahl`, path); return n; }
        return Math.trunc(a[0]);
      }
      case 'float': case 'double': case 'real': {
        const n = typeof a[0] === 'string' ? parseFloat(a[0].replace(',', '.')) : a[0];
        if (isNaN(n)) throw new ExecError(`„${a[0]}“ ist keine Zahl`, path);
        return f(n);
      }
      case 'str': case 'tostring': case 'inttostr': case 'floattostr': return fmt(args[0]);
      case 'strtoint': return parseInt(a[0], 10);
      case 'strtofloat': return f(parseFloat(String(a[0]).replace(',', '.')));
      case 'chr': return String.fromCharCode(a[0]);
      case 'ord': return String(a[0]).charCodeAt(0);
      case 'length': case 'len': return (typeof a[0] === 'string' || Array.isArray(a[0])) ? a[0].length : 0;
      case 'uppercase': case 'upper': return String(a[0]).toUpperCase();
      case 'lowercase': case 'lower': return String(a[0]).toLowerCase();
      case 'copy': return String(a[0]).substr(a[1] - 1, a[2]);
      case 'pos': return String(a[1]).indexOf(a[0]) + 1;
      case 'min': return a.length === 1 && Array.isArray(a[0]) ? Math.min(...a[0].map(num)) : Math.min(...a);
      case 'max': return a.length === 1 && Array.isArray(a[0]) ? Math.max(...a[0].map(num)) : Math.max(...a);
      case 'random': return a.length ? Math.floor(this.random() * a[0]) : f(this.random());
      case 'randint': return a[0] + Math.floor(this.random() * (a[1] - a[0] + 1));
      case 'range': {
        const [s, e, st] = a.length === 1 ? [0, a[0], 1] : [a[0], a[1], a[2] || 1];
        const r = []; for (let k = s; st > 0 ? k < e : k > e; k += st) r.push(k); return r;
      }
      case 'sum': return (a[0] || []).reduce((x, y) => x + num(y), 0);
      case 'odd': return a[0] % 2 !== 0;
      case 'sqr': return mkNum(a[0] * a[0], isFloat(args[0]));
      case 'inc': case 'dec': throw new ExecError(`${name}() bitte als Zuweisung schreiben (x := x + 1)`, path);
      case 'print': case 'println': throw new ExecError('Für Ausgaben bitte OUTPUT verwenden', path);
      default: throw new ExecError(`Unbekannte Funktion „${name}“ – ist das Unterprogramm als eigenes Diagramm angelegt?`, path);
    }
  }

  /** Variablen für die Anzeige */
  snapshot() {
    return this.frames.map((f) => ({
      name: f.name,
      vars: [...f.vars].map(([k, v]) => ({ name: k, value: fmt(v, true), type: f.types.get(k) || typeLabel(v) })),
    }));
  }
}

function rootName(node) {
  while (node && (node.k === 'index' || node.k === 'member')) node = node.a;
  return node && node.k === 'id' ? node.name : null;
}
function joinTokensSafe(t) { return String(t); }

module.exports = { Interpreter, ExecError, Signal, fmt, parseExpr };
