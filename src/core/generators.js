'use strict';
/**
 * Struktogramm-Modell -> Quelltext.
 */
const P = require('./pseudo');
const { t: tr } = require('../i18n');
const { walk } = require('./model');
const { joinTokens, findTop, OPEN, CLOSE } = require('./tokenizer');

const TARGETS = {
  python: { label: 'Python', ext: 'py', languageId: 'python' },
  java: { label: 'Java', ext: 'java', languageId: 'java' },
  c: { label: 'C', ext: 'c', languageId: 'c' },
  cpp: { label: 'C++', ext: 'cpp', languageId: 'cpp' },
  csharp: { label: 'C#', ext: 'cs', languageId: 'csharp' },
  javascript: { label: 'JavaScript (Node.js)', ext: 'js', languageId: 'javascript' },
  pascal: { label: 'Pascal (Free Pascal)', ext: 'pas', languageId: 'pascal' },
  kotlin: { label: 'Kotlin', ext: 'kt', languageId: 'kotlin' },
  rust: { label: 'Rust', ext: 'rs', languageId: 'rust' },
};

const TYPE_MAP = {
  java: { int: 'int', double: 'double', string: 'String', boolean: 'boolean', char: 'char' },
  c: { int: 'int', double: 'double', string: 'char*', boolean: 'bool', char: 'char' },
  cpp: { int: 'int', double: 'double', string: 'string', boolean: 'bool', char: 'char' },
  csharp: { int: 'int', double: 'double', string: 'string', boolean: 'bool', char: 'char' },
  pascal: { int: 'integer', double: 'real', string: 'string', boolean: 'boolean', char: 'char' },
  python: { int: 'int', double: 'float', string: 'str', boolean: 'bool', char: 'str' },
  kotlin: { int: 'Int', double: 'Double', string: 'String', boolean: 'Boolean', char: 'Char' },
  rust: { int: 'i32', double: 'f64', string: 'String', boolean: 'bool', char: 'char' },
};

const SIMPLE_IDENT = P.IDENT_RE;

/** genaue Typnamen je Zielsprache (Schlüssel: P.canonType) */
const EXACT_TYPES = {
  java: { int: 'int', long: 'long', short: 'short', byte: 'byte', float: 'float', double: 'double', char: 'char', string: 'String', boolean: 'boolean' },
  csharp: { int: 'int', long: 'long', short: 'short', byte: 'byte', float: 'float', double: 'double', char: 'char', string: 'string', boolean: 'bool' },
  c: { int: 'int', long: 'long long', short: 'short', byte: 'unsigned char', float: 'float', double: 'double', char: 'char', string: 'char*', boolean: 'bool' },
  cpp: { int: 'int', long: 'long long', short: 'short', byte: 'unsigned char', float: 'float', double: 'double', char: 'char', string: 'string', boolean: 'bool' },
  kotlin: { int: 'Int', long: 'Long', short: 'Short', byte: 'Byte', float: 'Float', double: 'Double', char: 'Char', string: 'String', boolean: 'Boolean' },
  rust: { int: 'i32', long: 'i64', short: 'i16', byte: 'u8', float: 'f32', double: 'f64', char: 'char', string: 'String', boolean: 'bool' },
  pascal: { int: 'integer', long: 'int64', short: 'smallint', byte: 'byte', float: 'single', double: 'double', char: 'char', string: 'string', boolean: 'boolean' },
  python: { int: 'int', long: 'int', short: 'int', byte: 'int', float: 'float', double: 'float', char: 'str', string: 'str', boolean: 'bool' },
};
const identsOf = (text) => P.ptoks(text).filter((t, i, a) => t.t === 'id' && !(a[i - 1] && a[i - 1].v === '.')).map((t) => t.v);

function linesOf(el) {
  return (el.text || []).map((l) => String(l)).filter((l) => l.trim());
}

/** Enthält die Routine eine (aktive) Parallelverarbeitung? */
function hasParallel(root) {
  let found = false;
  walk(root.children, (el) => { if (el.disabled) return false; if (el.type === 'parallel') found = true; });
  return found;
}

/* ==================================================================== */
class BaseGen {
  constructor(doc, lang, opts) {
    this.doc = doc;
    this.lang = lang;
    this.opts = opts || {};
    this.needs = new Set();
    this.I = this.lang === 'pascal' ? '  ' : '    ';
    this.sigs = new Map();
    this.funcs = new Map();
    this.collectTypes();
    for (const r of doc.roots) {
      const sig = P.parseSignature(r.text);
      this.sigs.set(r, sig);
      if (r.rootType !== 'program') this.funcs.set(sig.name, sig);
    }
    // Parametertypen ohne Angabe aus den Aufrufstellen ableiten
    this.inferringParams = true;
    for (let pass = 0; pass < 2; pass++) {
      for (const r of doc.roots) {
        const sig = this.sigs.get(r);
        const types = this.analyze(r, r.rootType === 'program' ? { ...sig, params: [] } : sig).types;
        walk(r.children, (el) => {
          for (const line of linesOf(el)) {
            const toks = P.ptoks(line);
            toks.forEach((t, i) => {
              if (t.t !== 'id' || !this.funcs.has(t.v) || !toks[i + 1] || toks[i + 1].v !== '(') return;
              const fsig = this.funcs.get(t.v);
              const close = require('./tokenizer').matchClose(toks, i + 1);
              const args = require('./tokenizer').splitTop(toks.slice(i + 2, close < 0 ? toks.length : close), ',');
              args.forEach((a, k) => {
                const prm = fsig.params[k];
                if (!prm || prm.type || prm.inferredType || !a.length) return;
                const at = P.inferType(joinTokens(a), types, new Map());
                if (at) prm.inferredType = at;
              });
            });
          }
        });
      }
    }
    this.inferringParams = false;
    // Rückgabetypen vorab bestimmen (für Typinferenz bei Aufrufen)
    for (const r of doc.roots) {
      const sig = this.sigs.get(r);
      if (r.rootType !== 'program' && !sig.returnType) sig.inferredReturn = this.inferReturn(r, sig, this.analyze(r, sig).types);
    }
  }

  x(text) {
    this.intDiv = (this.lang === 'python' || this.lang === 'pascal') && /\//.test(String(text)) && this.allInt(text);
    const r = P.translateExpr(text, this.lang, this);
    this.intDiv = false;
    return r;
  }

  /** Bestehen alle Operanden aus Ganzzahlen? (für / -> div bzw. //) */
  allInt(text) {
    if (!this.cur) return false;
    const toks = P.ptoks(text);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'str') return false;
      if (t.t === 'num' && /[.eE]/.test(t.v)) return false;
      if (t.t === 'id' && !(toks[i - 1] && toks[i - 1].v === '.') && !(toks[i + 1] && toks[i + 1].v === '(')) {
        if (['div', 'mod', 'and', 'or', 'not'].includes(t.v.toLowerCase())) continue;
        if (P.normType(this.cur.types.get(t.v)) !== 'int') return false;
      }
    }
    return true;
  }

  comment(text) { return (this.lang === 'python' ? '# ' : '// ') + text; }

  /** Variablen-Analyse einer Routine */
  analyze(root, sig) {
    const types = new Map();
    const explicit = new Set();
    const params = new Set();
    // ausdrücklich angegebene Typen genau so (float bleibt float, long bleibt long)
    const rawTypes = new Map();
    for (const p of sig.params) if (P.canonType(p.type)) rawTypes.set(p.name, p.type);
    walk(root.children, (el) => {
      if (!['instruction', 'call'].includes(el.type)) return;
      for (const l of linesOf(el)) {
        const c = P.classifyLine(l);
        if (c.kind === 'decl' && c.type && P.canonType(c.type)) for (const d of c.decls) if (!d.suffix) rawTypes.set(d.name, c.type);
      }
    });
    for (const p of sig.params) {
      params.add(p.name);
      types.set(p.name, P.normType(p.type) || p.inferredType || (this.inferringParams ? null : this.defaultParamType()));
    }
    const fnTypes = new Map([...this.funcs].map(([k, v]) => [k, { returnType: v.returnType || v.inferredReturn }]));
    // Pass 1: Typen sammeln (zweimal für einfache Propagation)
    for (let pass = 0; pass < 2; pass++) {
      walk(root.children, (el) => {
        if (el.disabled) return false;
        if (el.type === 'for') {
          const f = P.parseForText(linesOf(el).join(' '));
          if (f && f.kind === 'count' && SIMPLE_IDENT.test(f.var) && !types.has(f.var)) {
            const t = [f.start, f.end, f.step].map((e) => P.inferType(e, types, fnTypes)).includes('double') ? 'double' : 'int';
            types.set(f.var, t);
          }
          if (f && f.kind === 'each' && SIMPLE_IDENT.test(f.var) && !types.has(f.var)) {
            const ct = P.inferType(f.coll, types, fnTypes);
            if (ct && ct.endsWith('[]')) types.set(f.var, ct.slice(0, -2));
            else if (ct === 'string') types.set(f.var, 'char');
          }
          return;
        }
        if (!['instruction', 'call', 'jump'].includes(el.type)) return;
        for (const line of linesOf(el)) {
          const c = P.classifyLine(line);
          if (c.kind === 'decl') {
            for (const d of c.decls) {
              explicit.add(d.name);
              let t = c.type ? P.normType(c.type) : (d.init ? P.inferType(d.init, types, fnTypes) : null);
              if (t && d.suffix) t += '[]';
              if (t) types.set(d.name, t);
            }
          } else if (c.kind === 'assign' && SIMPLE_IDENT.test(c.target)) {
            const t = P.inferType(c.expr, types, fnTypes);
            if (!types.has(c.target)) { if (t) types.set(c.target, t); }
            // rabatt := 0 … rabatt := 0.15 → Kommazahl (sonst passt 0.15 nicht in die Ganzzahl-Variable)
            else if (t === 'double' && types.get(c.target) === 'int' && !explicit.has(c.target) && !params.has(c.target)) types.set(c.target, 'double');
          }
        }
      });
    }
    // Typ aus der Verwendung raten (z.B. INPUT x ... x > 3  -> int)
    const NUMOPS = new Set(['+', '-', '*', '/', '%', '<', '>', '<=', '>=', '=', '<>', '!=', '==']);
    const guess = (text) => {
      const toks = P.ptoks(text);
      toks.forEach((t, i) => {
        if (t.t !== 'id' || types.get(t.v) || explicit.has(t.v)) return;
        if (toks[i - 1] && toks[i - 1].v === '.') return;
        const check = (op, other) => {
          if (!op || !other || !NUMOPS.has(op.v)) return;
          if (other.t === 'num') types.set(t.v, /[.eE]/.test(other.v) ? 'double' : 'int');
          else if (other.t === 'str' && (op.v === '=' || op.v === '<>' || op.v === '+')) types.set(t.v, 'string');
          else if (other.t === 'id' && ['int', 'double'].includes(P.normType(types.get(other.v)))) types.set(t.v, P.normType(types.get(other.v)));
        };
        check(toks[i + 1], toks[i + 2]);
        if (!types.get(t.v)) check(toks[i - 1], toks[i - 2]);
      });
    };
    walk(root.children, (el) => {
      if (el.type === 'for') {
        const f = P.parseForText(linesOf(el).join(' '));
        if (f && f.kind === 'count') [f.start, f.end].forEach((e) => { const toks = P.ptoks(e); if (toks.length === 1 && toks[0].t === 'id' && !types.get(toks[0].v)) types.set(toks[0].v, 'int'); else guess(e); });
        return;
      }
      for (const line of linesOf(el)) {
        const c = P.classifyLine(line);
        if (c.kind === 'assign') guess(c.expr); else if (c.kind !== 'input' && c.kind !== 'decl') guess(c.expr || line);
        if (c.kind === 'output') c.items.forEach(guess);
      }
    });

    // Pass 2: Deklarationsorte bestimmen
    const seen = new Set(params);
    const inline = new Map();
    const hoist = new Set();
    const forDecl = new Map();
    const all = new Set();
    const note = (el, name) => { if (!inline.has(el)) inline.set(el, new Set()); inline.get(el).add(name); };
    walk(root.children, (el, depth) => {
      if (el.disabled) return false;
      if (['instruction', 'call', 'jump'].includes(el.type)) {
        for (const line of linesOf(el)) {
          const c = P.classifyLine(line);
          const assigned = [];
          if (c.kind === 'decl') c.decls.forEach((d) => { seen.add(d.name); all.add(d.name); });
          else if (c.kind === 'assign') assigned.push(...c.target.split(',').map((s) => s.trim()));
          else if (c.kind === 'input') assigned.push(...c.vars);
          for (const name of assigned) {
            if (!SIMPLE_IDENT.test(name)) continue;
            all.add(name);
            if (seen.has(name) || explicit.has(name) || params.has(name)) continue;
            if (depth === 0 && !c.target?.includes(',')) note(el, name); else hoist.add(name);
            seen.add(name);
          }
          identsOf(line).forEach((n) => seen.add(n));
        }
      } else if (el.type === 'for') {
        const f = P.parseForText(linesOf(el).join(' '));
        if (f && (f.kind === 'count' || f.kind === 'each') && SIMPLE_IDENT.test(f.var)) {
          all.add(f.var);
          forDecl.set(el, !seen.has(f.var) && !explicit.has(f.var) && !params.has(f.var));
          identsOf(f.kind === 'count' ? `${f.start} ${f.end} ${f.step}` : f.coll).forEach((n) => seen.add(n));
        }
      } else {
        identsOf(linesOf(el).join(' ')).forEach((n) => seen.add(n));
      }
    });
    // Fehlervariablen von TRY-Elementen sind Zeichenketten (Fehlermeldung)
    walk(root.children, (el) => {
      if (el.type !== 'try') return;
      const v = this.catchVar(el);
      all.add(v);
      if (!types.get(v)) types.set(v, 'string');
    });
    for (const n of all) if (!types.has(n)) types.set(n, null);
    return { types, rawTypes, explicit, params, inline, hoist, forDecl, all, declared: new Set(), fnTypes };
  }

  defaultParamType() { return 'int'; }

  inferReturn(root, sig, types) {
    let t = null, any = false;
    const fnTypes = new Map([...this.funcs].map(([k, v]) => [k, { returnType: v.returnType || v.inferredReturn }]));
    walk(root.children, (el) => {
      if (!['instruction', 'call', 'jump'].includes(el.type)) return;
      for (const l of linesOf(el)) {
        const c = P.classifyLine(l);
        if (c.kind === 'return' && c.expr) {
          any = true;
          if (!t) {
            const toks = P.ptoks(c.expr);
            if (toks.length === 1 && toks[0].t === 'id' && toks[0].v === sig.name) continue;
            t = P.inferType(c.expr, types, fnTypes);
          }
        }
      }
    });
    if (!any) {
      // Pascal-Stil: Funktionsname := Wert
      walk(root.children, (el) => {
        for (const l of linesOf(el)) { const c = P.classifyLine(l); if (c.kind === 'assign' && c.target === sig.name) { any = true; t = t || P.inferType(c.expr, types, fnTypes); } }
      });
    }
    return any ? (t || 'int') : null;
  }

  retType(sig) { return (sig.returnType && P.canonType(sig.returnType) ? sig.returnType : P.normType(sig.returnType)) || sig.inferredReturn || null; }

  /** genauer Typ einer Variable (wie deklariert) oder der vereinheitlichte */
  declType(name) {
    const raw = this.cur && this.cur.rawTypes && this.cur.rawTypes.get(name);
    return raw || (this.cur ? this.cur.types.get(name) : null);
  }

  /** Typname in der Zielsprache für einen ausdrücklich angegebenen einfachen Typ (oder null) */
  exactType(t) {
    const c = P.canonType(t);
    return c && EXACT_TYPES[this.lang] ? EXACT_TYPES[this.lang][c] || null : null;
  }

  /**
   * Wert an einen engeren Zieltyp anpassen (Java/C#/Kotlin/Rust wandeln nicht von selbst):
   * float x := 1.5 -> 1.5f,  float x := a * 2 -> (float) (a * 2),  Kotlin .toFloat(),  Rust as f32
   */
  narrow(type, code) {
    const c = P.canonType(type);
    if (!c || code == null) return code;
    const L = this.lang;
    const v = String(code).trim();
    const isNum = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v);
    const isInt = /^-?\d+$/.test(v);
    const wrap = /^[\p{L}_][\p{L}\p{N}_.]*(\([^()]*\))?$/u.test(v) ? v : `(${v})`;
    if (L === 'java' || L === 'csharp') {
      if (c === 'float') return isNum ? v.replace(/[fFdD]$/, '') + 'f' : `(float) ${wrap}`;
      if (c === 'short' || c === 'byte') return isInt ? v : `(${c}) ${wrap}`;
      if (c === 'long') return isInt ? v + 'L' : v;
    } else if (L === 'kotlin') {
      if (c === 'float') return isNum ? v + 'f' : `${wrap}.toFloat()`;
      if (c === 'long') return isInt ? v : `${wrap}.toLong()`;
      if (c === 'short') return isInt ? v : `${wrap}.toShort()`;
      if (c === 'byte') return isInt ? v : `${wrap}.toByte()`;
      if (c === 'double') return isInt ? v + '.0' : v;
    } else if (L === 'rust') {
      const rt = EXACT_TYPES.rust[c];
      if (c === 'float' || c === 'double') return isInt ? v + '.0' : isNum ? v : this.rustCastOperands(v, rt);
      if (['long', 'short', 'byte'].includes(c)) return isInt ? v : this.rustCastOperands(v, rt);
    }
    return code;
  }

  /** Rust rechnet nicht mit gemischten Typen: jeden Operanden (Variable, Aufruf) einzeln umwandeln */
  rustCastOperands(code, rt) {
    const { tokenize, matchClose, joinTokens } = require('./tokenizer');
    const T = tokenize(code, 'c');
    const out = [];
    const KW = new Set(['as', 'true', 'false', 'if', 'else', 'let', 'mut']);
    const float = rt === 'f32' || rt === 'f64';
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      const prev = T[i - 1];
      if (t.t === 'num' && float && /^\d+$/.test(t.v) && !(prev && prev.v === '[')) { out.push({ ...t, v: t.v + '.0' }); continue; }
      if (t.t !== 'id' || KW.has(t.v) || (prev && (prev.v === '.' || prev.v === 'as' || prev.v === '::')) || (T[i + 1] && (T[i + 1].v === '.' || T[i + 1].v === '::' || T[i + 1].v === '!'))) { out.push(t); continue; }
      let end = i;
      if (T[i + 1] && T[i + 1].v === '(') end = matchClose(T, i + 1);
      else if (T[i + 1] && T[i + 1].v === '[') end = matchClose(T, i + 1);
      if (end < 0) { out.push(t); continue; }
      const operand = joinTokens(T.slice(i, end + 1));
      out.push({ t: 'id', v: `(${operand} as ${rt})`, ws: t.ws });
      i = end;
    }
    return joinTokens(out);
  }

  typeOf(name) { return this.cur && this.cur.types.get(name); }

  exprType(e) { return P.inferType(e, this.cur ? this.cur.types : new Map(), this.cur ? this.cur.fnTypes : new Map()); }

  cond(lines, kws) {
    let s = (Array.isArray(lines) ? lines : [lines]).map((l) => l.trim()).filter(Boolean).join(' ');
    s = P.stripKeyword(s, kws).replace(/\s*\?$/, '').replace(/\s+then$/i, '');
    return s || 'true';
  }

  /** Teile einer OUTPUT-Anweisung: {lit} (Inhalt mit Escapes) oder {expr} (Pseudocode) */
  outParts(items) {
    return items.map((it) => {
      const toks = P.ptoks(it);
      if (toks.length === 1 && toks[0].t === 'str') return { lit: P.literalInner(toks[0].v) };
      return { expr: it };
    });
  }

  needsParens(text) {
    const toks = P.ptoks(text);
    let depth = 0;
    for (const t of toks) {
      if (t.t === 'op' && OPEN[t.v]) depth++;
      else if (t.t === 'op' && CLOSE[t.v]) depth--;
      else if (depth === 0 && ((t.t === 'op' && t.v !== '.') || (t.t === 'id' && ['and', 'or', 'not', 'div', 'mod', 'xor'].includes(t.v.toLowerCase())))) return true;
    }
    return false;
  }

  elComments(el, ind) {
    const out = [];
    for (const c of el.comment || []) if (String(c).trim()) out.push(ind + this.comment(String(c).trim()));
    return out;
  }

  seq(list, ind) {
    const out = [];
    for (const el of list) out.push(...this.el(el, ind));
    return out;
  }

  /** Variablen, die ein einzelnes Element (ohne Unterelemente) setzt oder liest */
  elVars(el, v) {
    const lines = linesOf(el);
    if (['instruction', 'call', 'jump'].includes(el.type)) {
      for (const l0 of lines) {
        const l = this.procLine(l0);
        if (l == null) continue;
        const c = P.classifyLine(l);
        if (c.kind === 'decl') c.decls.forEach((d) => v.locals.add(d.name));
        else if (c.kind === 'assign') c.target.split(',').map((s) => s.trim()).filter((s) => SIMPLE_IDENT.test(s)).forEach((s) => v.writes.add(s));
        else if (c.kind === 'input') c.vars.filter((s) => SIMPLE_IDENT.test(s)).forEach((s) => v.writes.add(s));
        identsOf(l).forEach((n) => v.reads.add(n));
      }
      return;
    }
    if (el.type === 'for') {
      const f = P.parseForText(lines.join(' '));
      if (f && (f.kind === 'count' || f.kind === 'each') && SIMPLE_IDENT.test(f.var)) { v.writes.add(f.var); v.loops.add(f.var); }
    }
    if (el.type === 'try') v.writes.add(this.catchVar(el));
    identsOf(lines.join(' ')).forEach((n) => v.reads.add(n));
  }

  /** Variablen eines Zweigs einer Parallelverarbeitung: gelesen, gesetzt, im Zweig deklariert, Zählvariablen */
  parVars(seq) {
    const v = { reads: new Set(), writes: new Set(), locals: new Set(), loops: new Set() };
    walk(seq, (el) => { if (el.disabled) return false; this.elVars(el, v); });
    return v;
  }

  nextThread() { return (this.threadCount = (this.threadCount || 0) + 1); }

  /** Zweige mit Inhalt (leere Zweige brauchen keinen Thread) */
  parBranches(el) {
    return el.branches.filter((b) => b.some((e) => !e.disabled && (!['instruction', 'call'].includes(e.type) || linesOf(e).length)));
  }

  /** Parallelverarbeitung ohne Threads: Zweige nacheinander */
  parallelSeq(el, ind, key) {
    const out = [ind + this.comment(tr(key))];
    el.branches.forEach((b, i) => { out.push(ind + this.comment(tr('gen.branch', i + 1))); out.push(...this.seq(b, ind)); });
    return out;
  }

  parallelEl(el, ind) { return this.parallelSeq(el, ind, 'gen.parallelSeq'); }

  /** Wird diese Schleife von einem „leave n“ (n > 1) weiter innen verlassen? */
  loopNeedsLabel(loop) {
    const LOOPS = ['for', 'while', 'repeat', 'forever'];
    const scan = (seq, d) => seq.some((e) => {
      if (e.type === 'jump' && linesOf(e).some((l) => { const c = P.classifyLine(l); return c.kind === 'leave' && c.count > 1 && c.count === d + 1; })) return true;
      if (LOOPS.includes(e.type)) return scan(e.body, d + 1);
      return require('./model').sequencesOf(e).some((s) => scan(s.seq, d));
    });
    return scan(loop.body || [], 0);
  }

  /** leave n: mehrere Schleifen verlassen */
  leaveN(count, ind) {
    const stack = this.loopStack || [];
    const label = stack[stack.length - count];
    if (!label) return null;
    switch (this.lang) {
      case 'java': case 'javascript': return [ind + `break ${label};`];
      case 'kotlin': return [ind + `break@${label}`];
      case 'rust': return [ind + `break '${label.toLowerCase()};`];
      case 'c': case 'cpp': case 'csharp': case 'pascal': return [ind + `goto ${label};`];
      case 'python': return [ind + `raise _Leave${label}()`];
      default: return [ind + this.comment(tr('gen.leaveN', count)), ...this.stmt({ kind: 'leave' }, ind)];
    }
  }

  el(el, ind) {
    const LOOPS = ['for', 'while', 'repeat', 'forever'];
    if (LOOPS.includes(el.type) && !el.disabled) {
      const label = this.loopNeedsLabel(el) ? `L${(this.labelCount = (this.labelCount || 0) + 1)}` : null;
      this.loopStack = this.loopStack || [];
      this.loopStack.push(label);
      let out;
      try { out = this.elInner(el, ind); } finally { this.loopStack.pop(); }
      if (label) {
        const k = out.findIndex((l) => l.startsWith(ind) && !l.slice(ind.length).startsWith(this.comment('').trim()));
        const pre = { java: `${label}: `, javascript: `${label}: `, kotlin: `${label}@ `, rust: `'${label.toLowerCase()}: ` }[this.lang];
        if (pre && k >= 0) out[k] = ind + pre + out[k].slice(ind.length);
        if (['c', 'cpp', 'csharp', 'pascal'].includes(this.lang)) out.push(ind + `${label}: ;`);
        if (this.lang === 'pascal') { this.pasLabels = this.pasLabels || []; this.pasLabels.push(label); }
        if (this.lang === 'python') {
          // Python hat keine Sprungmarken: eigene Ausnahme verlässt alle inneren Schleifen
          this.needs.add('leave:' + label);
          const loopLines = out.slice(k);
          out.splice(k, out.length - k, ind + 'try:', ...loopLines.map((l) => this.I + l), ind + `except _Leave${label}:`, ind + this.I + 'pass');
        }
      }
      return out;
    }
    return this.elInner(el, ind);
  }

  elInner(el, ind) {
    const out = this.elComments(el, ind);
    if (el.disabled) { out.push(ind + this.comment(tr('gen.disabled', linesOf(el).join(' | ')))); return out; }
    switch (el.type) {
      case 'instruction': case 'call': case 'jump': {
        const lines = linesOf(el);
        if (el.type === 'jump' && !lines.length) out.push(...this.stmt({ kind: 'leave' }, ind, el));
        for (const l of lines) {
          const pl = this.procLine(l);
          if (pl == null) continue;
          const c = P.classifyLine(pl);
          if (c.kind === 'typedef') continue; // Typdefinitionen stehen am Dateianfang (typeDefs)
          const multi = c.kind === 'leave' && c.count > 1 ? this.leaveN(c.count, ind) : null;
          out.push(...(multi || this.stmt(c, ind, el)));
        }
        break;
      }
      case 'try': out.push(...this.tryEl(el, ind)); break;
      case 'alternative': out.push(...this.ifEl(el, ind)); break;
      case 'case': { const cb = this.condCaseBranches(el); out.push(...(cb ? this.condCaseEl(el, ind, cb) : this.caseEl(el, ind))); break; }
      case 'for': out.push(...this.forEl(el, ind)); break;
      case 'while': out.push(...this.whileEl(this.cond(el.text, ['while', 'solange', 'während']), el.body, ind)); break;
      case 'repeat': out.push(...this.repeatEl(this.cond(el.text, ['until', 'bis', 'solange']), el.body, ind)); break;
      case 'forever': out.push(...this.whileEl('true', el.body, ind)); break;
      case 'parallel': out.push(...this.parallelEl(el, ind)); break;
      default: out.push(ind + this.comment(tr('gen.unknownEl', el.type)));
    }
    return out;
  }

  /**
   * Structorizer-Prozeduren als Zuweisung schreiben:
   * inc(x[, d]) -> x := x + d,  insert(w, s, i) -> s := insert(w, s, i),  delete(s, i, n) -> s := delete(s, i, n),
   * randomize() entfällt (null). Pascal kennt Insert/Delete selbst.
   */
  procLine(line) {
    const { matchClose, splitTop } = require('./tokenizer');
    const toks = P.ptoks(line);
    if (toks.length < 3 || toks[0].t !== 'id' || toks[1].v !== '(' || matchClose(toks, 1) !== toks.length - 1) return line;
    if (this.funcs.has(toks[0].v)) return line;
    const n = toks[0].v.toLowerCase();
    const args = splitTop(toks.slice(2, -1), ',').filter((p) => p.length).map(joinTokens);
    const par = (s) => (/^[\p{L}\p{N}_.]+$/u.test(s) ? s : `(${s})`);
    switch (n) {
      case 'randomize': return null;
      case 'inc': case 'dec': return args.length ? `${args[0]} := ${args[0]} ${n === 'inc' ? '+' : '-'} ${args[1] ? par(args[1]) : '1'}` : line;
      case 'insert': return this.lang === 'pascal' || args.length !== 3 ? line : `${args[1]} := insert(${args.join(', ')})`;
      case 'delete': return this.lang === 'pascal' || args.length !== 3 ? line : `${args[0]} := delete(${args.join(', ')})`;
      default: return line;
    }
  }

  /** Name der Fehlervariable eines TRY-Elements */
  catchVar(el) { return String((el.text || [])[0] || '').trim() || tr('core.defErrorVar'); }

  /** TRY ohne Ausnahmen in der Zielsprache (C, Rust): try- und finally-Teil nacheinander */
  tryEl(el, ind) {
    const out = [ind + this.comment(tr('gen.noTry', this.catchVar(el)))];
    out.push(...this.seq(el.qTry, ind));
    if (el.qFinally.length) { out.push(ind + this.comment('finally')); out.push(...this.seq(el.qFinally, ind)); }
    return out;
  }

  /** Records und Aufzählungen aus allen Diagrammen (type X = record{…} / enum{…}) */
  collectTypes() {
    const recs = new Map(), enums = [];
    for (const r of this.doc.roots) {
      walk(r.children, (el) => {
        if (!['instruction', 'call'].includes(el.type)) return;
        for (const l of linesOf(el)) {
          const c = P.classifyLine(l);
          if (c.kind !== 'typedef') continue;
          if (c.typeKind === 'enum') {
            let next = 0, base = null;
            for (const it of c.items) {
              if (it.value != null && it.value !== '') {
                if (/^-?\d+$/.test(it.value.trim())) { next = parseInt(it.value, 10); base = null; } else { base = it.value; next = 0; }
              }
              if (!enums.some((e) => e.name === it.name)) enums.push({ name: it.name, value: base ? (next ? `${base} + ${next}` : base) : String(next) });
              next++;
            }
          } else recs.set(c.name, c.fields.map((f) => ({ name: f.name, type: P.normType(f.type) || 'int' })));
        }
      });
    }
    this.recordTypes = recs;
    this.enumConsts = enums;
  }

  /** Vorgabewert eines einfachen Typs als Literal der Zielsprache */
  litDefault(t) {
    const n = P.normType(t);
    if (this.recordTypes && this.recordTypes.has(n)) return this.recordNew(n, []);
    const py = this.lang === 'python', pas = this.lang === 'pascal';
    return { int: '0', double: '0.0', string: pas ? "''" : '""', boolean: py ? 'False' : 'false', char: pas ? "' '" : "' '" }[n] || (py ? 'None' : '0');
  }

  /** Record-Literal Punkt{x: 3, y: 4} -> Zielsprache; vals: übersetzte Werte in Feldreihenfolge (fehlende = null) */
  recordNew(type, vals) {
    const fields = this.recordTypes.get(type) || [];
    const v = fields.map((f, k) => (vals[k] != null ? vals[k] : this.litDefault(f.type)));
    switch (this.lang) {
      case 'python': return `${type}(${v.join(', ')})`;
      case 'java': case 'csharp': return `new ${type}(${v.join(', ')})`;
      case 'javascript': return `({ ${fields.map((f, k) => `${f.name}: ${v[k]}`).join(', ')} })`;
      case 'c': return `(${type}){ ${v.join(', ')} }`;
      case 'cpp': return `${type}{ ${v.join(', ')} }`;
      case 'kotlin': return `${type}(${v.join(', ')})`;
      case 'rust': return `${type} { ${fields.map((f, k) => `${f.name}: ${v[k]}`).join(', ')} }`;
      case 'pascal': return `Make${type}(${v.join(', ')})`;
      default: return `${type}(${v.join(', ')})`;
    }
  }

  /** Aus translateExpr: Record-Literal mit Pseudocode-Werten [{name|null, src}] */
  recordLiteral(type, entries) {
    const fields = this.recordTypes.get(type) || [];
    const vals = fields.map(() => null);
    entries.forEach((e, k) => {
      const idx = e.name ? fields.findIndex((f) => f.name === e.name) : k;
      if (idx < 0 || idx >= fields.length) return;
      vals[idx] = typeof this.val === 'function' ? this.val(fields[idx].type, e.src) : this.x(e.src);
    });
    return this.recordNew(type, vals);
  }

  /** Fall-Marken einer Fallauswahl (wie Structorizer: letzter Zweig = default, außer Marke "%") */
  caseInfo(el) {
    const { splitTop } = require('./tokenizer');
    const labels = el.text.slice(1);
    const n = el.branches.length;
    const res = [];
    for (let k = 0; k < n; k++) {
      const label = (labels[k] == null ? '' : String(labels[k])).trim();
      const isLast = k === n - 1;
      if (isLast && label === '%') continue;
      const values = isLast ? [] : splitTop(P.ptoks(label), ',').map(joinTokens).filter(Boolean);
      res.push({ isDefault: isLast, values, body: el.branches[k] });
    }
    return res;
  }

  /**
   * Fallauswahl mit Bedingungen statt Konstanten: „case true of  kdnr < 2000: …“ (bzw. „case false of“).
   * Wie im Interpreter (und im Structorizer) wird der Ausdruck mit jeder Marke verglichen – bei true/false ist
   * die Marke also eine Bedingung. Liefert je Zweig die Bedingung (Pseudocode) – [{ cond, body, isDefault }] –
   * oder null für eine gewöhnliche Fallauswahl.
   */
  condCaseBranches(el) {
    const lit = String(el.text[0] || '').trim().toLowerCase();
    if (!['true', 'false', 'wahr', 'falsch'].includes(lit)) return null;
    const neg = lit === 'false' || lit === 'falsch';
    const par = (v) => (this.needsParens(v) ? `(${v})` : v);
    const condOf = (vals) => {
      if (!vals.length) return 'false';
      if (neg) return vals.map((v) => `not ${par(v)}`).join(' or ');
      // Klammern nur bei mehreren Marken (… or …)
      return vals.length === 1 ? vals[0] : vals.map(par).join(' or ');
    };
    return this.caseInfo(el).map((b) => ({ cond: b.isDefault ? null : condOf(b.values), body: b.body, isDefault: b.isDefault }));
  }

  /**
   * Fallauswahl mit Bedingungen erzeugen. Standard: if/else-if-Kette, weil switch/case in den meisten Sprachen
   * konstante Marken verlangt. Sprachen mit „switch auf true“ (JavaScript, C#, Kotlin, Rust) überschreiben das.
   */
  condCaseEl(el, ind, branches) {
    const def = branches.find((b) => b.isDefault);
    let tail = def ? def.body : [];
    for (const b of branches.filter((x) => !x.isDefault).reverse()) {
      tail = [{ type: 'alternative', text: [b.cond], qTrue: b.body, qFalse: tail }];
    }
    return this.seq(tail, ind);
  }

  run() { throw new Error('abstract'); }
}

/* ==================================================================== */
/* C-Familie: Java, C, C++, C#, JavaScript                               */
/* ==================================================================== */
class CGen extends BaseGen {
  typeName(t, fallback = 'int') {
    if (this.lang === 'javascript') return 'let';
    const ex = this.exactType(t);
    if (ex) {
      if (ex === 'bool' && this.lang === 'c') this.needs.add('stdbool');
      if (ex === 'string' && this.lang === 'cpp') this.needs.add('string');
      return ex;
    }
    const arrRaw = /^(.*?)\s*\[\s*\]$/.exec(String(t || ''));
    if (arrRaw && this.exactType(arrRaw[1])) return this.typeName(arrRaw[1]) + '[]';
    let n = P.normType(t) || null;
    if (!n) {
      if (this.lang === 'java' || this.lang === 'csharp') return fallback === 'var' ? 'var' : TYPE_MAP[this.lang][fallback] || fallback;
      if (this.lang === 'cpp') return fallback === 'var' ? 'auto' : TYPE_MAP.cpp[fallback] || fallback;
      return TYPE_MAP.c[fallback] || 'int';
    }
    if (n.endsWith('[]')) {
      const base = this.typeName(n.slice(0, -2), fallback);
      return base + '[]';
    }
    if (n === 'boolean' && this.lang === 'c') this.needs.add('stdbool');
    if (n === 'string' && this.lang === 'cpp') this.needs.add('string');
    return (TYPE_MAP[this.lang] && TYPE_MAP[this.lang][n]) || n;
  }

  /** Deklaration (mit/ohne Initialisierung) */
  declLine(name, type, init, isConst) {
    const L = this.lang;
    if (init != null && !/\[/.test(name)) init = this.narrow(type, init);
    if (L === 'javascript') {
      let v = init;
      if (v != null && /^\{.*\}$/.test(v.trim())) v = '[' + v.trim().slice(1, -1) + ']';
      return `${isConst ? 'const' : 'let'} ${name}${v != null ? ' = ' + v : ''};`;
    }
    let tn = this.typeName(type, init != null && (L === 'java' || L === 'csharp' || L === 'cpp') ? 'var' : 'int');
    let nm = name;
    const arr = /^(.*?)(\[.*\])$/.exec(name);
    if (arr) { nm = arr[1]; }
    if (tn.endsWith('[]') && (L === 'c' || L === 'cpp')) { tn = tn.slice(0, -2); nm = nm + (arr ? arr[2] : '[]'); }
    else if (arr && (L === 'c' || L === 'cpp')) nm = name;
    else if (arr && (L === 'java' || L === 'csharp')) { tn = tn + '[]'; if (init == null) init = `new ${this.typeName(type)}${arr[2]}`; }
    if (L === 'c' && P.normType(type) === 'string' && this.cur && this.cur.charArrays.has(name)) { tn = 'char'; nm = name + '[256]'; this.needs.add('string'); if (init != null) return `${tn} ${nm} = ${init};`; }
    let v = init;
    if (v != null && /^\[.*\]$/.test(v.trim()) && require('./tokenizer').isWrapped(P.ptoks(v.trim()), '[')) v = '{' + v.trim().slice(1, -1) + '}';
    if (L === 'csharp' && v != null && /^\{.*\}$/.test(v.trim()) && tn === 'var') v = 'new[] ' + v;
    if (L === 'java' && v != null && /^\{.*\}$/.test(v.trim()) && tn === 'var') tn = this.typeName(this.exprType(init) || 'int[]');
    const cst = isConst ? (L === 'java' ? 'final ' : L === 'csharp' ? 'const ' : 'const ') : '';
    return `${cst}${tn} ${nm}${v != null ? ' = ' + v : ''};`;
  }

  stmt(c, ind, el) {
    const L = this.lang;
    switch (c.kind) {
      case 'empty': return [];
      case 'decl':
        return c.decls.map((d) => {
          this.cur.declared.add(d.name);
          const t = c.type || this.typeOf(d.name);
          const rec = !d.suffix && this.recordTypes.has(P.normType(t));
          return ind + this.declLine(d.name + (d.suffix || ''), t, d.init != null ? this.x(d.init) : rec ? this.recordNew(P.normType(t), []) : null, c.isConst);
        });
      case 'assign': {
        const target = c.target;
        if (target.includes(',') && !/[[(]/.test(target)) return this.tupleAssign(c, ind);
        const n = target.trim();
        if (this.cur.inline.get(el) && this.cur.inline.get(el).has(n) && !this.cur.declared.has(n)) {
          this.cur.declared.add(n);
          return [ind + this.declLine(n, this.typeOf(n), this.x(c.expr))];
        }
        if (L === 'c' && this.cur.charArrays.has(n) && P.isStringLiteral(c.expr)) { this.needs.add('string'); return [ind + `strcpy(${n}, ${this.x(c.expr)});`]; }
        let v = this.x(c.expr);
        if (L === 'javascript' && /^\{.*\}$/.test(v)) v = '[' + v.slice(1, -1) + ']';
        if (SIMPLE_IDENT.test(n)) v = this.narrow(this.declType(n), v);
        return [ind + `${this.x(target)} = ${v};`];
      }
      case 'input': return this.inputStmt(c, ind, el);
      case 'output': return [ind + this.outputStmt(c.items)];
      case 'return': {
        if (this.curIsMain && (L === 'c' || L === 'cpp')) return [ind + `return ${c.expr ? this.x(c.expr) : '0'};`];
        if (this.curIsMain && c.expr && c.expr.trim() !== '0') return this.stmt({ kind: 'exit', expr: c.expr }, ind, el);
        if (this.curIsMain) return [ind + (L === 'javascript' ? 'process.exit(0);' : 'return;')];
        return [ind + (c.expr ? `return ${this.narrow(this.curSig ? this.retType(this.curSig) : null, this.x(c.expr))};` : 'return;')];
      }
      case 'exit': {
        const code = c.expr ? this.x(c.expr) : '0';
        if (L === 'java') return [ind + `System.exit(${code});`];
        if (L === 'csharp') return [ind + `Environment.Exit(${code});`];
        if (L === 'javascript') return [ind + `process.exit(${code});`];
        this.needs.add('stdlib');
        return [ind + `exit(${code});`];
      }
      case 'leave': return [ind + 'break;'];
      case 'continue': return [ind + 'continue;'];
      case 'throw': {
        const e = this.x(c.expr);
        const lit = P.isStringLiteral(c.expr);
        if (L === 'java') return [ind + (lit ? `throw new RuntimeException(${e});` : `throw ${e};`)];
        if (L === 'csharp') return [ind + (lit ? `throw new Exception(${e});` : `throw ${e};`)];
        if (L === 'javascript') return [ind + (lit ? `throw new Error(${e});` : `throw ${e};`)];
        if (L === 'cpp') { this.needs.add('stdexcept'); return [ind + (lit ? `throw runtime_error(${e});` : `throw ${e};`)]; }
        this.needs.add('stdlib');
        this.needs.add('cthrow');
        return [ind + `_throw(${lit ? e : '"Fehler"'});`];
      }
      default: {
        // Pascal-Stil "Funktionsname := Wert" wird oben als assign erkannt
        return [ind + this.x(c.expr) + ';'];
      }
    }
  }

  tupleAssign(c, ind) {
    const targets = c.target.split(',').map((s) => s.trim());
    const toks = P.ptoks(c.expr);
    const vals = require('./tokenizer').splitTop(toks, ',').map(joinTokens);
    if (vals.length !== targets.length) return [ind + this.comment(`TODO: ${c.target} = ${c.expr}`)];
    const out = [];
    vals.forEach((v, k) => out.push(ind + this.declLine(`_t${k}`, this.typeOf(targets[k]) || this.exprType(v), this.x(v))));
    targets.forEach((t, k) => {
      if (!this.cur.declared.has(t) && this.cur.hoist.has(t) === false && !this.cur.explicit.has(t) && !this.cur.params.has(t)) {
        this.cur.declared.add(t);
        out.push(ind + this.declLine(t, this.typeOf(t), `_t${k}`));
      } else out.push(ind + `${t} = _t${k};`);
    });
    return [ind + '{', ...out.map((l) => this.I + l), ind + '}'];
  }

  promptLine(prompt) {
    const p = this.x(prompt);
    switch (this.lang) {
      case 'java': return `System.out.print(${p});`;
      case 'csharp': return `Console.Write(${p});`;
      case 'cpp': return `cout << ${p};`;
      case 'c': return /%/.test(p) || !P.isStringLiteral(prompt) ? `printf("%s", ${p});` : `printf(${p});`;
      default: return null;
    }
  }

  inputStmt(c, ind, el) {
    const L = this.lang;
    const out = [];
    if (c.prompt && L !== 'javascript') out.push(ind + this.promptLine(c.prompt));
    if (!c.vars.length) {
      if (L === 'java') { this.needs.add('scanner'); out.push(ind + 'scanner.nextLine();'); }
      else if (L === 'csharp') out.push(ind + 'Console.ReadLine();');
      else if (L === 'cpp') out.push(ind + 'cin.get();');
      else if (L === 'c') out.push(ind + 'getchar();');
      else if (L === 'javascript') { this.needs.add('prompt'); out.push(ind + `prompt(${c.prompt ? this.x(c.prompt) : ''});`); }
      return out;
    }
    c.vars.forEach((v, k) => {
      const t = P.normType(this.typeOf(v)) || 'string';
      const ct = P.canonType(this.declType(v)) || t; // genauer Typ: float, long …
      const decl = this.cur.inline.get(el) && this.cur.inline.get(el).has(v) && !this.cur.declared.has(v);
      if (decl) this.cur.declared.add(v);
      const tv = this.x(v);
      if (L === 'java') {
        this.needs.add('scanner');
        const rd = { int: 'scanner.nextInt()', long: 'scanner.nextLong()', short: 'scanner.nextShort()', byte: 'scanner.nextByte()', float: 'scanner.nextFloat()', double: 'scanner.nextDouble()', boolean: 'scanner.nextBoolean()', char: 'scanner.next().charAt(0)' }[ct] || 'scanner.nextLine()';
        out.push(ind + (decl ? this.declLine(v, t, rd) : `${tv} = ${rd};`));
      } else if (L === 'csharp') {
        const rd = { int: 'int.Parse(Console.ReadLine())', long: 'long.Parse(Console.ReadLine())', short: 'short.Parse(Console.ReadLine())', byte: 'byte.Parse(Console.ReadLine())', float: 'float.Parse(Console.ReadLine())', double: 'double.Parse(Console.ReadLine())', boolean: 'bool.Parse(Console.ReadLine())', char: 'Console.ReadLine()[0]' }[ct] || 'Console.ReadLine()';
        out.push(ind + (decl ? this.declLine(v, t, rd) : `${tv} = ${rd};`));
      } else if (L === 'javascript') {
        this.needs.add('prompt');
        const pr = `prompt(${k === 0 && c.prompt ? this.x(c.prompt) : ''})`;
        const rd = t === 'int' || t === 'double' ? `Number(${pr})` : pr;
        out.push(ind + (decl ? `let ${v} = ${rd};` : `${tv} = ${rd};`));
      } else if (L === 'cpp') {
        if (decl) out.push(ind + this.declLine(v, t, null));
        out.push(ind + `cin >> ${tv};`);
      } else { // C
        if (decl) out.push(ind + this.declLine(v, t, null));
        const fmt = { int: '%d', long: '%lld', short: '%hd', byte: '%hhu', float: '%f', double: '%lf', char: ' %c', boolean: '%d' }[ct];
        if (fmt) out.push(ind + `scanf("${fmt}", &${tv});`);
        else out.push(ind + `scanf("%255s", ${tv});`);
      }
    });
    return out;
  }

  outputStmt(items) {
    const L = this.lang;
    const parts = this.outParts(items);
    if (L === 'javascript') {
      if (!parts.length) return 'console.log();';
      if (parts.length === 1) return `console.log(${parts[0].lit != null ? '"' + parts[0].lit + '"' : this.x(parts[0].expr)});`;
      const s = parts.map((p) => (p.lit != null ? p.lit.replace(/`/g, '\\`').replace(/\$\{/g, '\\${') : '${' + this.x(p.expr) + '}')).join('');
      return 'console.log(`' + s + '`);';
    }
    if (L === 'cpp') {
      const s = parts.map((p) => {
        if (p.lit != null) return '"' + p.lit + '"';
        // byte (unsigned char) als Zahl ausgeben, nicht als Zeichen
        if (SIMPLE_IDENT.test(p.expr.trim()) && P.canonType(this.declType(p.expr.trim())) === 'byte') return `(int) ${this.x(p.expr)}`;
        return this.needsParens(p.expr) ? '(' + this.x(p.expr) + ')' : this.x(p.expr);
      });
      return 'cout << ' +(s.length ? s.join(' << ') + ' << ' : '') + 'endl;';
    }
    if (L === 'c') {
      let fmt = '';
      const args = [];
      for (const p of parts) {
        if (p.lit != null) fmt += p.lit.replace(/%/g, '%%');
        else {
          const t = P.normType(this.exprType(p.expr));
          const ct = SIMPLE_IDENT.test(p.expr.trim()) ? P.canonType(this.declType(p.expr.trim())) : null;
          const spec = ct === 'long' ? '%lld' : { double: '%g', string: '%s', char: '%c' }[t] || '%d';
          fmt += spec;
          args.push(this.x(p.expr));
        }
      }
      return `printf("${fmt}\\n"${args.map((a) => ', ' + a).join('')});`;
    }
    const fn = L === 'java' ? 'System.out.println' : 'Console.WriteLine';
    if (!parts.length) return `${fn}();`;
    const s = parts.map((p) => (p.lit != null ? '"' + p.lit + '"' : (parts.length > 1 && this.needsParens(p.expr) ? '(' + this.x(p.expr) + ')' : this.x(p.expr))));
    if (parts.length > 1 && parts[0].lit == null && parts[1].lit == null) s.unshift('""');
    return `${fn}(${s.join(' + ')});`;
  }

  ifEl(el, ind) {
    const out = [];
    let cond = this.cond(el.text, ['if', 'wenn', 'falls']);
    let t = el.qTrue, f = el.qFalse;
    if (!t.length && f.length) { cond = P.negateCond(cond); [t, f] = [f, t]; }
    out.push(ind + `if (${this.x(cond)}) {`);
    out.push(...this.seq(t, ind + this.I));
    while (f.length === 1 && f[0].type === 'alternative' && !f[0].disabled && !(f[0].comment || []).some((s) => s.trim()) && f[0].qTrue.length) {
      out.push(ind + `} else if (${this.x(this.cond(f[0].text, ['if', 'wenn', 'falls']))}) {`);
      out.push(...this.seq(f[0].qTrue, ind + this.I));
      f = f[0].qFalse;
    }
    if (f.length) { out.push(ind + '} else {'); out.push(...this.seq(f, ind + this.I)); }
    out.push(ind + '}');
    return out;
  }

  caseEl(el, ind) {
    const out = [ind + `switch (${this.x(el.text[0] || '')}) {`];
    for (const b of this.caseInfo(el)) {
      if (b.isDefault) out.push(ind + this.I + 'default:');
      else for (const v of b.values) out.push(ind + this.I + `case ${this.x(v)}:`);
      out.push(...this.switchBody(b.body, ind));
    }
    out.push(ind + '}');
    return out;
  }

  /** Rumpf eines switch-Zweigs samt break (entfällt, wenn der Zweig ohnehin mit einem Sprung endet) */
  switchBody(body, ind) {
    const I2 = ind + this.I + this.I;
    const out = this.seq(body, I2);
    const last = body[body.length - 1];
    const ends = last && last.type === 'jump' && /^(return|exit|throw|leave|break|continue)\b/i.test(linesOf(last).join(' ').trim() || 'leave');
    if (!ends) out.push(I2 + 'break;');
    return out;
  }

  /**
   * Fallauswahl mit Bedingungen: JavaScript kennt switch (true) mit Bedingungen als Marken,
   * C# switch (true) mit „case true when Bedingung“; Java, C und C++ verlangen Konstanten → if/else-if-Kette.
   */
  condCaseEl(el, ind, branches) {
    const L = this.lang;
    if (L !== 'javascript' && L !== 'csharp') return super.condCaseEl(el, ind, branches);
    const out = [ind + 'switch (true) {'];
    for (const b of branches) {
      if (b.isDefault) out.push(ind + this.I + 'default:');
      else out.push(ind + this.I + (L === 'csharp' ? `case true when ${this.x(b.cond)}:` : `case ${this.x(b.cond)}:`));
      out.push(...this.switchBody(b.body, ind));
    }
    out.push(ind + '}');
    return out;
  }

  forEl(el, ind) {
    const L = this.lang;
    const text = linesOf(el).join(' ');
    const f = P.parseForText(text);
    const out = [];
    // Zählvariable gilt im Rumpf als deklariert (wichtig für Threads in Java)
    const fv = f && SIMPLE_IDENT.test(f.var) && !this.cur.declared.has(f.var) ? f.var : null;
    if (fv) this.cur.declared.add(fv);
    let body;
    try { body = this.seq(el.body, ind + this.I); } finally { if (fv) this.cur.declared.delete(fv); }
    if (!f) {
      out.push(ind + this.comment(tr('gen.todoLoop', text)));
      out.push(ind + 'while (true) {', ...body, ind + this.I + 'break;', ind + '}');
      return out;
    }
    const decl = this.cur.forDecl.get(el);
    if (f.kind === 'count') {
      const v = this.x(f.var);
      const tn = decl ? (L === 'javascript' ? 'let ' : this.typeName(this.typeOf(f.var) || 'int') + ' ') : '';
      if (decl && L === 'c') { /* C99 */ }
      const step = f.step.replace(/\s+/g, '');
      const neg = step.startsWith('-');
      const abs = neg ? step.slice(1).replace(/^\((.*)\)$/, '$1') : step;
      let cmp = neg ? '>=' : '<=';
      let end = f.end;
      const m = /^(.*?)\s*([+-])\s*1$/.exec(end);
      if (m && !neg && m[2] === '-' && !/[<>=]/.test(m[1])) { cmp = '<'; end = m[1]; }
      else if (m && neg && m[2] === '+' && !/[<>=]/.test(m[1])) { cmp = '>'; end = m[1]; }
      else if (/^-?\d+$/.test(end) && !neg) { /* bleibt */ }
      const inc = step === '1' ? `${v}++` : step === '-1' ? `${v}--` : neg ? `${v} -= ${this.x(abs)}` : `${v} += ${this.x(step)}`;
      out.push(ind + `for (${tn}${v} = ${this.x(f.start)}; ${v} ${cmp} ${this.x(end)}; ${inc}) {`);
    } else {
      const v = f.var;
      const coll = this.x(f.coll);
      const t = this.typeOf(v);
      switch (L) {
        case 'java': out.push(ind + `for (${t ? this.typeName(t) : 'var'} ${v} : ${coll}) {`); break;
        case 'csharp': out.push(ind + `foreach (${t ? this.typeName(t) : 'var'} ${v} in ${coll}) {`); break;
        case 'cpp': out.push(ind + `for (auto ${v} : ${coll}) {`); break;
        case 'javascript': out.push(ind + `for (const ${v} of ${coll}) {`); break;
        default:
          out.push(ind + this.comment(tr('gen.foreachC', v, f.coll)));
          out.push(ind + `for (int _i = 0; _i < (int)(sizeof(${coll}) / sizeof(${coll}[0])); _i++) {`);
          out.push(ind + this.I + `${t ? this.typeName(t) : 'int'} ${v} = ${coll}[_i];`);
      }
    }
    out.push(...body, ind + '}');
    return out;
  }

  whileEl(cond, body, ind) {
    const c = cond === 'true' ? (this.lang === 'c' ? '1' : 'true') : this.x(cond);
    return [ind + `while (${c}) {`, ...this.seq(body, ind + this.I), ind + '}'];
  }

  tryEl(el, ind) {
    const L = this.lang, I = this.I, v = this.catchVar(el);
    if (L === 'c') {
      // C: try/catch mit setjmp/longjmp nachgebildet (Hilfsfunktion _throw)
      this.needs.add('cthrow'); this.needs.add('stdlib');
      const out = [ind + '{', ind + I + 'jmp_buf* _prev = _try_env;', ind + I + 'jmp_buf _env;', ind + I + '_try_env = &_env;',
        ind + I + 'if (setjmp(_env) == 0) {', ...this.seq(el.qTry, ind + I + I), ind + I + I + '_try_env = _prev;',
        ind + I + '} else {', ind + I + I + '_try_env = _prev;', ind + I + I + `const char* ${v} = _try_msg;`, ...this.seq(el.qCatch, ind + I + I), ind + I + '}'];
      out.push(...this.seq(el.qFinally, ind + I), ind + '}');
      return out;
    }
    if (L === 'cpp') this.needs.add('stdexcept');
    const head = { java: '} catch (Exception _e) {', csharp: '} catch (Exception _e) {', javascript: '} catch (_e) {', cpp: '} catch (const exception& _e) {' }[L];
    const decl = { java: `String ${v} = _e.getMessage();`, csharp: `string ${v} = _e.Message;`, javascript: `const ${v} = _e instanceof Error ? _e.message : String(_e);`, cpp: `string ${v} = _e.what();` }[L];
    const wasDeclared = this.cur.declared.has(v);
    this.cur.declared.add(v);
    const out = [ind + 'try {', ...this.seq(el.qTry, ind + I), ind + head, ind + I + decl, ...this.seq(el.qCatch, ind + I)];
    if (!wasDeclared) this.cur.declared.delete(v);
    if (el.qFinally.length && L !== 'cpp') out.push(ind + '} finally {', ...this.seq(el.qFinally, ind + I));
    out.push(ind + '}');
    if (el.qFinally.length && L === 'cpp') out.push(ind + this.comment(tr('gen.cppFinally')), ...this.seq(el.qFinally, ind));
    return out;
  }

  /** C/C++: Hilfsfunktionen für Structorizer-Zeichenkettenfunktionen und throw */
  cppHelpers() {
    if (this.lang === 'c') return this.cHelpers();
    if (this.lang !== 'cpp') return [];
    const out = [];
    if (this.needs.has('strupper')) out.push('string str_upper(string s) { for (auto& c : s) c = toupper((unsigned char) c); return s; }');
    if (this.needs.has('strlower')) out.push('string str_lower(string s) { for (auto& c : s) c = tolower((unsigned char) c); return s; }');
    if (this.needs.has('strtrim')) out.push('string str_trim(const string& s) { size_t a = s.find_first_not_of(" \\t\\r\\n"); if (a == string::npos) return ""; size_t b = s.find_last_not_of(" \\t\\r\\n"); return s.substr(a, b - a + 1); }');
    if (out.length) { this.needs.add('string'); out.push(''); }
    return out;
  }

  cHelpers() {
    const out = [];
    const N = this.needs;
    const range = '    size_t ls = strlen(s); size_t k = i < 1 ? 0 : (size_t) (i - 1) > ls ? ls : (size_t) (i - 1);';
    if (N.has('cthrow')) {
      out.push('static jmp_buf* _try_env = NULL;', 'static const char* _try_msg = "";',
        tr('gen.cThrow'),
        'void _throw(const char* msg) {', '    if (_try_env) { _try_msg = msg; longjmp(*_try_env, 1); }', '    fprintf(stderr, "%s\\n", msg);', '    exit(1);', '}');
    }
    if (N.has('strupper') || N.has('strlower')) {
      for (const [n, f] of [['strupper', 'toupper'], ['strlower', 'tolower']]) {
        if (N.has(n)) out.push(`char* str_${n.slice(3)}(const char* s) {`, '    char* r = malloc(strlen(s) + 1);', '    size_t i = 0;', `    for (; s[i]; i++) r[i] = (char) ${f}((unsigned char) s[i]);`, '    r[i] = 0;', '    return r;', '}');
      }
    }
    if (N.has('strtrim')) out.push('char* str_trim(const char* s) {', '    while (isspace((unsigned char) *s)) s++;', '    size_t n = strlen(s);', '    while (n && isspace((unsigned char) s[n - 1])) n--;', '    char* r = malloc(n + 1);', '    memcpy(r, s, n); r[n] = 0;', '    return r;', '}');
    if (N.has('strpos')) out.push('int str_pos(const char* sub, const char* s) {', '    const char* p = strstr(s, sub);', '    return p ? (int) (p - s) + 1 : 0;', '}');
    if (N.has('strcopy')) out.push('char* str_copy(const char* s, int i, int n) {', range, '    size_t e = k + (n < 0 ? 0 : (size_t) n); if (e > ls) e = ls;', '    char* r = malloc(e - k + 1);', '    memcpy(r, s + k, e - k); r[e - k] = 0;', '    return r;', '}');
    if (N.has('strinsert')) out.push('char* str_insert(const char* w, const char* s, int i) {', range, '    size_t lw = strlen(w);', '    char* r = malloc(ls + lw + 1);', '    memcpy(r, s, k); memcpy(r + k, w, lw); strcpy(r + k + lw, s + k);', '    return r;', '}');
    if (N.has('strdelete')) out.push('char* str_delete(const char* s, int i, int n) {', range, '    size_t e = k + (n < 0 ? 0 : (size_t) n); if (e > ls) e = ls;', '    char* r = malloc(ls - (e - k) + 1);', '    memcpy(r, s, k); strcpy(r + k, s + e);', '    return r;', '}');
    if (out.length) { N.add('string'); N.add('stdlib'); out.push(''); }
    if (['strupper', 'strlower', 'strtrim'].some((n) => N.has(n))) N.add('ctype');
    return out;
  }

  /** Records und Aufzählungswerte (Java/C#: in der Klasse, sonst am Dateianfang) */
  typeDefs(ind) {
    const L = this.lang, I = this.I, out = [];
    for (const e of this.enumConsts) {
      out.push(ind + ({ java: `static final int ${e.name} = ${this.x(e.value)};`, csharp: `const int ${e.name} = ${this.x(e.value)};`, javascript: `const ${e.name} = ${this.x(e.value)};` }[L] || `const int ${e.name} = ${this.x(e.value)};`));
    }
    for (const [name, fields] of this.recordTypes) {
      const tn = (f) => this.typeName(f.type);
      if (L === 'javascript') { out.push(ind + this.comment(`Record ${name}: { ${fields.map((f) => f.name).join(', ')} }`)); continue; }
      if (L === 'c') { out.push(ind + `typedef struct { ${fields.map((f) => `${tn(f)} ${f.name};`).join(' ')} } ${name};`); continue; }
      if (L === 'cpp') {
        out.push(ind + `struct ${name} {`, ...fields.map((f) => ind + I + `${tn(f)} ${f.name}${this.litDefault(f.type) !== '0' || P.normType(f.type) === 'int' ? ' = ' + this.litDefault(f.type) : '{}'};`), ind + '};');
        out.push(ind + `ostream& operator<<(ostream& o, const ${name}& r) { return o << "${name}{" << ${fields.map((f, k) => `"${k ? ', ' : ''}${f.name}: " << r.${f.name}`).join(' << ')} << "}"; }`);
        continue;
      }
      const pub = L === 'csharp' ? 'public ' : '';
      out.push(ind + (L === 'java' ? `static class ${name} {` : `class ${name} {`));
      fields.forEach((f) => out.push(ind + I + `${pub}${tn(f)} ${f.name};`));
      out.push(ind + I + `${pub}${name}() {${fields.map((f) => ` ${f.name} = ${this.litDefault(f.type)};`).join('')} }`);
      out.push(ind + I + `${pub}${name}(${fields.map((f) => `${tn(f)} ${f.name}`).join(', ')}) {${fields.map((f) => ` this.${f.name} = ${f.name};`).join('')} }`);
      if (L === 'java') out.push(ind + I + `public String toString() { return "${name}{" + ${fields.map((f, k) => `"${k ? ', ' : ''}${f.name}: " + ${f.name}`).join(' + ')} + "}"; }`);
      else out.push(ind + I + `public override string ToString() { return "${name}{" + ${fields.map((f, k) => `"${k ? ', ' : ''}${f.name}: " + ${f.name}`).join(' + ')} + "}"; }`);
      out.push(ind + '}');
    }
    if (out.length) out.push('');
    return out;
  }

  repeatEl(cond, body, ind) {
    return [ind + 'do {', ...this.seq(body, ind + this.I), ind + `} while (${this.x(P.negateCond(cond))});`];
  }

  /**
   * Parallelverarbeitung als echte Threads:
   * C: OpenMP-Sections, C++: std::thread, C#: Parallel.Invoke, Java: eigene Thread-Klasse je Zweig.
   * JavaScript hat keine Threads mit gemeinsamen Variablen – dort bleibt es bei nacheinander.
   */
  parallelEl(el, ind) {
    const L = this.lang, I = this.I;
    if (L === 'javascript') return this.parallelSeq(el, ind, 'gen.parallelJs');
    const branches = this.parBranches(el);
    const out = [ind + this.comment(tr('gen.parallel'))];
    if (!branches.length) return out;
    if (L === 'c') {
      out.push(ind + this.comment(tr('gen.parallelOmp')), ind + '#pragma omp parallel sections', ind + '{');
      for (const b of branches) out.push(ind + I + '#pragma omp section', ind + I + '{', ...this.seq(b, ind + I + I), ind + I + '}');
      out.push(ind + '}');
      return out;
    }
    if (L === 'cpp') {
      this.needs.add('thread');
      const ids = branches.map(() => '_t' + this.nextThread());
      branches.forEach((b, k) => out.push(ind + `thread ${ids[k]}([&] {`, ...this.seq(b, ind + I), ind + '});'));
      ids.forEach((id) => out.push(ind + `${id}.join();`));
      return out;
    }
    if (L === 'csharp') {
      this.needs.add('tasks');
      out.push(ind + 'Parallel.Invoke(');
      branches.forEach((b, k) => out.push(ind + I + '() => {', ...this.seq(b, ind + I + I), ind + I + '}' + (k < branches.length - 1 ? ',' : '')));
      out.push(ind + ');');
      return out;
    }
    // Java: Lambdas dürfen lokale Variablen nicht ändern – jeder Zweig bekommt Kopien als Felder,
    // geänderte Werte werden nach dem Ende aller Zweige zurückgeschrieben
    out.push(ind + this.comment(tr('gen.parallelJava')));
    const ws = [];
    for (const b of branches) {
      const n = this.nextThread();
      const v = this.parVars(b);
      const fields = [...new Set([...v.reads, ...v.writes])].filter((x) => !v.locals.has(x) && (this.cur.declared.has(x) || this.cur.params.has(x)));
      const typed = fields.map((f) => `${this.typeName(this.declType(f) || 'int')} ${f}`);
      const w = { cls: 'Worker' + n, obj: 'worker' + n, fields, writes: fields.filter((f) => v.writes.has(f)) };
      out.push(ind + `class ${w.cls} extends Thread {`);
      if (fields.length) {
        typed.forEach((t) => out.push(ind + I + t + ';'));
        out.push(ind + I + `${w.cls}(${typed.join(', ')}) {${fields.map((f) => ` this.${f} = ${f};`).join('')} }`);
      }
      out.push(ind + I + 'public void run() {', ...this.seq(b, ind + I + I), ind + I + '}', ind + '}');
      ws.push(w);
    }
    ws.forEach((w) => out.push(ind + `${w.cls} ${w.obj} = new ${w.cls}(${w.fields.join(', ')});`));
    ws.forEach((w) => out.push(ind + `${w.obj}.start();`));
    out.push(ind + 'try {', ...ws.map((w) => ind + I + `${w.obj}.join();`), ind + '} catch (InterruptedException _e) {', ind + I + 'Thread.currentThread().interrupt();', ind + '}');
    ws.forEach((w) => w.writes.forEach((f) => out.push(ind + `${f} = ${w.obj}.${f};`)));
    return out;
  }

  /** Funktionskopf + Körper */
  routine(root) {
    const L = this.lang;
    const sig = this.sigs.get(root);
    const isMain = root.rootType === 'program';
    const info = this.analyze(root, isMain ? { ...sig, params: [] } : sig);
    info.charArrays = new Set();
    if (L === 'c') {
      walk(root.children, (el) => { for (const l of linesOf(el)) { const c = P.classifyLine(l); if (c.kind === 'input') c.vars.forEach((v) => { if ((P.normType(info.types.get(v)) || 'string') === 'string') info.charArrays.add(v); }); } });
      for (const v of info.charArrays) info.types.set(v, 'string');
    }
    this.cur = info;
    this.curIsMain = isMain;
    this.curSig = sig;
    const I = this.I;
    const bodyInd = L === 'java' || L === 'csharp' ? I + I : I;
    const head = [];
    // Java/C#: Threads (Konstruktor bzw. Lambda) verlangen sicher belegte Variablen
    const par = (L === 'java' || L === 'csharp') && hasParallel(root);
    const initOf = (n) => {
      const v = this.defaultValue(info.types.get(n));
      if (v != null || !par) return v;
      return /\[\]$/.test(this.typeName(info.types.get(n) || 'int')) || P.normType(info.types.get(n)) ? 'null' : '0';
    };
    const hoisted = [...info.hoist].map((n) => bodyInd + this.declLine(n, info.types.get(n) || (L === 'javascript' ? null : 'int'), L === 'javascript' ? null : initOf(n)));
    for (const n of info.hoist) info.declared.add(n);
    const body = this.seq(root.children, bodyInd);
    const ret = isMain ? null : this.retType(sig);
    const rt = ret ? this.typeName(ret) : 'void';
    const params = isMain ? [] : sig.params.map((p) => (L === 'javascript' ? p.name : `${this.typeName(p.type || p.inferredType || 'int')} ${p.name}`.replace(/^(\w+)\[\] (\w+)$/, L === 'c' || L === 'cpp' ? '$1 $2[]' : '$1[] $2')));
    const doc = (root.comment || []).filter((s) => s.trim()).map((s) => this.comment(s));
    const pre = L === 'java' || L === 'csharp' ? I : '';
    doc.forEach((d) => head.push(pre + d));
    let proto = null;
    if (isMain) {
      if (L === 'java') head.push(I + 'public static void main(String[] args) {');
      else if (L === 'csharp') head.push(I + 'static void Main(string[] args) {');
      else if (L === 'c') head.push('int main(void) {');
      else if (L === 'cpp') head.push('int main() {');
    } else {
      const h = `${sig.name}(${params.join(', ')})`;
      if (L === 'java') head.push(I + `public static ${rt} ${h} {`);
      else if (L === 'csharp') head.push(I + `static ${rt} ${h} {`);
      else if (L === 'javascript') head.push(`function ${h} {`);
      else { head.push(`${rt} ${h} {`); proto = `${rt} ${h};`; }
    }
    const lines = [...head, ...hoisted, ...body];
    if (isMain && (L === 'c' || L === 'cpp')) {
      const last = root.children[root.children.length - 1];
      if (!(last && last.type === 'jump' && /^return\b/.test(linesOf(last).join(' ')))) lines.push(I + 'return 0;');
    }
    if (!(isMain && L === 'javascript')) lines.push(pre + '}');
    else {
      // JavaScript: Hauptprogramm auf oberster Ebene
      return { lines: [...doc, ...hoisted.map((l) => l.slice(I.length)), ...body.map((l) => l.slice(I.length))], proto: null, isMain };
    }
    return { lines, proto, isMain };
  }

  defaultValue(t) {
    const n = P.normType(t);
    if (this.recordTypes.has(n)) return this.recordNew(n, []);
    if (this.lang === 'c' && n === 'string' ) return null;
    return { int: '0', double: '0.0', boolean: this.lang === 'c' ? 'false' : 'false', string: '""', char: "' '" }[n] || (this.lang === 'java' || this.lang === 'csharp' ? null : null);
  }

  run() {
    const L = this.lang;
    const roots = this.doc.roots;
    const mainRoot = roots.find((r) => r.rootType === 'program');
    const others = roots.filter((r) => r !== mainRoot);
    const gen = [];
    if (mainRoot) gen.push(this.routine(mainRoot));
    for (const r of others) gen.push(this.routine(r));
    const mainName = mainRoot ? this.sigs.get(mainRoot).name : 'Programm';
    const out = [];
    const title = this.comment(tr('gen.generated', mainRoot ? mainRoot.text.join(' ') : (roots[0] ? roots[0].text.join(' ') : '')));
    const td = this.typeDefs(L === 'java' || L === 'csharp' ? this.I : '');
    const helpers = this.cppHelpers();
    if (L === 'java') {
      const cls = this.opts.className || toClassName(mainName);
      if (this.needs.has('scanner')) out.push('import java.util.Scanner;', '');
      out.push(title, `public class ${cls} {`);
      if (this.needs.has('scanner')) out.push(this.I + 'static Scanner scanner = new Scanner(System.in);', '');
      out.push(...td);
      gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines); });
      out.push('}');
    } else if (L === 'csharp') {
      out.push('using System;', ...(this.needs.has('tasks') ? ['using System.Threading.Tasks;'] : []), '', title, `class ${this.opts.className || toClassName(mainName)}`, '{');
      out.push(...td);
      gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines.map((l) => l.replace(/^(\s*)(.*) \{$/, (m0, a, b) => (/^(static|public)/.test(b.trim()) ? `${a}${b}\n${a}{` : m0)))); });
      out.push('}');
    } else if (L === 'javascript') {
      out.push(title);
      if (this.needs.has('prompt')) out.push(tr('gen.jsPrompt'), 'const prompt = require("prompt-sync")();');
      out.push('', ...td);
      const subs = gen.filter((g) => !g.isMain);
      const main = gen.find((g) => g.isMain);
      subs.forEach((g) => { out.push(...g.lines, ''); });
      if (main) out.push(...main.lines);
    } else { // C / C++
      const inc = [];
      if (L === 'c') {
        inc.push('#include <stdio.h>');
        if (this.needs.has('stdlib')) inc.push('#include <stdlib.h>');
        if (this.needs.has('stdbool')) inc.push('#include <stdbool.h>');
        if (this.needs.has('string')) inc.push('#include <string.h>');
        if (this.needs.has('math')) inc.push('#include <math.h>');
        if (this.needs.has('ctype')) inc.push('#include <ctype.h>');
        if (this.needs.has('cthrow')) inc.push('#include <setjmp.h>');
      } else {
        inc.push('#include <iostream>');
        if (this.needs.has('string')) inc.push('#include <string>');
        if (this.needs.has('math')) inc.push('#include <cmath>');
        if (this.needs.has('stdlib')) inc.push('#include <cstdlib>');
        if (this.needs.has('stdexcept')) inc.push('#include <stdexcept>');
        if (this.needs.has('thread')) inc.push('#include <thread>');
        inc.push('', 'using namespace std;');
      }
      out.push(title, ...inc, '', ...td, ...helpers);
      const protos = gen.filter((g) => g.proto).map((g) => g.proto);
      if (protos.length) out.push(...protos, '');
      gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines); });
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }
}

/* ==================================================================== */
class PyGen extends BaseGen {
  comment(text) { return '# ' + text; }

  stmt(c, ind, el) {
    switch (c.kind) {
      case 'empty': return [];
      case 'decl':
        return c.decls.filter((d) => d.init != null || this.recordTypes.has(P.normType(c.type))).map((d) => {
          if (d.init == null) return ind + `${d.name} = ${this.recordNew(P.normType(c.type), [])}`;
          let v = this.x(d.init);
          if (/^\{.*\}$/.test(v)) v = '[' + v.slice(1, -1) + ']';
          return ind + `${d.name} = ${v}`;
        });
      case 'assign': {
        let v = this.x(c.expr);
        if (/^\{.*\}$/.test(v)) v = '[' + v.slice(1, -1) + ']';
        return [ind + `${this.x(c.target)} = ${v}`];
      }
      case 'input': {
        const out = [];
        if (!c.vars.length) return [ind + `input(${c.prompt ? this.x(c.prompt) : ''})`];
        c.vars.forEach((v, k) => {
          const t = P.normType(this.typeOf(v));
          const pr = `input(${k === 0 && c.prompt ? this.x(c.prompt) : ''})`;
          const rd = t === 'int' ? `int(${pr})` : t === 'double' ? `float(${pr})` : t === 'boolean' ? `${pr} == "True"` : pr;
          out.push(ind + `${this.x(v)} = ${rd}`);
        });
        return out;
      }
      case 'output': return [ind + this.outputStmt(c.items)];
      case 'return':
        if (this.curIsMain) { this.needs.add('sys'); return [ind + `sys.exit(${c.expr && c.expr.trim() !== '0' ? this.x(c.expr) : ''})`]; }
        return [ind + (c.expr ? `return ${this.x(c.expr)}` : 'return')];
      case 'exit': this.needs.add('sys'); return [ind + `sys.exit(${c.expr ? this.x(c.expr) : ''})`];
      case 'leave': return [ind + 'break'];
      case 'continue': return [ind + 'continue'];
      case 'throw': return [ind + (P.isStringLiteral(c.expr) ? `raise Exception(${this.x(c.expr)})` : `raise ${this.x(c.expr)}`)];
      default: return [ind + this.x(c.expr)];
    }
  }

  outputStmt(items) {
    const parts = this.outParts(items);
    if (!parts.length) return 'print()';
    if (parts.length === 1) return `print(${parts[0].lit != null ? '"' + parts[0].lit + '"' : this.x(parts[0].expr)})`;
    const exprs = parts.filter((p) => p.expr).map((p) => this.x(p.expr));
    const q = exprs.some((e) => e.includes('"')) ? "'" : '"';
    const s = parts.map((p) => {
      if (p.lit != null) {
        let l = p.lit.replace(/\{/g, '{{').replace(/\}/g, '}}');
        if (q === "'") l = l.replace(/\\"/g, '"').replace(/'/g, "\\'");
        return l;
      }
      return '{' + this.x(p.expr) + '}';
    }).join('');
    return `print(f${q}${s}${q})`;
  }

  tryEl(el, ind) {
    const I = this.I, v = this.catchVar(el);
    const out = [ind + 'try:', ...this.block(el.qTry, ind + I), ind + 'except Exception as _e:', ind + I + `${v} = str(_e)`, ...this.seq(el.qCatch, ind + I)];
    if (el.qFinally.length) out.push(ind + 'finally:', ...this.block(el.qFinally, ind + I));
    return out;
  }

  typeDefs() {
    const I = this.I, out = [];
    for (const e of this.enumConsts) out.push(`${e.name} = ${this.x(e.value)}`);
    if (out.length) out.push('', '');
    for (const [name, fields] of this.recordTypes) {
      out.push(`class ${name}:`, `${I}def __init__(self${fields.map((f) => `, ${f.name}=${this.litDefault(f.type)}`).join('')}):`);
      fields.forEach((f) => out.push(`${I}${I}self.${f.name} = ${f.name}`));
      out.push('', `${I}def __repr__(self):`, `${I}${I}return "${name}{" + ${fields.map((f, k) => `"${k ? ', ' : ''}${f.name}: " + repr(self.${f.name})`).join(' + ')} + "}"`, '', '');
    }
    return out;
  }

  block(list, ind) {
    const b = this.seq(list, ind);
    return b.some((l) => l.trim() && !l.trim().startsWith('#')) ? b : b.concat([ind + 'pass']);
  }

  ifEl(el, ind) {
    const out = [];
    let cond = this.cond(el.text, ['if', 'wenn', 'falls']);
    let t = el.qTrue, f = el.qFalse;
    if (!t.length && f.length) { cond = P.negateCond(cond); [t, f] = [f, t]; }
    out.push(ind + `if ${this.x(cond)}:`, ...this.block(t, ind + this.I));
    while (f.length === 1 && f[0].type === 'alternative' && !f[0].disabled && !(f[0].comment || []).some((s) => s.trim()) && f[0].qTrue.length) {
      out.push(ind + `elif ${this.x(this.cond(f[0].text, ['if', 'wenn', 'falls']))}:`, ...this.block(f[0].qTrue, ind + this.I));
      f = f[0].qFalse;
    }
    if (f.length) out.push(ind + 'else:', ...this.block(f, ind + this.I));
    return out;
  }

  caseEl(el, ind) {
    const out = [];
    const disc = this.x(el.text[0] || '');
    let first = true;
    for (const b of this.caseInfo(el)) {
      if (b.isDefault) {
        if (first) { out.push(...this.seq(b.body, ind)); continue; }
        out.push(ind + 'else:', ...this.block(b.body, ind + this.I));
        continue;
      }
      const vals = b.values.map((v) => this.x(v));
      const c = vals.length === 1 ? `${disc} == ${vals[0]}` : `${disc} in (${vals.join(', ')})`;
      out.push(ind + `${first ? 'if' : 'elif'} ${c}:`, ...this.block(b.body, ind + this.I));
      first = false;
    }
    return out;
  }

  forEl(el, ind) {
    const text = linesOf(el).join(' ');
    const f = P.parseForText(text);
    if (!f) return [ind + this.comment(tr('gen.todoLoop', text)), ind + 'while True:', ...this.block(el.body, ind + this.I), ind + this.I + 'break'];
    if (f.kind === 'each') return [ind + `for ${f.var} in ${this.x(f.coll)}:`, ...this.block(el.body, ind + this.I)];
    const step = f.step.replace(/\s+/g, '');
    const neg = step.startsWith('-');
    const stop = this.x(P.addConst(f.end, neg ? -1 : 1));
    const start = this.x(f.start);
    let range;
    if (step === '1') range = start === '0' ? `range(${stop})` : `range(${start}, ${stop})`;
    else range = `range(${start}, ${stop}, ${this.x(step)})`;
    return [ind + `for ${this.x(f.var)} in ${range}:`, ...this.block(el.body, ind + this.I)];
  }

  whileEl(cond, body, ind) {
    return [ind + `while ${cond === 'true' ? 'True' : this.x(cond)}:`, ...this.block(body, ind + this.I)];
  }

  repeatEl(cond, body, ind) {
    return [ind + 'while True:', ...this.seq(body, ind + this.I), ind + this.I + `if ${this.x(cond)}:`, ind + this.I + this.I + 'break'];
  }

  /**
   * Parallelverarbeitung: je Zweig eine Funktion, die in einem eigenen Thread läuft.
   * Gesetzte Variablen werden global (Hauptprogramm) bzw. nonlocal (Unterprogramm) erklärt.
   */
  parallelEl(el, ind) {
    const I = this.I;
    const branches = this.parBranches(el);
    const out = [ind + this.comment(tr('gen.parallel'))];
    if (!branches.length) return out;
    this.needs.add('threading');
    const scope = this.curIsMain ? 'global' : 'nonlocal';
    const names = [], defs = [], written = new Set();
    const outer = !this.inThread;
    this.inThread = true;
    try {
      for (const b of branches) {
        const fn = '_thread' + this.nextThread();
        const v = this.parVars(b);
        const w = [...new Set([...v.writes, ...v.locals])];
        w.forEach((x) => written.add(x));
        names.push(fn);
        defs.push(ind + `def ${fn}():`);
        if (w.length) defs.push(ind + I + `${scope} ${w.join(', ')}`);
        defs.push(...this.block(b, ind + I));
      }
    } finally { this.inThread = !outer; }
    if (scope === 'nonlocal' && outer) {
      // nonlocal verlangt eine Bindung im Unterprogramm selbst (außerhalb der Thread-Funktionen)
      const bound = new Set(this.cur.params);
      const v = { reads: new Set(), writes: bound, locals: bound, loops: new Set() };
      walk(this.curRoot.children, (e) => { if (e.disabled || e.type === 'parallel') return false; this.elVars(e, v); });
      const pre = [...written].filter((x) => !bound.has(x));
      if (pre.length) out.push(ind + `${pre.join(' = ')} = None`);
    }
    out.push(...defs);
    out.push(ind + `_threads = [threading.Thread(target=f) for f in (${names.join(', ')}${names.length === 1 ? ',' : ''})]`);
    out.push(ind + 'for _t in _threads:', ind + I + '_t.start()', ind + 'for _t in _threads:', ind + I + '_t.join()');
    return out;
  }

  x(text) {
    const toks = P.ptoks(text);
    const { splitTop } = require('./tokenizer');
    const terms = splitTop(toks, '+');
    if (this.cur && terms.length > 1 && terms.some((t) => t.length === 1 && t[0].t === 'str') &&
        findTop(toks, (t) => P.REL_OPS.has(t.v) || ['and', 'or', 'not'].includes(String(t.v).toLowerCase())) < 0) {
      return terms.map((t) => {
        const tx = joinTokens(t);
        const tt = P.inferType(tx, this.cur.types, this.cur.fnTypes);
        const r = super.x(tx);
        return tt === 'string' || tt === 'char' ? r : `str(${r})`;
      }).join(' + ');
    }
    return super.x(text);
  }

  pyType(t) { const n = P.normType(t); return n ? (TYPE_MAP.python[n] || (n.endsWith('[]') ? 'list' : null)) : null; }

  run() {
    const roots = this.doc.roots;
    const mains = roots.filter((r) => r.rootType === 'program');
    const subs = roots.filter((r) => r.rootType !== 'program');
    const parts = [];
    for (const r of subs) {
      const sig = this.sigs.get(r);
      this.cur = this.analyze(r, sig);
      this.curIsMain = false;
      this.curRoot = r;
      const ps = sig.params.map((p) => { const t = this.pyType(p.type); return t ? `${p.name}: ${t}` : p.name; });
      const rt = this.pyType(sig.returnType);
      const lines = [`def ${sig.name}(${ps.join(', ')})${rt ? ' -> ' + rt : ''}:`];
      const doc = (r.comment || []).filter((s) => s.trim());
      if (doc.length) lines.push(this.I + '"""' + doc.join('\n' + this.I) + '"""');
      lines.push(...this.block(r.children, this.I));
      parts.push(lines);
    }
    const mainParts = [];
    for (const r of mains) {
      this.cur = this.analyze(r, { params: [] });
      this.curIsMain = true;
      this.curRoot = r;
      const lines = [];
      lines.push(this.comment(tr('gen.pyMain', r.text.join(' '))));
      (r.comment || []).filter((s) => s.trim()).forEach((s) => lines.push(this.comment(s)));
      lines.push(...this.seq(r.children, ''));
      mainParts.push(lines);
    }
    const td = this.typeDefs();
    const head = [];
    for (const m of ['math', 'random', 'sys', 'threading', 'turtle']) if (this.needs.has(m)) head.push(`import ${m}`);
    // Turtleizer: Farben 0–255, Blick nach oben wie im Structorizer
    if (this.needs.has('turtle')) head.push('', 'turtle.colormode(255)', 'turtle.setheading(90)');
    const out = [];
    if (head.length) out.push(...head, '', '');
    const leaves = [...this.needs].filter((n) => n.startsWith('leave:')).map((n) => n.slice(6));
    if (leaves.length) out.push(...leaves.map((l) => `class _Leave${l}(Exception):
${this.I}pass`), '', '');
    out.push(...td);
    parts.forEach((p) => out.push(...p, '', ''));
    mainParts.forEach((p, i) => { if (i) out.push(''); out.push(...p); });
    if (this.needs.has('turtle')) out.push('turtle.done()');
    return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }
}

/* ==================================================================== */
class PasGen extends BaseGen {
  comment(text) { return '{ ' + text.replace(/[{}]/g, '') + ' }'; }

  typeName(t) {
    const ex = this.exactType(t);
    if (ex) return ex;
    const n = P.normType(t);
    if (!n) return 'integer';
    if (n.endsWith('[]')) return 'array of ' + this.typeName(n.slice(0, -2));
    return TYPE_MAP.pascal[n] || n;
  }

  stmt(c, ind) {
    switch (c.kind) {
      case 'empty': return [];
      case 'decl': return c.decls.filter((d) => d.init != null).map((d) => ind + `${d.name} := ${this.pasVal(d.init)};`);
      case 'assign': return [ind + `${this.x(c.target)} := ${this.pasVal(c.expr)};`];
      case 'input': {
        const out = [];
        if (c.prompt) out.push(ind + `write(${this.x(c.prompt)});`);
        out.push(ind + (c.vars.length ? `readln(${c.vars.map((v) => this.x(v)).join(', ')});` : 'readln;'));
        return out;
      }
      case 'output': return [ind + (c.items.length ? `writeln(${c.items.map((i) => this.x(i)).join(', ')});` : 'writeln;')];
      case 'return': return [ind + (c.expr && !this.curIsMain ? `Exit(${this.x(c.expr)});` : 'Exit;')];
      case 'exit': return [ind + `Halt(${c.expr ? this.x(c.expr) : '0'});`];
      case 'leave': return [ind + 'Break;'];
      case 'continue': return [ind + 'Continue;'];
      case 'throw': this.needs.add('sysutils'); return [ind + `raise Exception.Create(${this.x(c.expr)});`];
      default: return [ind + this.x(c.expr) + ';'];
    }
  }

  tryEl(el, ind) {
    const I = this.I, v = this.catchVar(el);
    this.needs.add('sysutils');
    const fin = el.qFinally.length;
    const i2 = fin ? ind + I : ind;
    const inner = [i2 + 'try', ...this.seq(el.qTry, i2 + I), i2 + 'except', i2 + I + 'on _E: Exception do', i2 + I + 'begin',
      i2 + I + I + `${v} := _E.Message;`, ...this.seq(el.qCatch, i2 + I + I), i2 + I + 'end;', i2 + 'end;'];
    if (!fin) return inner;
    return [ind + 'try', ...inner, ind + 'finally', ...this.seq(el.qFinally, ind + I), ind + 'end;'];
  }

  typeDefs() {
    const I = this.I, out = [];
    if (this.enumConsts.length) out.push('const', ...this.enumConsts.map((e) => `${I}${e.name} = ${this.x(e.value)};`), '');
    if (this.recordTypes.size) {
      out.push('type');
      for (const [name, fields] of this.recordTypes) out.push(`${I}${name} = record`, ...fields.map((f) => `${I}${I}${f.name}: ${this.typeName(f.type)};`), `${I}end;`);
      out.push('');
      for (const [name, fields] of this.recordTypes) {
        out.push(`function Make${name}(${fields.map((f) => `${f.name}: ${this.typeName(f.type)}`).join('; ')}): ${name};`, 'begin');
        fields.forEach((f) => out.push(`${I}Result.${f.name} := ${f.name};`));
        out.push('end;', '');
      }
    }
    return out;
  }

  beginEnd(list, ind, term = ';') {
    return [ind + 'begin', ...this.seq(list, ind + this.I), ind + 'end' + term];
  }

  ifEl(el, ind) {
    const out = [];
    let cond = this.cond(el.text, ['if', 'wenn', 'falls']);
    let t = el.qTrue, f = el.qFalse;
    if (!t.length && f.length) { cond = P.negateCond(cond); [t, f] = [f, t]; }
    out.push(ind + `if ${this.x(cond)} then`);
    out.push(...this.beginEnd(t, ind, f.length ? '' : ';'));
    while (f.length === 1 && f[0].type === 'alternative' && !f[0].disabled && f[0].qTrue.length && !(f[0].comment || []).some((s) => s.trim())) {
      out.push(ind + `else if ${this.x(this.cond(f[0].text, ['if', 'wenn', 'falls']))} then`);
      const nf = f[0].qFalse;
      out.push(...this.beginEnd(f[0].qTrue, ind, nf.length ? '' : ';'));
      f = nf;
    }
    if (f.length) { out.push(ind + 'else'); out.push(...this.beginEnd(f, ind)); }
    return out;
  }

  caseEl(el, ind) {
    const out = [ind + `case ${this.x(el.text[0] || '')} of`];
    for (const b of this.caseInfo(el)) {
      if (b.isDefault) out.push(ind + this.I + 'else');
      else out.push(ind + this.I + b.values.map((v) => this.x(v)).join(', ') + ':');
      out.push(...this.beginEnd(b.body, ind + this.I + this.I));
    }
    out.push(ind + 'end;');
    return out;
  }

  forEl(el, ind) {
    const text = linesOf(el).join(' ');
    const f = P.parseForText(text);
    if (!f) return [ind + this.comment(tr('gen.todoLoop', text)), ...this.beginEnd(el.body, ind)];
    if (f.kind === 'each') return [ind + `for ${f.var} in ${this.x(f.coll)} do`, ...this.beginEnd(el.body, ind)];
    const step = f.step.replace(/\s+/g, '');
    const v = this.x(f.var);
    if (step === '1' || step === '-1') {
      return [ind + `for ${v} := ${this.x(f.start)} ${step === '1' ? 'to' : 'downto'} ${this.x(f.end)} do`, ...this.beginEnd(el.body, ind)];
    }
    const neg = step.startsWith('-');
    return [
      ind + `${v} := ${this.x(f.start)};`,
      ind + `while ${v} ${neg ? '>=' : '<='} ${this.x(f.end)} do`,
      ind + 'begin',
      ...this.seq(el.body, ind + this.I),
      ind + this.I + `${v} := ${v} + ${this.x(step)};`,
      ind + 'end;',
    ];
  }

  whileEl(cond, body, ind) { return [ind + `while ${cond === 'true' ? 'true' : this.x(cond)} do`, ...this.beginEnd(body, ind)]; }

  repeatEl(cond, body, ind) { return [ind + 'repeat', ...this.seq(body, ind + this.I), ind + `until ${this.x(cond)};`]; }

  /** Wert einer Zuweisung; Feld-Literale {1, 2, 3} werden zu [1, 2, 3] (dynamische Felder, Free Pascal ab 3.2) */
  pasVal(expr) {
    return isArrayLit(expr) ? `[${arrayItems(expr).map((v) => this.x(v)).join(', ')}]` : this.x(expr);
  }

  /**
   * Parallelverarbeitung: je Zweig eine Thread-Funktion (BeginThread / WaitForThreadTerminate).
   * Thread-Funktionen sehen nur globale Variablen – das sind die des Hauptprogramms. In Unterprogrammen
   * laufen die Zweige daher nacheinander.
   */
  parallelEl(el, ind) {
    if (!this.curIsMain || !this.pasThreads) return this.parallelSeq(el, ind, 'gen.parallelPas');
    const I = this.I;
    const branches = this.parBranches(el);
    const out = [ind + this.comment(tr('gen.parallel'))];
    if (!branches.length) return out;
    this.needs.add('threads');
    const ids = [];
    for (const b of branches) {
      const n = this.nextThread();
      const fn = 'Thread' + n;
      // Zählvariablen von for-Schleifen müssen in Funktionen lokal sein
      const loops = [...this.parVars(b).loops];
      const byType = new Map();
      loops.forEach((v) => { const t = this.typeName(this.declType(v)); if (!byType.has(t)) byType.set(t, []); byType.get(t).push(v); });
      // Rumpf zuerst erzeugen: Thread-Funktionen verschachtelter Parallelverarbeitung stehen so vor dieser
      const body = this.seq(b, I);
      this.pasThreads.funcs.push(`function ${fn}(_arg: Pointer): PtrInt;`,
        ...(byType.size ? ['var', ...[...byType].map(([t, ns]) => I + `${ns.join(', ')}: ${t};`)] : []),
        'begin', ...body, I + 'Result := 0;', 'end;', '');
      ids.push({ fn, h: '_th' + n });
    }
    this.pasThreads.handles.push(...ids.map((x) => x.h));
    ids.forEach((x) => out.push(ind + `${x.h} := BeginThread(@${x.fn});`));
    ids.forEach((x) => out.push(ind + `WaitForThreadTerminate(${x.h}, 0);`));
    return out;
  }

  /** Sprungmarken für leave n (goto) */
  labelSection() {
    if (!this.pasLabels || !this.pasLabels.length) return [];
    this.needs.add('goto');
    return [`label ${this.pasLabels.join(', ')};`];
  }

  varSection(info, ind, skip) {
    const byType = new Map();
    for (const n of info.all) {
      if (skip.has(n)) continue;
      const t = this.typeName((info.rawTypes && info.rawTypes.get(n)) || info.types.get(n));
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(n);
    }
    if (!byType.size) return [];
    return [ind + 'var', ...[...byType].map(([t, ns]) => ind + this.I + `${ns.join(', ')}: ${t};`)];
  }

  run() {
    const roots = this.doc.roots;
    const main = roots.find((r) => r.rootType === 'program');
    const subs = roots.filter((r) => r !== main);
    const out = [];
    const body = [];
    for (const r of subs) {
      const sig = this.sigs.get(r);
      const info = this.analyze(r, sig);
      this.cur = info; this.curIsMain = false;
      const ret = this.retType(sig);
      const ps = sig.params.map((p) => `${p.name}: ${this.typeName(p.type || p.inferredType)}`).join('; ');
      (r.comment || []).filter((s) => s.trim()).forEach((s) => body.push(this.comment(s)));
      body.push(ret ? `function ${sig.name}(${ps}): ${this.typeName(ret)};` : `procedure ${sig.name}(${ps});`);
      this.pasLabels = [];
      const be = this.beginEnd(r.children, '');
      body.push(...this.varSection(info, '', new Set([...info.params, sig.name])), ...this.labelSection(), ...be, '');
    }
    let mainLines = [];
    let progName = 'Programm';
    if (main) {
      const info = this.analyze(main, { params: [] });
      this.cur = info; this.curIsMain = true;
      progName = toClassName(this.sigs.get(main).name);
      this.pasLabels = [];
      this.pasThreads = { funcs: [], handles: [] };
      const be = this.beginEnd(main.children, '', '.');
      const vars = this.varSection(info, '', new Set());
      const th = this.pasThreads;
      if (th.handles.length) {
        if (!vars.length) vars.push('var');
        vars.push(this.I + `${th.handles.join(', ')}: TThreadID;`);
      }
      mainLines = [...vars, ...(th.funcs.length ? ['', ...th.funcs] : []), ...this.labelSection(), '', ...be];
      this.pasThreads = null;
    }
    const td = this.typeDefs();
    out.push(`program ${progName};`, '', '{$mode objfpc}{$H+}' + (this.needs.has('goto') ? '{$goto on}' : ''), '');
    const uses = [];
    // Threads unter Linux/macOS brauchen die Unit cthreads (als erste)
    if (this.needs.has('threads')) { uses.push('{$ifdef unix}cthreads,{$endif} SysUtils'); this.needs.delete('sysutils'); }
    if (this.needs.has('math')) uses.push('Math');
    if (this.needs.has('sysutils')) uses.push('SysUtils');
    if (uses.length) out.push(`uses ${uses.join(', ')};`, '');
    out.push(...td, ...body);
    if (main) out.push(...mainLines);
    else out.push('begin', 'end.');
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }
}

/* ==================================================================== */
/* Gemeinsames für Kotlin und Rust                                       */
/* ==================================================================== */
const IDENT_ONLY = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const isArrayLit = (v) => { const t = P.ptoks(String(v).trim()); return t.length >= 2 && (require('./tokenizer').isWrapped(t, '{') || require('./tokenizer').isWrapped(t, '[')); };
const arrayItems = (v) => require('./tokenizer').splitTop(P.ptoks(String(v).trim()).slice(1, -1), ',').filter((p) => p.length).map(joinTokens);

/** Namen, die in einer Routine Werte zugewiesen bekommen (Parameter brauchen dann var/mut) */
function assignedNames(root) {
  const set = new Set();
  walk(root.children, (el) => {
    for (const l of linesOf(el)) {
      const c = P.classifyLine(l);
      if (c.kind === 'assign') c.target.split(',').forEach((t) => set.add(t.trim().replace(/\[.*$/, '')));
      else if (c.kind === 'input') c.vars.forEach((v) => set.add(v.trim()));
    }
  });
  return set;
}

/** "a" + x + "b"  ->  Teile, wenn eine Zeichenkette verkettet wird (sonst null) */
function concatParts(text) {
  const { splitTop } = require('./tokenizer');
  const toks = P.ptoks(text);
  const terms = splitTop(toks, '+');
  if (terms.length < 2 || !terms.some((t) => t.length === 1 && t[0].t === 'str')) return null;
  if (findTop(toks, (t) => P.REL_OPS.has(t.v) || ['and', 'or', 'not'].includes(String(t.v).toLowerCase())) >= 0) return null;
  return terms.map((t) => (t.length === 1 && t[0].t === 'str' ? { lit: P.literalInner(t[0].v) } : { expr: joinTokens(t) }));
}

/* ==================================================================== */
/* Kotlin                                                                */
/* ==================================================================== */
class KtGen extends CGen {
  comment(text) { return '// ' + text; }

  typeName(t) {
    const ex = this.exactType(t);
    if (ex) return ex;
    const arrRaw = /^(.*?)\s*\[\s*\]$/.exec(String(t || ''));
    if (arrRaw && P.canonType(arrRaw[1])) {
      const c = P.canonType(arrRaw[1]);
      return { int: 'IntArray', long: 'LongArray', short: 'ShortArray', byte: 'ByteArray', float: 'FloatArray', double: 'DoubleArray', boolean: 'BooleanArray', char: 'CharArray' }[c] || `Array<${this.typeName(arrRaw[1])}>`;
    }
    const n = P.normType(t);
    if (!n) return 'Int';
    if (n.endsWith('[]')) {
      const b = P.normType(n.slice(0, -2));
      return { int: 'IntArray', double: 'DoubleArray', boolean: 'BooleanArray', char: 'CharArray' }[b] || `Array<${this.typeName(b)}>`;
    }
    return TYPE_MAP.kotlin[n] || n;
  }

  defaultValue(t) {
    const n = P.normType(t);
    if (this.recordTypes.has(n)) return this.recordNew(n, []);
    if (n && n.endsWith('[]')) {
      const b = P.normType(n.slice(0, -2));
      return { int: 'IntArray(0)', double: 'DoubleArray(0)', boolean: 'BooleanArray(0)', char: 'CharArray(0)' }[b] || 'arrayOf()';
    }
    return { int: '0', double: '0.0', string: '""', boolean: 'false', char: "' '" }[n] || '0';
  }

  /** Kotlin-String-Literal-Inhalt: "$" maskieren */
  lit(s) { return String(s).replace(/(^|[^\\])\$/g, '$1\\$'); }

  /** String-Template aus Teilen */
  tmpl(parts) {
    let s = '';
    parts.forEach((p, k) => {
      if (p.lit != null) { s += this.lit(p.lit); return; }
      const e = super.x(p.expr);
      const next = parts[k + 1];
      const nextStartsIdent = next && next.lit != null && /^[\p{L}\p{N}_]/u.test(next.lit);
      s += IDENT_ONLY.test(e) && !nextStartsIdent ? '$' + e : '${' + e + '}';
    });
    return '"' + s + '"';
  }

  x(text) {
    const parts = this.cur ? concatParts(text) : null;
    if (parts) return this.tmpl(parts);
    return super.x(text);
  }

  /** Wert passend zum Zieltyp (Array-Literal, 5 -> 5.0 bei Double) */
  val(type, expr) {
    const n = P.normType(type) || this.exprType(expr);
    if (isArrayLit(expr)) {
      const items = arrayItems(expr);
      const et = n && n.endsWith('[]') ? P.normType(n.slice(0, -2)) : (items.length ? P.normType(this.exprType(items[0])) : 'int');
      const fn = { int: 'intArrayOf', double: 'doubleArrayOf', boolean: 'booleanArrayOf', char: 'charArrayOf' }[et] || 'arrayOf';
      return `${fn}(${items.map((i) => this.val(et, i)).join(', ')})`;
    }
    let r = this.x(expr);
    if (n === 'double' && /^-?\d+$/.test(r)) r += '.0';
    return this.narrow(type, r);
  }

  targetType(target) {
    const m = /^([\p{L}_][\p{L}\p{N}_]*)\s*\[/u.exec(target);
    if (m) { const t = P.normType(this.typeOf(m[1])); return t && t.endsWith('[]') ? t.slice(0, -2) : null; }
    return this.declType(target.trim());
  }

  newArray(elType, size) {
    const n = P.normType(elType);
    const typed = { int: 'IntArray', double: 'DoubleArray', boolean: 'BooleanArray', char: 'CharArray' }[n];
    return typed ? `${typed}(${size})` : `Array(${size}) { ${this.defaultValue(n)} }`;
  }

  declLine(name, type, init, isConst) {
    const kw = isConst ? 'val' : 'var';
    const arr = /^(.*?)\[(.*)\]$/.exec(name);
    if (arr) return `${kw} ${arr[1]} = ${this.newArray(type, this.x(arr[2]) || '0')}`;
    if (init == null) return `${kw} ${name}: ${this.typeName(type)} = ${this.narrow(type, this.defaultValue(type))}`;
    return `${kw} ${name}${type ? ': ' + this.typeName(type) : ''} = ${init}`;
  }

  stmt(c, ind, el) {
    switch (c.kind) {
      case 'empty': return [];
      case 'decl':
        return c.decls.map((d) => {
          this.cur.declared.add(d.name);
          const t = c.type || this.typeOf(d.name);
          if (d.suffix) return ind + this.declLine(d.name + d.suffix, c.type || 'int', null, c.isConst);
          return ind + this.declLine(d.name, t, d.init != null ? this.val(t, d.init) : null, c.isConst);
        });
      case 'assign': {
        if (c.target.includes(',') && !/[[(]/.test(c.target)) return this.tupleAssign(c, ind);
        const n = c.target.trim();
        const t = this.targetType(n);
        if (this.cur.inline.get(el) && this.cur.inline.get(el).has(n) && !this.cur.declared.has(n)) {
          this.cur.declared.add(n);
          return [ind + this.declLine(n, t, this.val(t, c.expr))];
        }
        return [ind + `${this.x(n)} = ${this.val(t, c.expr)}`];
      }
      case 'input': {
        const out = [];
        if (c.prompt) out.push(ind + `print(${this.x(c.prompt)})`);
        if (!c.vars.length) { out.push(ind + 'readln()'); return out; }
        c.vars.forEach((v) => {
          const t = P.normType(this.targetType(v)) || 'string';
          const ct = P.canonType(this.targetType(v)) || t;
          const rd = { int: 'readln().toInt()', long: 'readln().toLong()', short: 'readln().toShort()', byte: 'readln().toByte()', float: 'readln().toFloat()', double: 'readln().toDouble()', boolean: 'readln().toBoolean()', char: 'readln()[0]' }[ct] || 'readln()';
          const decl = this.cur.inline.get(el) && this.cur.inline.get(el).has(v) && !this.cur.declared.has(v);
          if (decl) this.cur.declared.add(v);
          out.push(ind + (decl ? `var ${v}: ${this.typeName(this.targetType(v) || t)} = ${rd}` : `${this.x(v)} = ${rd}`));
        });
        return out;
      }
      case 'output': {
        const parts = this.outParts(c.items);
        if (!parts.length) return [ind + 'println()'];
        if (parts.length === 1 && parts[0].expr != null) return [ind + `println(${this.x(parts[0].expr)})`];
        return [ind + `println(${this.tmpl(parts)})`];
      }
      case 'return':
        if (this.curIsMain) return c.expr && c.expr.trim() !== '0' ? this.stmt({ kind: 'exit', expr: c.expr }, ind, el) : [ind + 'return'];
        return [ind + (c.expr ? `return ${this.val(this.retType(this.curSig), c.expr)}` : 'return')];
      case 'exit': this.needs.add('exit'); return [ind + `exitProcess(${c.expr ? this.x(c.expr) : '0'})`];
      case 'leave': return [ind + 'break'];
      case 'continue': return [ind + 'continue'];
      case 'throw': {
        const e = this.x(c.expr);
        return [ind + (P.isStringLiteral(c.expr) ? `throw RuntimeException(${e})` : `throw RuntimeException(${e}.toString())`)];
      }
      default: return [ind + this.x(c.expr)];
    }
  }

  tupleAssign(c, ind) {
    const targets = c.target.split(',').map((s) => s.trim());
    const vals = require('./tokenizer').splitTop(P.ptoks(c.expr), ',').map(joinTokens);
    if (vals.length !== targets.length) return [ind + this.comment(`TODO: ${c.target} = ${c.expr}`)];
    const out = vals.map((v, k) => ind + `val _t${k} = ${this.val(this.targetType(targets[k]), v)}`);
    targets.forEach((t, k) => {
      if (!this.cur.declared.has(t) && !this.cur.hoist.has(t) && !this.cur.explicit.has(t) && !this.cur.params.has(t)) {
        this.cur.declared.add(t);
        out.push(ind + `var ${t} = _t${k}`);
      } else out.push(ind + `${t} = _t${k}`);
    });
    return out;
  }

  caseEl(el, ind) {
    const I = this.I;
    const out = [ind + `when (${this.x(el.text[0] || '')}) {`];
    for (const b of this.caseInfo(el)) {
      const head = b.isDefault ? 'else' : b.values.map((v) => this.x(v)).join(', ');
      const body = this.seq(b.body, ind + I + I);
      if (!body.length) out.push(ind + I + `${head} -> {}`);
      else out.push(ind + I + `${head} -> {`, ...body, ind + I + '}');
    }
    out.push(ind + '}');
    return out;
  }

  /** Fallauswahl mit Bedingungen: when ohne Argument, je Zweig eine Bedingung */
  condCaseEl(el, ind, branches) {
    const I = this.I;
    const out = [ind + 'when {'];
    for (const b of branches) {
      const head = b.isDefault ? 'else' : this.x(b.cond);
      const body = this.seq(b.body, ind + I + I);
      if (!body.length) out.push(ind + I + `${head} -> {}`);
      else out.push(ind + I + `${head} -> {`, ...body, ind + I + '}');
    }
    out.push(ind + '}');
    return out;
  }

  forEl(el, ind) {
    const text = linesOf(el).join(' ');
    const f = P.parseForText(text);
    const body = this.seq(el.body, ind + this.I);
    if (!f) return [ind + this.comment(tr('gen.todoLoop', text)), ind + 'while (true) {', ...body, ind + this.I + 'break', ind + '}'];
    if (f.kind === 'each') return [ind + `for (${f.var} in ${this.x(f.coll)}) {`, ...body, ind + '}'];
    const step = f.step.replace(/\s+/g, '');
    const neg = step.startsWith('-');
    const abs = neg ? step.slice(1).replace(/^\((.*)\)$/, '$1') : step;
    const start = this.x(f.start);
    let range;
    if (!neg) {
      const m = /^(.*?)\s*-\s*1$/.exec(f.end);
      range = m && !/[<>=]/.test(m[1]) ? `${start} until ${this.x(m[1])}` : `${start}..${this.x(f.end)}`;
      if (step !== '1') range += ` step ${this.x(step)}`;
    } else {
      range = `${start} downTo ${this.x(f.end)}` + (abs !== '1' ? ` step ${this.x(abs)}` : '');
    }
    return [ind + `for (${this.x(f.var)} in ${range}) {`, ...body, ind + '}'];
  }

  whileEl(cond, body, ind) {
    return [ind + `while (${cond === 'true' ? 'true' : this.x(cond)}) {`, ...this.seq(body, ind + this.I), ind + '}'];
  }

  repeatEl(cond, body, ind) {
    return [ind + 'do {', ...this.seq(body, ind + this.I), ind + `} while (${this.x(P.negateCond(cond))})`];
  }

  /** Parallelverarbeitung: je Zweig ein Thread (kotlin.concurrent.thread), danach join */
  parallelEl(el, ind) {
    const I = this.I;
    const branches = this.parBranches(el);
    const out = [ind + this.comment(tr('gen.parallel'))];
    if (!branches.length) return out;
    this.needs.add('thread');
    const ids = branches.map(() => '_t' + this.nextThread());
    branches.forEach((b, k) => out.push(ind + `val ${ids[k]} = thread {`, ...this.seq(b, ind + I), ind + '}'));
    ids.forEach((id) => out.push(ind + `${id}.join()`));
    return out;
  }

  tryEl(el, ind) {
    const I = this.I, v = this.catchVar(el);
    const out = [ind + 'try {', ...this.seq(el.qTry, ind + I), ind + '} catch (_e: Exception) {', ind + I + `val ${v} = _e.message ?: ""`, ...this.seq(el.qCatch, ind + I)];
    if (el.qFinally.length) out.push(ind + '} finally {', ...this.seq(el.qFinally, ind + I));
    out.push(ind + '}');
    return out;
  }

  typeDefs() {
    const out = [];
    for (const e of this.enumConsts) out.push(`const val ${e.name} = ${this.x(e.value)}`);
    for (const [name, fields] of this.recordTypes) out.push(`data class ${name}(${fields.map((f) => `var ${f.name}: ${this.typeName(f.type)} = ${this.defaultValue(f.type)}`).join(', ')})`);
    if (out.length) out.push('');
    return out;
  }

  routine(root) {
    const I = this.I;
    const sig = this.sigs.get(root);
    const isMain = root.rootType === 'program';
    const info = this.analyze(root, isMain ? { ...sig, params: [] } : sig);
    this.cur = info; this.curIsMain = isMain; this.curSig = sig;
    const assigned = assignedNames(root);
    const shadow = isMain ? [] : sig.params.filter((p) => assigned.has(p.name)).map((p) => I + `var ${p.name} = ${p.name}`);
    const hoisted = [...info.hoist].map((n) => I + this.declLine(n, info.types.get(n), null));
    for (const n of info.hoist) info.declared.add(n);
    const body = this.seq(root.children, I);
    const ret = isMain ? null : this.retType(sig);
    const params = isMain ? [] : sig.params.map((p) => `${p.name}: ${this.typeName(p.type || p.inferredType || 'int')}`);
    const doc = (root.comment || []).filter((s) => s.trim()).map((s) => this.comment(s));
    const head = isMain ? 'fun main() {' : `fun ${sig.name}(${params.join(', ')})${ret ? ': ' + this.typeName(ret) : ''} {`;
    return { lines: [...doc, head, ...shadow, ...hoisted, ...body, '}'], isMain };
  }

  run() {
    const roots = this.doc.roots;
    const mainRoot = roots.find((r) => r.rootType === 'program');
    const gen = [];
    if (mainRoot) gen.push(this.routine(mainRoot));
    for (const r of roots) if (r !== mainRoot) gen.push(this.routine(r));
    const out = [this.comment(tr('gen.generated', (mainRoot || roots[0]).text.join(' ')))];
    if (this.needs.has('thread')) out.push('import kotlin.concurrent.thread');
    if (this.needs.has('exit')) out.push('import kotlin.system.exitProcess');
    out.push('', ...this.typeDefs());
    gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines); });
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }
}

/* ==================================================================== */
/* Rust                                                                  */
/* ==================================================================== */
class RsGen extends BaseGen {
  comment(text) { return '// ' + text; }

  typeName(t) {
    const ex = this.exactType(t);
    if (ex) return ex;
    const arrRaw = /^(.*?)\s*\[\s*\]$/.exec(String(t || ''));
    if (arrRaw && P.canonType(arrRaw[1])) return `Vec<${this.typeName(arrRaw[1])}>`;
    const n = P.normType(t);
    if (!n) return 'i32';
    if (n.endsWith('[]')) return `Vec<${this.typeName(n.slice(0, -2))}>`;
    return TYPE_MAP.rust[n] || n;
  }

  defaultValue(t) {
    const n = P.normType(t);
    if (this.recordTypes.has(n)) return `${n}::default()`;
    if (n && n.endsWith('[]')) return 'Vec::new()';
    return { int: '0', double: '0.0', string: 'String::new()', boolean: 'false', char: "' '" }[n] || '0';
  }

  /** Inhalt für Formatstrings: { und } verdoppeln */
  fmtLit(s) { return String(s).replace(/\{/g, '{{').replace(/\}/g, '}}'); }

  fmt(parts) {
    let f = '';
    const args = [];
    for (const p of parts) {
      if (p.lit != null) f += this.fmtLit(p.lit);
      else {
        // Records und Listen haben keine Display-Ausgabe -> Debug-Format
        const t = P.normType(this.exprType(p.expr));
        f += t && (this.recordTypes.has(t) || t.endsWith('[]')) ? '{:?}' : '{}';
        args.push(super.x(p.expr));
      }
    }
    return { f: '"' + f + '"', args };
  }

  x(text) {
    const parts = this.cur ? concatParts(text) : null;
    if (parts) { const { f, args } = this.fmt(parts); return `format!(${[f, ...args].join(', ')})`; }
    return super.x(text);
  }

  /** Bedingung ohne äußere Klammern */
  bare(text) {
    const s = this.x(text);
    const toks = require('./tokenizer').tokenize(s, 'c');
    return require('./tokenizer').isWrapped(toks) ? s.slice(1, -1).trim() : s;
  }

  val(type, expr) {
    const n = P.normType(type) || P.normType(this.exprType(expr));
    if (isArrayLit(expr)) {
      const items = arrayItems(expr);
      const et = n && n.endsWith('[]') ? P.normType(n.slice(0, -2)) : (items.length ? P.normType(this.exprType(items[0])) : 'int');
      return `vec![${items.map((i) => this.val(et, i)).join(', ')}]`;
    }
    let r = this.x(expr);
    if (n === 'double' && /^-?\d+$/.test(r)) r += '.0';
    if (n === 'string' && P.isStringLiteral(expr)) r = `String::from(${r})`;
    else if (n === 'string' && IDENT_ONLY.test(String(expr).trim())) r += '.clone()';
    else if (n && (n.endsWith('[]') || this.recordTypes.has(n)) && IDENT_ONLY.test(String(expr).trim())) r += '.clone()';
    return this.narrow(type, r);
  }

  targetType(target) {
    const m = /^([\p{L}_][\p{L}\p{N}_]*)\s*\[/u.exec(target);
    if (m) { const t = P.normType(this.typeOf(m[1])); return t && t.endsWith('[]') ? t.slice(0, -2) : null; }
    return this.declType(target.trim());
  }

  letLine(name, type, init, isConst) {
    const kw = isConst ? 'let' : 'let mut';
    const arr = /^(.*?)\[(.*)\]$/.exec(name);
    if (arr) {
      const size = this.x(arr[2]) || '0';
      return `${kw} ${arr[1]}: Vec<${this.typeName(type)}> = vec![${this.defaultValue(type)}; ${/^\d+$/.test(size) ? size : `(${size}) as usize`}];`;
    }
    if (init == null) return `${kw} ${name}: ${this.typeName(type)} = ${this.defaultValue(type)};`;
    return `${kw} ${name}${type ? ': ' + this.typeName(type) : ''} = ${init};`;
  }

  stmt(c, ind, el) {
    switch (c.kind) {
      case 'empty': return [];
      case 'decl':
        return c.decls.map((d) => {
          this.cur.declared.add(d.name);
          const t = c.type || this.typeOf(d.name);
          if (d.suffix) return ind + this.letLine(d.name + d.suffix, c.type || 'int', null, c.isConst);
          return ind + this.letLine(d.name, t, d.init != null ? this.val(t, d.init) : null, c.isConst);
        });
      case 'assign': {
        const n = c.target.trim();
        if (n.includes(',') && !/[[(]/.test(n)) {
          const targets = n.split(',').map((s) => s.trim());
          const vals = require('./tokenizer').splitTop(P.ptoks(c.expr), ',').map(joinTokens);
          if (vals.length !== targets.length) return [ind + this.comment(`TODO: ${c.target} = ${c.expr}`)];
          const rhs = `(${vals.map((v, k) => this.val(this.targetType(targets[k]), v)).join(', ')})`;
          if (targets.every((t) => !this.cur.declared.has(t) && !this.cur.params.has(t) && !this.cur.hoist.has(t))) {
            targets.forEach((t) => this.cur.declared.add(t));
            return [ind + `let (${targets.map((t) => 'mut ' + t).join(', ')}) = ${rhs};`];
          }
          return [ind + `(${targets.join(', ')}) = ${rhs};`];
        }
        const t = this.targetType(n);
        if (this.cur.inline.get(el) && this.cur.inline.get(el).has(n) && !this.cur.declared.has(n)) {
          this.cur.declared.add(n);
          return [ind + this.letLine(n, t, this.val(t, c.expr))];
        }
        return [ind + `${this.x(n)} = ${this.val(t, c.expr)};`];
      }
      case 'input': {
        const out = [];
        this.needs.add('input');
        if (c.prompt) out.push(ind + (P.isStringLiteral(c.prompt) ? `print!("${this.fmtLit(P.literalInner(P.ptoks(c.prompt)[0].v))}");` : `print!("{}", ${this.x(c.prompt)});`));
        if (!c.vars.length) { out.push(ind + 'read_line();'); return out; }
        c.vars.forEach((v) => {
          const t = P.normType(this.targetType(v)) || 'string';
          const ct = P.canonType(this.targetType(v)) || t;
          const num = EXACT_TYPES.rust[ct];
          const rd = ct === 'char' ? 'read_line().chars().next().unwrap()' : ct === 'string' || !num ? 'read_line()' : `read_line().parse::<${num}>().unwrap()`;
          const decl = this.cur.inline.get(el) && this.cur.inline.get(el).has(v) && !this.cur.declared.has(v);
          if (decl) this.cur.declared.add(v);
          out.push(ind + (decl ? `let mut ${v}: ${this.typeName(this.targetType(v) || t)} = ${rd};` : `${this.x(v)} = ${rd};`));
        });
        return out;
      }
      case 'output': {
        const parts = this.outParts(c.items);
        if (!parts.length) return [ind + 'println!();'];
        const { f, args } = this.fmt(parts);
        return [ind + `println!(${[f, ...args].join(', ')});`];
      }
      case 'return':
        if (this.curIsMain) return c.expr && c.expr.trim() !== '0' ? this.stmt({ kind: 'exit', expr: c.expr }, ind, el) : [ind + 'return;'];
        return [ind + (c.expr ? `return ${this.val(this.retType(this.curSig), c.expr)};` : 'return;')];
      case 'exit': return [ind + `std::process::exit(${c.expr ? this.x(c.expr) : '0'});`];
      case 'leave': return [ind + 'break;'];
      case 'continue': return [ind + 'continue;'];
      case 'throw': return [ind + `panic!("{}", ${this.x(c.expr)});`];
      default: return [ind + this.x(c.expr) + ';'];
    }
  }

  ifEl(el, ind) {
    const out = [];
    let cond = this.cond(el.text, ['if', 'wenn', 'falls']);
    let t = el.qTrue, f = el.qFalse;
    if (!t.length && f.length) { cond = P.negateCond(cond); [t, f] = [f, t]; }
    out.push(ind + `if ${this.bare(cond)} {`, ...this.seq(t, ind + this.I));
    while (f.length === 1 && f[0].type === 'alternative' && !f[0].disabled && !(f[0].comment || []).some((s) => s.trim()) && f[0].qTrue.length) {
      out.push(ind + `} else if ${this.bare(this.cond(f[0].text, ['if', 'wenn', 'falls']))} {`, ...this.seq(f[0].qTrue, ind + this.I));
      f = f[0].qFalse;
    }
    if (f.length) out.push(ind + '} else {', ...this.seq(f, ind + this.I));
    out.push(ind + '}');
    return out;
  }

  caseEl(el, ind) {
    const I = this.I;
    const disc = el.text[0] || '';
    let d = this.x(disc);
    if (P.normType(this.exprType(disc)) === 'string') d = IDENT_ONLY.test(d) ? `${d}.as_str()` : `(${d}).as_str()`;
    const out = [ind + `match ${d} {`];
    let hasDefault = false;
    for (const b of this.caseInfo(el)) {
      if (b.isDefault) hasDefault = true;
      const head = b.isDefault ? '_' : b.values.map((v) => this.x(v)).join(' | ');
      const body = this.seq(b.body, ind + I + I);
      if (!body.length) out.push(ind + I + `${head} => {}`);
      else out.push(ind + I + `${head} => {`, ...body, ind + I + '}');
    }
    if (!hasDefault) out.push(ind + I + '_ => {}');
    out.push(ind + '}');
    return out;
  }

  /** Fallauswahl mit Bedingungen: match true mit Guards (_ if Bedingung => …) */
  condCaseEl(el, ind, branches) {
    const I = this.I;
    const out = [ind + 'match true {'];
    for (const b of branches) {
      const head = b.isDefault ? '_' : `_ if ${this.bare(b.cond)}`;
      const body = this.seq(b.body, ind + I + I);
      if (!body.length) out.push(ind + I + `${head} => {}`);
      else out.push(ind + I + `${head} => {`, ...body, ind + I + '}');
    }
    if (!branches.some((b) => b.isDefault)) out.push(ind + I + '_ => {}');
    out.push(ind + '}');
    return out;
  }

  forEl(el, ind) {
    const text = linesOf(el).join(' ');
    const f = P.parseForText(text);
    const body = this.seq(el.body, ind + this.I);
    if (!f) return [ind + this.comment(tr('gen.todoLoop', text)), ind + 'loop {', ...body, ind + this.I + 'break;', ind + '}'];
    if (f.kind === 'each') {
      const ct = P.normType(this.exprType(f.coll));
      const c = isArrayLit(f.coll) ? this.val(null, f.coll) : this.x(f.coll);
      return [ind + `for ${f.var} in ${ct === 'string' ? `${c}.chars()` : isArrayLit(f.coll) ? c : `${c}.clone()`} {`, ...body, ind + '}'];
    }
    const usize = (s) => (/^\d+$/.test(s) ? s : `(${s}) as usize`);
    const step = f.step.replace(/\s+/g, '');
    const neg = step.startsWith('-');
    const abs = neg ? step.slice(1).replace(/^\((.*)\)$/, '$1') : step;
    const start = this.x(f.start);
    let range;
    if (!neg) {
      const m = /^(.*?)\s*-\s*1$/.exec(f.end);
      range = m && !/[<>=]/.test(m[1]) ? `${start}..${this.x(m[1])}` : `${start}..=${this.x(f.end)}`;
      if (step !== '1') range = `(${range}).step_by(${usize(this.x(step))})`;
    } else {
      range = `(${this.x(f.end)}..=${start}).rev()` + (abs !== '1' ? `.step_by(${usize(this.x(abs))})` : '');
    }
    return [ind + `for ${this.x(f.var)} in ${range} {`, ...body, ind + '}'];
  }

  whileEl(cond, body, ind) {
    if (cond === 'true') return [ind + 'loop {', ...this.seq(body, ind + this.I), ind + '}'];
    return [ind + `while ${this.bare(cond)} {`, ...this.seq(body, ind + this.I), ind + '}'];
  }

  repeatEl(cond, body, ind) {
    const I = this.I;
    return [ind + 'loop {', ...this.seq(body, ind + I), ind + I + `if ${this.bare(cond)} {`, ind + I + I + 'break;', ind + I + '}', ind + '}'];
  }

  /** Parallelverarbeitung: Threads mit Gültigkeitsbereich (std::thread::scope) – sie dürfen lokale Variablen ausleihen */
  parallelEl(el, ind) {
    const I = this.I;
    const branches = this.parBranches(el);
    const out = [ind + this.comment(tr('gen.parallel'))];
    if (!branches.length) return out;
    out.push(ind + this.comment(tr('gen.parallelRust')), ind + 'std::thread::scope(|_scope| {');
    for (const b of branches) out.push(ind + I + '_scope.spawn(|| {', ...this.seq(b, ind + I + I), ind + I + '});');
    out.push(ind + '});');
    return out;
  }

  /** TRY: Rust hat keine Ausnahmen – throw ist panic!, abgefangen mit catch_unwind (Hilfsfunktion try_block) */
  tryEl(el, ind) {
    const I = this.I, v = this.catchVar(el);
    this.needs.add('try');
    const out = [ind + `if let Err(${v}) = try_block(|| {`, ...this.seq(el.qTry, ind + I), ind + '}) {', ...this.seq(el.qCatch, ind + I), ind + '}'];
    if (el.qFinally.length) out.push(...this.seq(el.qFinally, ind));
    return out;
  }

  routine(root) {
    const I = this.I;
    const sig = this.sigs.get(root);
    const isMain = root.rootType === 'program';
    const info = this.analyze(root, isMain ? { ...sig, params: [] } : sig);
    this.cur = info; this.curIsMain = isMain; this.curSig = sig;
    const assigned = assignedNames(root);
    const hoisted = [...info.hoist].map((n) => I + this.letLine(n, info.types.get(n), null));
    for (const n of info.hoist) info.declared.add(n);
    const body = this.seq(root.children, I);
    const ret = isMain ? null : this.retType(sig);
    const params = isMain ? [] : sig.params.map((p) => `${assigned.has(p.name) ? 'mut ' : ''}${p.name}: ${this.typeName(p.type || p.inferredType || 'int')}`);
    const doc = (root.comment || []).filter((s) => s.trim()).map((s) => '/// ' + s);
    const head = isMain ? 'fn main() {' : `fn ${sig.name}(${params.join(', ')})${ret ? ' -> ' + this.typeName(ret) : ''} {`;
    return { lines: [...doc, head, ...hoisted, ...body, '}'], isMain };
  }

  run() {
    const roots = this.doc.roots;
    const mainRoot = roots.find((r) => r.rootType === 'program');
    const gen = [];
    if (mainRoot) gen.push(this.routine(mainRoot));
    for (const r of roots) if (r !== mainRoot) gen.push(this.routine(r));
    const out = [
      this.comment(tr('gen.generated', (mainRoot || roots[0]).text.join(' '))),
      '#![allow(unused_mut, unused_variables, unused_assignments, unused_parens, non_snake_case, dead_code)]',
      '',
    ];
    for (const e of this.enumConsts) out.push(`const ${e.name}: i32 = ${this.x(e.value)};`);
    for (const [name, fields] of this.recordTypes) {
      out.push('#[derive(Clone, Debug, Default, PartialEq)]', `struct ${name} {`, ...fields.map((f) => `    ${f.name}: ${this.typeName(f.type)},`), '}');
    }
    if (this.enumConsts.length || this.recordTypes.size) out.push('');
    gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines); });
    if (this.needs.has('input')) {
      out.push('', tr('gen.rsReadLine'), 'fn read_line() -> String {',
        '    use std::io::Write;', '    std::io::stdout().flush().unwrap();', '    let mut s = String::new();',
        '    std::io::stdin().read_line(&mut s).unwrap();', '    s.trim().to_string()', '}');
    }
    if (this.needs.has('try')) {
      out.push('', tr('gen.rsTry'),
        'fn try_block<F: FnOnce()>(f: F) -> Result<(), String> {',
        '    let prev = std::panic::take_hook();',
        '    std::panic::set_hook(Box::new(|_| {}));',
        '    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));',
        '    std::panic::set_hook(prev);',
        '    r.map_err(|e| {',
        '        if let Some(s) = e.downcast_ref::<String>() { s.clone() }',
        '        else if let Some(s) = e.downcast_ref::<&str>() { s.to_string() }',
        '        else { String::from("Fehler") }',
        '    })',
        '}');
    }
    if (this.needs.has('random')) {
      out.push('', tr('gen.rsRandom'), 'fn random() -> f64 {',
        '    use std::time::{SystemTime, UNIX_EPOCH};', '    let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos();',
        '    (n % 1_000_000) as f64 / 1_000_000.0', '}');
    }
    if (!mainRoot) out.push('', 'fn main() {}');
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }
}

function toClassName(n) {
  const s = String(n || 'Programm').replace(/[^\p{L}\p{N}_]/gu, '_');
  const c = s.charAt(0).toUpperCase() + s.slice(1);
  return /^\p{L}/u.test(c) ? c : 'P' + c;
}

/**
 * Eingebundene Diagramme (Structorizer „includeList“) vor den Inhalt der einbindenden Diagramme setzen;
 * die Includable-Diagramme selbst werden nicht als Funktion erzeugt.
 */
function expandIncludes(doc) {
  const { clone } = require('./model');
  const inc = new Map(doc.roots.filter((r) => r.rootType === 'includable').map((r) => [P.parseSignature(r.text).name, r]));
  if (!inc.size) return doc;
  const prefix = (r, seen) => {
    const pre = [];
    for (const n of r.includeList || []) {
      if (seen.has(n) || !inc.has(n)) continue;
      seen.add(n);
      const ir = inc.get(n);
      pre.push(...prefix(ir, seen), ...clone(ir.children));
    }
    return pre;
  };
  return { roots: doc.roots.filter((r) => r.rootType !== 'includable').map((r) => ({ ...r, children: [...prefix(r, new Set()), ...r.children] })) };
}

/**
 * @param {{roots:any[]}} doc
 * @param {keyof TARGETS} lang
 * @param {{className?:string}} opts
 */
function generateCode(doc, lang, opts = {}) {
  if (!TARGETS[lang]) throw new Error('Unbekannte Zielsprache: ' + lang);
  if (!doc.roots.length) return '';
  doc = expandIncludes(doc);
  if (!doc.roots.length) return '';
  const G = { python: PyGen, pascal: PasGen, kotlin: KtGen, rust: RsGen }[lang] || CGen;
  return new G(doc, lang, opts).run();
}

module.exports = { generateCode, TARGETS, toClassName };
