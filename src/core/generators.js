'use strict';
/**
 * Struktogramm-Modell -> Quelltext.
 */
const P = require('./pseudo');
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
};

const TYPE_MAP = {
  java: { int: 'int', double: 'double', string: 'String', boolean: 'boolean', char: 'char' },
  c: { int: 'int', double: 'double', string: 'char*', boolean: 'bool', char: 'char' },
  cpp: { int: 'int', double: 'double', string: 'string', boolean: 'bool', char: 'char' },
  csharp: { int: 'int', double: 'double', string: 'string', boolean: 'bool', char: 'char' },
  pascal: { int: 'integer', double: 'real', string: 'string', boolean: 'boolean', char: 'char' },
  python: { int: 'int', double: 'float', string: 'str', boolean: 'bool', char: 'str' },
};

const SIMPLE_IDENT = P.IDENT_RE;
const identsOf = (text) => P.ptoks(text).filter((t, i, a) => t.t === 'id' && !(a[i - 1] && a[i - 1].v === '.')).map((t) => t.v);

function linesOf(el) {
  return (el.text || []).map((l) => String(l)).filter((l) => l.trim());
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
          } else if (c.kind === 'assign' && SIMPLE_IDENT.test(c.target) && !types.has(c.target)) {
            const t = P.inferType(c.expr, types, fnTypes);
            if (t) types.set(c.target, t);
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
    for (const n of all) if (!types.has(n)) types.set(n, null);
    return { types, explicit, params, inline, hoist, forDecl, all, declared: new Set(), fnTypes };
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

  retType(sig) { return P.normType(sig.returnType) || sig.inferredReturn || null; }

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

  el(el, ind) {
    const out = this.elComments(el, ind);
    if (el.disabled) { out.push(ind + this.comment('(deaktiviert) ' + linesOf(el).join(' | '))); return out; }
    switch (el.type) {
      case 'instruction': case 'call': case 'jump': {
        const lines = linesOf(el);
        if (el.type === 'jump' && !lines.length) out.push(...this.stmt({ kind: 'leave' }, ind, el));
        for (const l of lines) out.push(...this.stmt(P.classifyLine(l), ind, el));
        break;
      }
      case 'alternative': out.push(...this.ifEl(el, ind)); break;
      case 'case': out.push(...this.caseEl(el, ind)); break;
      case 'for': out.push(...this.forEl(el, ind)); break;
      case 'while': out.push(...this.whileEl(this.cond(el.text, ['while', 'solange', 'während']), el.body, ind)); break;
      case 'repeat': out.push(...this.repeatEl(this.cond(el.text, ['until', 'bis', 'solange']), el.body, ind)); break;
      case 'forever': out.push(...this.whileEl('true', el.body, ind)); break;
      case 'parallel':
        out.push(ind + this.comment('Parallelverarbeitung (hier nacheinander ausgeführt)'));
        el.branches.forEach((b, i) => { out.push(ind + this.comment(`Zweig ${i + 1}`)); out.push(...this.seq(b, ind)); });
        break;
      default: out.push(ind + this.comment('Unbekanntes Element: ' + el.type));
    }
    return out;
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

  run() { throw new Error('abstract'); }
}

/* ==================================================================== */
/* C-Familie: Java, C, C++, C#, JavaScript                               */
/* ==================================================================== */
class CGen extends BaseGen {
  typeName(t, fallback = 'int') {
    if (this.lang === 'javascript') return 'let';
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
          return ind + this.declLine(d.name + (d.suffix || ''), t, d.init != null ? this.x(d.init) : null, c.isConst);
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
        return [ind + `${this.x(target)} = ${v};`];
      }
      case 'input': return this.inputStmt(c, ind, el);
      case 'output': return [ind + this.outputStmt(c.items)];
      case 'return': {
        if (this.curIsMain && (L === 'c' || L === 'cpp')) return [ind + `return ${c.expr ? this.x(c.expr) : '0'};`];
        if (this.curIsMain && c.expr && c.expr.trim() !== '0') return this.stmt({ kind: 'exit', expr: c.expr }, ind, el);
        if (this.curIsMain) return [ind + (L === 'javascript' ? 'process.exit(0);' : 'return;')];
        return [ind + (c.expr ? `return ${this.x(c.expr)};` : 'return;')];
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
        return [ind + `fprintf(stderr, "%s\\n", ${lit ? e : '"Fehler"'}); exit(1);`];
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
      const decl = this.cur.inline.get(el) && this.cur.inline.get(el).has(v) && !this.cur.declared.has(v);
      if (decl) this.cur.declared.add(v);
      const tv = this.x(v);
      if (L === 'java') {
        this.needs.add('scanner');
        const rd = { int: 'scanner.nextInt()', double: 'scanner.nextDouble()', boolean: 'scanner.nextBoolean()', char: 'scanner.next().charAt(0)' }[t] || 'scanner.nextLine()';
        out.push(ind + (decl ? this.declLine(v, t, rd) : `${tv} = ${rd};`));
      } else if (L === 'csharp') {
        const rd = { int: 'int.Parse(Console.ReadLine())', double: 'double.Parse(Console.ReadLine())', boolean: 'bool.Parse(Console.ReadLine())', char: 'Console.ReadLine()[0]' }[t] || 'Console.ReadLine()';
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
        const fmt = { int: '%d', double: '%lf', char: ' %c', boolean: '%d' }[t];
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
      const s = parts.map((p) => (p.lit != null ? '"' + p.lit + '"' : (this.needsParens(p.expr) ? '(' + this.x(p.expr) + ')' : this.x(p.expr))));
      return 'cout << ' + (s.length ? s.join(' << ') + ' << ' : '') + 'endl;';
    }
    if (L === 'c') {
      let fmt = '';
      const args = [];
      for (const p of parts) {
        if (p.lit != null) fmt += p.lit.replace(/%/g, '%%');
        else {
          const t = P.normType(this.exprType(p.expr));
          const spec = { double: '%g', string: '%s', char: '%c' }[t] || '%d';
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
    const I2 = ind + this.I + this.I;
    for (const b of this.caseInfo(el)) {
      if (b.isDefault) out.push(ind + this.I + 'default:');
      else for (const v of b.values) out.push(ind + this.I + `case ${this.x(v)}:`);
      const body = this.seq(b.body, I2);
      out.push(...body);
      const last = b.body[b.body.length - 1];
      const ends = last && last.type === 'jump' && /^(return|exit|throw|leave|break|continue)\b/i.test(linesOf(last).join(' ').trim() || 'leave');
      if (!ends) out.push(I2 + 'break;');
    }
    out.push(ind + '}');
    return out;
  }

  forEl(el, ind) {
    const L = this.lang;
    const text = linesOf(el).join(' ');
    const f = P.parseForText(text);
    const out = [];
    const body = this.seq(el.body, ind + this.I);
    if (!f) {
      out.push(ind + this.comment(`TODO: Schleife "${text}" bitte manuell übersetzen`));
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
          out.push(ind + this.comment(`foreach ${v} in ${f.coll}: Länge des Arrays ggf. anpassen`));
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

  repeatEl(cond, body, ind) {
    return [ind + 'do {', ...this.seq(body, ind + this.I), ind + `} while (${this.x(P.negateCond(cond))});`];
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
    const I = this.I;
    const bodyInd = L === 'java' || L === 'csharp' ? I + I : I;
    const head = [];
    const hoisted = [...info.hoist].map((n) => bodyInd + this.declLine(n, info.types.get(n) || (L === 'javascript' ? null : 'int'), L === 'javascript' ? null : this.defaultValue(info.types.get(n))));
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
    const title = this.comment(`Erzeugt aus Struktogramm "${mainRoot ? mainRoot.text.join(' ') : (roots[0] ? roots[0].text.join(' ') : '')}"`);
    if (L === 'java') {
      const cls = this.opts.className || toClassName(mainName);
      if (this.needs.has('scanner')) out.push('import java.util.Scanner;', '');
      out.push(title, `public class ${cls} {`);
      if (this.needs.has('scanner')) out.push(this.I + 'static Scanner scanner = new Scanner(System.in);', '');
      gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines); });
      out.push('}');
    } else if (L === 'csharp') {
      out.push('using System;', '', title, `class ${this.opts.className || toClassName(mainName)}`, '{');
      gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines.map((l) => l.replace(/^(\s*)(.*) \{$/, (m0, a, b) => (/^(static|public)/.test(b.trim()) ? `${a}${b}\n${a}{` : m0)))); });
      out.push('}');
    } else if (L === 'javascript') {
      out.push(title);
      if (this.needs.has('prompt')) out.push('// Eingabe im Terminal: npm install prompt-sync', 'const prompt = require("prompt-sync")();');
      out.push('');
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
      } else {
        inc.push('#include <iostream>');
        if (this.needs.has('string')) inc.push('#include <string>');
        if (this.needs.has('math')) inc.push('#include <cmath>');
        if (this.needs.has('stdlib')) inc.push('#include <cstdlib>');
        if (this.needs.has('stdexcept')) inc.push('#include <stdexcept>');
        inc.push('', 'using namespace std;');
      }
      out.push(title, ...inc, '');
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
        return c.decls.filter((d) => d.init != null).map((d) => {
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
    if (!f) return [ind + this.comment(`TODO: Schleife "${text}" bitte manuell übersetzen`), ind + 'while True:', ...this.block(el.body, ind + this.I), ind + this.I + 'break'];
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
      const lines = [];
      lines.push(this.comment(`Hauptprogramm: ${r.text.join(' ')}`));
      (r.comment || []).filter((s) => s.trim()).forEach((s) => lines.push(this.comment(s)));
      lines.push(...this.seq(r.children, ''));
      mainParts.push(lines);
    }
    const head = [];
    for (const m of ['math', 'random', 'sys']) if (this.needs.has(m)) head.push(`import ${m}`);
    const out = [];
    if (head.length) out.push(...head, '', '');
    parts.forEach((p) => out.push(...p, '', ''));
    mainParts.forEach((p, i) => { if (i) out.push(''); out.push(...p); });
    return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }
}

/* ==================================================================== */
class PasGen extends BaseGen {
  comment(text) { return '{ ' + text.replace(/[{}]/g, '') + ' }'; }

  typeName(t) {
    const n = P.normType(t);
    if (!n) return 'integer';
    if (n.endsWith('[]')) return 'array of ' + this.typeName(n.slice(0, -2));
    return TYPE_MAP.pascal[n] || n;
  }

  stmt(c, ind) {
    switch (c.kind) {
      case 'empty': return [];
      case 'decl': return c.decls.filter((d) => d.init != null).map((d) => ind + `${d.name} := ${this.x(d.init)};`);
      case 'assign': return [ind + `${this.x(c.target)} := ${this.x(c.expr)};`];
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
    if (!f) return [ind + this.comment(`TODO: Schleife "${text}" bitte manuell übersetzen`), ...this.beginEnd(el.body, ind)];
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

  varSection(info, ind, skip) {
    const byType = new Map();
    for (const n of info.all) {
      if (skip.has(n)) continue;
      const t = this.typeName(info.types.get(n));
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
      body.push(...this.varSection(info, '', new Set([...info.params, sig.name])));
      body.push(...this.beginEnd(r.children, ''), '');
    }
    let mainLines = [];
    let progName = 'Programm';
    if (main) {
      const info = this.analyze(main, { params: [] });
      this.cur = info; this.curIsMain = true;
      progName = toClassName(this.sigs.get(main).name);
      mainLines = [...this.varSection(info, '', new Set()), '', ...this.beginEnd(main.children, '', '.')];
    }
    out.push(`program ${progName};`, '', '{$mode objfpc}{$H+}', '');
    const uses = [];
    if (this.needs.has('math')) uses.push('Math');
    if (this.needs.has('sysutils')) uses.push('SysUtils');
    if (uses.length) out.push(`uses ${uses.join(', ')};`, '');
    out.push(...body);
    if (main) out.push(...mainLines);
    else out.push('begin', 'end.');
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }
}

function toClassName(n) {
  const s = String(n || 'Programm').replace(/[^\p{L}\p{N}_]/gu, '_');
  const c = s.charAt(0).toUpperCase() + s.slice(1);
  return /^\p{L}/u.test(c) ? c : 'P' + c;
}

/**
 * @param {{roots:any[]}} doc
 * @param {keyof TARGETS} lang
 * @param {{className?:string}} opts
 */
function generateCode(doc, lang, opts = {}) {
  if (!TARGETS[lang]) throw new Error('Unbekannte Zielsprache: ' + lang);
  if (!doc.roots.length) return '';
  const G = lang === 'python' ? PyGen : lang === 'pascal' ? PasGen : CGen;
  return new G(doc, lang, opts).run();
}

module.exports = { generateCode, TARGETS, toClassName };
