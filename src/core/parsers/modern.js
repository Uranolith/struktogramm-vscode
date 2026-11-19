'use strict';
/**
 * Parser für Kotlin und Rust -> Struktogramm-Modell.
 * Wie der C-Parser kein vollständiger Compiler-Parser, sondern ein fehlertoleranter
 * Anweisungs-Parser, der Kontrollstrukturen, Ein-/Ausgabe und Deklarationen erkennt.
 * Erzeugt den alten Pseudocode-Stil ("<-", "=", "<>"); parseCode modernisiert danach.
 */
const { tokenize, joinTokens, matchClose, splitTop, findTop, isWrapped, OPEN, CLOSE } = require('../tokenizer');
const { mk, sequencesOf } = require('../model');
const { t } = require('../../i18n');
const P = require('../pseudo');
const { outputLine, inputLine, litContent, stripTrailingNewline, refine, addComment } = require('./common');

const KT_TYPES = { Int: 'int', Long: 'int', Short: 'int', Byte: 'int', UInt: 'int', ULong: 'int', Double: 'double', Float: 'double', Number: 'double', String: 'string', CharSequence: 'string', Boolean: 'boolean', Char: 'char' };
const KT_ARRAYS = { IntArray: 'int[]', LongArray: 'int[]', ShortArray: 'int[]', ByteArray: 'int[]', DoubleArray: 'double[]', FloatArray: 'double[]', BooleanArray: 'boolean[]', CharArray: 'char[]' };
const RS_TYPES = { i8: 'int', i16: 'int', i32: 'int', i64: 'int', i128: 'int', isize: 'int', u8: 'int', u16: 'int', u32: 'int', u64: 'int', u128: 'int', usize: 'int', f32: 'double', f64: 'double', String: 'string', str: 'string', bool: 'boolean', char: 'char' };
const COLLECTIONS = new Set(['Array', 'List', 'MutableList', 'ArrayList', 'Vec', 'VecDeque', 'Set', 'MutableSet', 'HashSet']);
const KT_MODIFIERS = new Set(['public', 'private', 'protected', 'internal', 'open', 'override', 'abstract', 'final', 'data', 'sealed',
  'inline', 'suspend', 'tailrec', 'operator', 'infix', 'external', 'lateinit', 'inner', 'enum', 'annotation', 'value', 'expect', 'actual', 'const']);
const RS_MODIFIERS = new Set(['pub', 'async', 'unsafe', 'extern', 'default']);
const ARRAY_BUILDERS = new Set(['arrayOf', 'intArrayOf', 'doubleArrayOf', 'longArrayOf', 'floatArrayOf', 'booleanArrayOf', 'charArrayOf',
  'listOf', 'mutableListOf', 'arrayListOf', 'setOf', 'mutableSetOf']);
const KT_CONV = { toInt: 'int', toLong: 'int', toShort: 'int', toByte: 'int', toIntOrNull: 'int', toDouble: 'float', toFloat: 'float', toDoubleOrNull: 'float', toString: 'str' };
const MATH_METHODS = { abs: 'abs', sqrt: 'sqrt', floor: 'floor', ceil: 'ceil', round: 'round', absoluteValue: 'abs' };
const DROP_METHODS = new Set(['clone', 'unwrap', 'trim', 'to_owned', 'as_str', 'as_ref', 'iter', 'into_iter', 'iter_mut', 'to_vec',
  'collect', 'borrow', 'borrow_mut', 'trim_end', 'trimEnd', 'as_slice', 'cloned', 'copied', 'toList', 'toMutableList', 'toTypedArray',
  'toIntArray', 'toCharArray']);
const OUT_LN = new Set(['println', 'System.out.println', 'println!', 'eprintln!']);
const OUT_NOLN = new Set(['print', 'System.out.print', 'print!', 'eprint!']);
const EXIT = new Set(['exitProcess', 'kotlin.system.exitProcess', 'System.exit', 'std::process::exit', 'process::exit', 'exit']);
const CONTROL = new Set(['if', 'else', 'while', 'for', 'do', 'when', 'match', 'loop', 'return', 'break', 'continue', 'throw', 'try',
  'catch', 'finally', 'fun', 'fn', 'val', 'var', 'let', 'in', 'is', 'as', 'class', 'object', 'struct', 'impl', 'trait', 'enum']);

/** Tokens nachbearbeiten: "..", "..=", "..<", "?:", "!!" und Rust-Makros (println!) zusammenfassen */
function mergeTokens(T, rust) {
  const out = [];
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    const p = out[out.length - 1];
    if (p && p.t === 'op' && t.t === 'op' && !t.ws) {
      const v = p.v + t.v;
      if (['..', '..=', '..<', '?:', '!!'].includes(v) && (p.v !== '..' || t.v !== '.')) { out[out.length - 1] = { ...p, v, end: t.end }; continue; }
    }
    // "1..10": Tokenizer liest ".10" als Zahl
    if (p && p.t === 'op' && p.v === '.' && t.t === 'num' && t.v.startsWith('.') && !t.ws) {
      out[out.length - 1] = { ...p, v: '..', end: p.end + 1 };
      out.push({ ...t, v: t.v.slice(1), start: t.start + 1 });
      continue;
    }
    if (rust && t.t === 'op' && t.v === '!' && !t.ws && p && p.t === 'id' && T[i + 1] && ['(', '[', '{'].includes(T[i + 1].v)) {
      out[out.length - 1] = { ...p, v: p.v + '!', end: t.end };
      continue;
    }
    out.push(t);
  }
  return out;
}

/** Rust: Lifetimes ('a, 'static) und Schleifenmarken ('outer:) durch Leerzeichen ersetzen (Positionen bleiben) */
function stripLifetimes(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; out += src.slice(i, e); i = e - 1; continue; }
    if (c === "'") {
      const ch = /^'(?:\\u\{[0-9a-fA-F]+\}|\\.|[^\\'])'/.exec(src.slice(i, i + 12));
      if (ch) { out += ch[0]; i += ch[0].length - 1; continue; }
      const lt = /^'[\p{L}_][\p{L}\p{N}_]*:?/u.exec(src.slice(i, i + 64));
      if (lt) { out += ' '.repeat(lt[0].length); i += lt[0].length - 1; continue; }
    }
    out += c;
  }
  return out;
}

/** schließende Klammer – bei unvollständigem Code (Live-Vorschau) das Ende der Tokenliste */
const closeOf = (toks, i) => { const c = matchClose(toks, i); return c < 0 ? toks.length - 1 : c; };

const canEnd = (t) => t && (t.t === 'id' || t.t === 'num' || t.t === 'str' || [')', ']', '}', '++', '--', '!!', '?'].includes(t.v));
const CONTINUATION = new Set(['.', '?.', '?:', '&&', '||', 'as', 'as?', '::', '..', '..<', '..=', '->', '=>', '{']);

class ModernParser {
  constructor(src, lang, opts = {}) {
    this.lang = lang;
    this.kt = lang === 'kotlin';
    this.rs = lang === 'rust';
    this.opts = opts;
    this.T = mergeTokens(tokenize(this.rs ? stripLifetimes(src) : src, 'c'), this.rs);
    this.roots = [];
    this.globals = [];
    this.className = null;
    this.inputBufs = new Set();
    this.scannerVars = new Set();
    this.userFuncs = this.prescan();
    this.p = 0;
  }

  parse() {
    this.members(this.T.length, true);
    let main = this.roots.find((r) => r.rootType === 'program');
    if (this.globals.length) {
      const g = this.finish(this.globals);
      if (main) main.children.unshift(...g);
      else { main = mk.root(this.opts.name || t('core.mainProgram'), 'program', g); this.roots.unshift(main); }
    }
    this.roots.sort((a, b) => (a.rootType === 'program' ? 0 : 1) - (b.rootType === 'program' ? 0 : 1));
    for (const r of this.roots) this.dropUnusedBuffers(r);
    return { roots: this.roots };
  }

  prescan() {
    const T = this.T, set = new Set();
    for (let i = 0; i < T.length; i++) {
      if (T[i].t !== 'id' || (T[i].v !== 'fun' && T[i].v !== 'fn')) continue;
      let k = i + 1;
      if (T[k] && T[k].v === '<') k = this.skipAngle(k);
      let name = null;
      while (T[k] && (T[k].t === 'id' || T[k].v === '.')) { if (T[k].t === 'id') name = T[k].v; k++; }
      if (T[k] && (T[k].v === '(' || T[k].v === '<') && name) set.add(name);
    }
    return set;
  }

  skipAngle(i) {
    const T = this.T;
    let depth = 0;
    for (let k = i; k < T.length; k++) {
      if (T[k].v === '<') depth++;
      else if (T[k].v === '>') depth--;
      else if (T[k].v === '>>') depth -= 2;
      else if (T[k].v === '->' || T[k].v === '=>') continue;
      else if (T[k].v === '{' || T[k].v === ';') return k;
      if (depth <= 0) return k + 1;
    }
    return T.length;
  }

  /* ------------------------------------------------------------ */
  /* Deklarationsebene (Datei, Klasse, impl-Block)                 */
  /* ------------------------------------------------------------ */
  members(end, topLevel) {
    const T = this.T;
    while (this.p < end) {
      const t = T[this.p];
      if (t.v === ';' || t.v === '}' || t.v === ',') { this.p++; continue; }
      if (this.skipAttribute()) continue;
      if (t.t === 'id' && (KT_MODIFIERS.has(t.v) || RS_MODIFIERS.has(t.v)) && T[this.p + 1] && T[this.p + 1].t === 'id' &&
          t.v !== 'const') { this.p++; continue; }
      if (this.rs && t.v === 'pub' && T[this.p + 1] && T[this.p + 1].v === '(') { this.p++; this.group(); continue; }
      switch (t.v) {
        case 'package': case 'import': case 'use': case 'typealias': case 'type': case 'extern':
          this.skipStatement(end); continue;
        case 'mod':
          if (this.braceAhead(end)) { this.p = this.braceAhead(end) + 1; continue; }
          this.skipStatement(end); continue;
        case 'fun': case 'fn': this.functionDef(end); continue;
        case 'class': case 'object': case 'interface': case 'impl': case 'trait': case 'companion': case 'struct': case 'enum': case 'union': {
          const isData = ['struct', 'enum', 'union'].includes(t.v) || (this.kt && t.v === 'class' && T[this.p - 1] && ['data', 'enum', 'annotation'].includes(T[this.p - 1].v));
          let nameTok = T[this.p + 1];
          if (t.v === 'companion') nameTok = null;
          if (t.v === 'impl') { let k = this.p + 1; if (T[k] && T[k].v === '<') k = this.skipAngle(k); nameTok = T[k]; }
          const brace = this.braceAhead(end);
          if (brace < 0) { this.skipStatement(end); continue; }
          const close = matchClose(T, brace);
          if (isData) { this.p = close < 0 ? end : close + 1; continue; }
          const prev = this.className;
          if (nameTok && nameTok.t === 'id' && !['object'].includes(nameTok.v)) this.className = nameTok.v;
          this.p = brace + 1;
          this.members(close < 0 ? end : close, false);
          this.className = prev;
          this.p = close < 0 ? end : close + 1;
          continue;
        }
        case 'init': if (T[this.p + 1] && T[this.p + 1].v === '{') { const c = matchClose(T, this.p + 1); this.p = c < 0 ? end : c + 1; continue; } break;
        default: break;
      }
      // Anweisung auf Datei-Ebene (Kotlin-Skript, globale Konstanten)
      const before = this.p;
      const st = this.statement(end);
      if (topLevel) this.globals.push(...st);
      if (this.p === before) this.p++;
    }
  }

  /** Index der nächsten "{" auf oberster Ebene vor dem Ende der Deklaration (oder -1) */
  braceAhead(end) {
    const T = this.T;
    let depth = 0;
    for (let k = this.p + 1; k < end; k++) {
      const v = T[k].t === 'op' ? T[k].v : '';
      if (depth === 0 && v === '{') return k;
      if (v === '(' || v === '[') depth++;
      else if (v === ')' || v === ']') depth--;
      else if (depth === 0 && (v === ';' || v === '}')) return -1;
      if (this.kt && depth === 0 && T[k + 1] && T[k + 1].nl && T[k + 1].v !== '{' && T[k + 1].v !== ':' && T[k + 1].v !== ',' &&
          !['where', 'constructor'].includes(T[k + 1].v) && canEnd(T[k]) && T[k].v !== ',' ) {
        // Kotlin: Deklaration ohne Rumpf endet am Zeilenende
        if (!(T[k + 1].t === 'op' && CONTINUATION.has(T[k + 1].v))) return -1;
      }
    }
    return -1;
  }

  skipAttribute() {
    const T = this.T;
    const t = T[this.p];
    if (!t) return false;
    if (t.v === '#' && T[this.p + 1] && (T[this.p + 1].v === '[' || (T[this.p + 1].v === '!' && T[this.p + 2] && T[this.p + 2].v === '['))) {
      const open = T[this.p + 1].v === '[' ? this.p + 1 : this.p + 2;
      const c = matchClose(T, open);
      this.p = c < 0 ? this.p + 1 : c + 1;
      return true;
    }
    if (this.kt && t.v === '@' && T[this.p + 1] && T[this.p + 1].t === 'id') {
      this.p += 2;
      while (T[this.p] && T[this.p].v === '.' && T[this.p + 1]) this.p += 2;
      if (T[this.p] && T[this.p].v === '(' && !T[this.p].ws) this.group();
      return true;
    }
    return false;
  }

  skipStatement(end) {
    const e = this.stmtEnd(this.p, end);
    this.p = e.end + (e.term === ';' ? 1 : 0);
    if (this.p <= e.end && e.term !== ';' && this.p === e.end && this.T[this.p] && !CLOSE[this.T[this.p].v]) this.p = e.end;
  }

  functionDef(end) {
    const T = this.T;
    let k = this.p + 1;
    if (T[k] && T[k].v === '<') k = this.skipAngle(k);
    let name = null;
    while (T[k] && (T[k].t === 'id' || T[k].v === '.' || T[k].v === '?')) { if (T[k].t === 'id') name = T[k].v; k++; }
    if (T[k] && T[k].v === '<') k = this.skipAngle(k);
    if (!name || !T[k] || T[k].v !== '(') { this.skipStatement(end); return; }
    const close = matchClose(T, k);
    if (close < 0) { this.p = end; return; }
    const paramToks = T.slice(k + 1, close);
    // Rückgabetyp bis "{" / "=" / where
    let j = close + 1;
    let retToks = [];
    if (T[j] && (T[j].v === ':' || T[j].v === '->')) {
      const s = j + 1;
      let depth = 0;
      for (j = s; j < end; j++) {
        const v = T[j].v;
        if (v === '<' || v === '(' || v === '[') depth++;
        else if (v === '>' || v === ')' || v === ']') depth--;
        else if (v === '>>') depth -= 2;
        if (depth <= 0 && (v === '{' || v === '=' || v === ';' || v === 'where')) break;
        if (depth <= 0 && this.kt && T[j].nl && j > s) break;
      }
      retToks = T.slice(s, j);
    }
    while (T[j] && T[j].v === 'where') { while (j < end && T[j].v !== '{' && T[j].v !== '=') j++; }
    let body;
    if (T[j] && T[j].v === '{') {
      this.p = j;
      body = this.block();
    } else if (T[j] && T[j].v === '=') { // Kotlin: fun f(x: Int) = x * 2
      const e = this.stmtEnd(j + 1, end);
      const sub = T.slice(j + 1, e.end);
      this.p = e.end + (e.term === ';' ? 1 : 0);
      body = this.valueStatement(sub, (expr, call) => mk.jump('return ' + expr));
    } else { // Deklaration ohne Rumpf (Trait / Interface)
      this.p = j + (T[j] && T[j].v === ';' ? 1 : 0);
      return;
    }
    this.addFunction(name, paramToks, retToks, body);
  }

  addFunction(name, paramToks, retToks, body) {
    const params = this.params(paramToks);
    let ret = retToks.length ? this.pseudoType(retToks) : null;
    if (ret && /^(Unit|\(\)|Nothing|!)$/.test(ret.replace(/\s+/g, ''))) ret = null;
    const isMain = name === 'main';
    if (isMain) {
      const last = body[body.length - 1];
      if (last && /^(Ok\s*\(\s*\(\s*\)\s*\)|return)$/.test(last.text.join(' ').trim())) body.pop();
    } else if (ret && this.rs) this.returnLeaves(body);
    let text;
    if (isMain) text = this.opts.name && !this.className ? this.opts.name : (this.className || 'main');
    else {
      const ps = params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(params.some((p) => p.type) ? '; ' : ', ');
      text = `${name}(${ps})` + (ret ? `: ${ret}` : '');
    }
    this.roots.push(mk.root(text, isMain ? 'program' : 'sub', this.finish(body)));
  }

  finish(body) {
    this.mergeInput(body);
    return refine(body);
  }

  params(toks) {
    const res = [];
    for (let part of splitTop(toks, ',')) {
      part = part.filter((x) => !['vararg', 'noinline', 'crossinline', 'val', 'var', 'mut'].includes(x.v));
      while (part[0] && part[0].v === '@') part = part.slice(2);
      if (!part.length) continue;
      if (part.some((x) => x.v === 'self')) continue; // &self, &mut self
      const colon = findTop(part, (x) => x.v === ':');
      if (colon < 0) { if (part[0].t === 'id') res.push({ name: part[0].v, type: null }); continue; }
      const eq = findTop(part, (x) => x.v === '=');
      const typeToks = part.slice(colon + 1, eq > colon ? eq : part.length);
      const nameTok = part.slice(0, colon).filter((x) => x.t === 'id').pop();
      if (!nameTok) continue;
      res.push({ name: nameTok.v, type: this.pseudoType(typeToks) });
    }
    return res;
  }

  /** Kotlin-/Rust-Typ -> Pseudocode-Typ (int, double, string, boolean, char, x[]) */
  pseudoType(toks) {
    let ts = toks.filter((x) => x.v !== '&' && x.v !== 'mut' && x.v !== '?' && x.v !== 'dyn' && !(x.t === 'str' && x.v.startsWith("'")));
    if (!ts.length) return null;
    const raw = joinTokens(ts).replace(/\s+/g, '');
    const simple = (n) => (this.kt ? KT_TYPES[n] : RS_TYPES[n]) || null;
    if (simple(raw)) return simple(raw);
    if (KT_ARRAYS[raw]) return KT_ARRAYS[raw];
    // [i32; 5] / [i32]
    if (ts[0].v === '[') {
      const c = matchClose(ts, 0);
      const inner = ts.slice(1, c < 0 ? ts.length : c);
      const semi = findTop(inner, (x) => x.v === ';');
      const el = this.pseudoType(semi >= 0 ? inner.slice(0, semi) : inner);
      return (el || 'int') + '[]';
    }
    const m = /^([\w:]+)<(.+)>$/.exec(raw);
    if (m && COLLECTIONS.has(m[1].split('::').pop())) {
      const inner = this.pseudoType(tokenize(m[2], 'c'));
      return (inner || m[2]) + '[]';
    }
    if (m && /^(Box|Rc|Arc|RefCell|Option)$/.test(m[1])) return this.pseudoType(tokenize(m[2], 'c'));
    return raw;
  }

  /* ------------------------------------------------------------ */
  /* Anweisungsgrenzen                                            */
  /* ------------------------------------------------------------ */
  stmtEnd(i, end) {
    const T = this.T;
    let depth = 0, ifs = 0;
    for (let k = i; k < end; k++) {
      const t = T[k];
      if (k > i && depth === 0) {
        if (t.t === 'id' && t.v === 'else') {
          if (ifs === 0) return { end: k, term: null };
          ifs--;
          continue;
        }
        if (this.kt && t.nl && canEnd(T[k - 1]) && !(T[k - 1].t === 'id' && ['in', 'is', 'as', 'and', 'or', 'else'].includes(T[k - 1].v)) &&
            !(t.t === 'op' && CONTINUATION.has(t.v)) && !(t.t === 'id' && ['as', 'else', 'until', 'downTo', 'step'].includes(t.v))) {
          return { end: k, term: null };
        }
      }
      if (t.t === 'op' && OPEN[t.v]) depth++;
      else if (t.t === 'op' && CLOSE[t.v]) { if (depth === 0) return { end: k, term: null }; depth--; }
      else if (depth === 0 && t.v === ';') return { end: k, term: ';' };
      else if (depth === 0 && t.t === 'id' && t.v === 'if') ifs++;
    }
    return { end, term: null };
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

  /** Kotlin: Block oder einzelne Anweisung */
  body(end) {
    const T = this.T;
    if (T[this.p] && T[this.p].v === '{') return this.block();
    return this.statement(end);
  }

  group() {
    const T = this.T;
    if (!T[this.p] || T[this.p].v !== '(') return [];
    const c = matchClose(T, this.p);
    const inner = T.slice(this.p + 1, c < 0 ? T.length : c);
    this.p = c < 0 ? T.length : c + 1;
    return inner;
  }

  /** Rust: Tokens bis zur öffnenden "{" des Rumpfs */
  untilBrace(end) {
    const T = this.T;
    let depth = 0;
    const s = this.p;
    for (let k = this.p; k < end; k++) {
      const v = T[k].t === 'op' ? T[k].v : '';
      if (depth === 0 && v === '{') { this.p = k; return T.slice(s, k); }
      if (v === '(' || v === '[') depth++;
      else if (v === ')' || v === ']') depth--;
    }
    this.p = end;
    return T.slice(s, end);
  }

  /** Bedingung von if/while (Kotlin: in Klammern, Rust: bis "{") */
  condToks(end) {
    if (this.kt) return this.group();
    return this.untilBrace(end);
  }

  statement(end) {
    const T = this.T;
    const t = T[this.p];
    if (!t) return [];
    if (this.skipAttribute()) return [];
    if (t.t === 'op') {
      if (t.v === '{') return this.block();
      if (t.v === ';' || t.v === '}' || t.v === ',') { this.p++; return []; }
    }
    // Sprungmarken: loop@ for (...)  /  'outer: loop
    if (this.kt && t.t === 'id' && T[this.p + 1] && T[this.p + 1].v === '@' && !T[this.p + 1].ws && T[this.p + 2] && ['for', 'while', 'do'].includes(T[this.p + 2].v)) { this.p += 2; return this.statement(end); }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': return this.ifStmt(end);
        case 'while': return this.whileStmt(end);
        case 'do': if (this.kt) return this.doStmt(end); break;
        case 'loop': if (this.rs && T[this.p + 1] && T[this.p + 1].v === '{') { this.p++; return [mk.forever(this.block())]; } break;
        case 'for': return this.forStmt(end);
        case 'when': if (this.kt) return this.whenStmt(end); break;
        case 'match': if (this.rs) return this.matchStmt(end); break;
        case 'try': if (this.kt) return this.tryStmt(end); break;
        case 'fun': case 'fn': this.functionDef(end); return [];
        case 'class': case 'object': case 'struct': case 'enum': case 'impl': case 'trait': case 'interface': {
          const brace = this.braceAhead(end);
          if (brace >= 0) { const c = matchClose(T, brace); this.p = c < 0 ? end : c + 1; return []; }
          break;
        }
        case 'import': case 'package': case 'use': this.skipStatement(end); return [];
        case 'else': this.p++; return [];
        case 'unsafe': if (this.rs && T[this.p + 1] && T[this.p + 1].v === '{') { this.p++; return this.block(); } break;
        default: break;
      }
    }
    const e = this.stmtEnd(this.p, end);
    const toks = T.slice(this.p, e.end);
    this.p = e.end + (e.term === ';' ? 1 : 0);
    return this.simple(toks);
  }

  ifStmt(end) {
    const T = this.T;
    this.p++;
    if (this.rs && T[this.p] && T[this.p].v === 'let') { // if let – als Bedingungstext übernehmen
      const c = this.untilBrace(end);
      const thenB = this.block();
      let elseB = [];
      if (T[this.p] && T[this.p].v === 'else') { this.p++; elseB = T[this.p] && T[this.p].v === 'if' ? this.ifStmt(end) : this.block(); }
      return [mk.alternative('if ' + joinTokens(c), thenB, elseB)];
    }
    const cond = this.expr(this.condToks(end));
    const thenB = this.body(end);
    let elseB = [];
    let k = this.p;
    while (T[k] && T[k].v === ';') k++;
    if (T[k] && T[k].v === 'else') { this.p = k + 1; elseB = this.body(end); }
    return [mk.alternative(cond, thenB, elseB)];
  }

  whileStmt(end) {
    this.p++;
    if (this.rs && this.T[this.p] && this.T[this.p].v === 'let') {
      const c = this.untilBrace(end);
      return [mk.while('while ' + joinTokens(c), this.block())];
    }
    const cond = this.expr(this.condToks(end));
    const body = this.body(end);
    if (/^true$/.test(cond)) return [mk.forever(body)];
    return [mk.while('while ' + cond, body)];
  }

  doStmt(end) {
    const T = this.T;
    this.p++;
    const body = this.body(end);
    let cond = 'false';
    if (T[this.p] && T[this.p].v === 'while') { this.p++; cond = this.expr(this.group()); }
    if (T[this.p] && T[this.p].v === ';') this.p++;
    if (cond === 'true') return [mk.forever(body)];
    return [mk.repeat('until ' + P.negateCond(cond), body)];
  }

  forStmt(end) {
    const T = this.T;
    this.p++;
    let varToks, collToks;
    if (this.kt) {
      const inner = this.group();
      const k = findTop(inner, (x) => x.v === 'in');
      varToks = k > 0 ? inner.slice(0, k) : inner;
      collToks = k > 0 ? inner.slice(k + 1) : [];
    } else {
      const head = this.untilBrace(end);
      const k = findTop(head, (x) => x.v === 'in');
      varToks = k > 0 ? head.slice(0, k) : head;
      collToks = k > 0 ? head.slice(k + 1) : [];
    }
    const body = this.body(end);
    varToks = varToks.filter((x) => x.v !== 'mut' && x.v !== '&');
    const colon = findTop(varToks, (x) => x.v === ':');
    if (colon > 0) varToks = varToks.slice(0, colon);
    return [mk.for(this.loopHead(joinTokens(varToks), collToks), body)];
  }

  /** Schleifenkopf aus Laufvariable und Bereich/Sammlung */
  loopHead(v, coll) {
    let c = coll.slice();
    let rev = false, step = null;
    for (let guard = 0; guard < 8; guard++) {
      const n = c.length;
      if (n >= 4 && c[n - 1].v === ')' && c[n - 2].v === '(' && ['rev', 'reversed'].includes(c[n - 3].v) && c[n - 4].v === '.') { rev = !rev; c = c.slice(0, -4); continue; }
      if (n >= 3 && c[n - 1].v === ')') {
        const open = this.openOf(c, n - 1);
        if (open > 1 && c[open - 1].v === 'step_by' && c[open - 2].v === '.') { step = this.expr(c.slice(open + 1, n - 1)); c = c.slice(0, open - 2); continue; }
        if (open > 1 && DROP_METHODS.has(c[open - 1].v) && c[open - 2].v === '.' && open === n - 2) { c = c.slice(0, open - 2); continue; }
      }
      if (this.kt) {
        const st = findTop(c, (x) => x.v === 'step');
        if (st > 0) { step = this.expr(c.slice(st + 1)); c = c.slice(0, st); continue; }
      }
      if (isWrapped(c)) { c = c.slice(1, -1); continue; }
      if (c[0] && c[0].v === '&') { c = c.slice(c[1] && c[1].v === 'mut' ? 2 : 1); continue; }
      break;
    }
    const k = findTop(c, (x) => ['..', '..=', '..<'].includes(x.v) || (this.kt && x.t === 'id' && ['until', 'downTo'].includes(x.v)));
    if (k > 0 && k < c.length - 1) {
      const a = this.expr(c.slice(0, k));
      const b = this.expr(c.slice(k + 1));
      const op = c[k].v;
      let start = a, endE = b, down = false;
      if ((op === '..' && this.rs) || op === '..<' || op === 'until') endE = P.addConst(b, -1);
      if (op === 'downTo') down = true;
      if (rev) { [start, endE] = [endE, start]; down = !down; }
      let st = step || '1';
      if (down) st = /^\d+$/.test(st) ? '-' + st : (st === '1' ? '-1' : `-(${st})`);
      return `for ${v} <- ${start} to ${endE}` + (st !== '1' ? ` by ${st}` : '');
    }
    if (this.kt && c.length >= 3 && c[c.length - 1].v === 'indices' && c[c.length - 2].v === '.') {
      return `for ${v} <- 0 to length(${this.expr(c.slice(0, -2))}) - 1`;
    }
    return `foreach ${v} in ${this.expr(c)}`;
  }

  openOf(toks, closeIdx) {
    let depth = 0;
    for (let k = closeIdx; k >= 0; k--) {
      const v = toks[k].t === 'op' ? toks[k].v : '';
      if (CLOSE[v]) depth++;
      else if (OPEN[v]) { depth--; if (depth === 0) return k; }
    }
    return -1;
  }

  /* ---------- Kotlin when / Rust match ---------- */
  whenStmt(end) {
    const T = this.T;
    this.p++;
    let subj = null;
    if (T[this.p] && T[this.p].v === '(') {
      let inner = this.group();
      if (inner[0] && (inner[0].v === 'val' || inner[0].v === 'var')) inner = inner.slice(findTop(inner, (x) => x.v === '=') + 1);
      subj = this.expr(inner);
    }
    if (!T[this.p] || T[this.p].v !== '{') return [mk.instruction('when ' + (subj || ''))];
    const close = matchClose(T, this.p);
    const stop = close < 0 ? end : close;
    this.p++;
    const arms = [];
    while (this.p < stop) {
      const t = T[this.p];
      if (t.v === ';' || t.v === ',') { this.p++; continue; }
      let k = this.p, depth = 0;
      for (; k < stop; k++) {
        const v = T[k].t === 'op' ? T[k].v : '';
        if (OPEN[v]) depth++; else if (CLOSE[v]) depth--;
        else if (depth === 0 && v === '->') break;
      }
      const labelToks = T.slice(this.p, k);
      this.p = k + 1;
      const body = this.body(stop);
      const isDefault = labelToks.length === 1 && labelToks[0].v === 'else';
      arms.push({ isDefault, conds: isDefault ? [] : splitTop(labelToks, ','), body });
    }
    this.p = stop + 1;
    return this.buildCase(subj, arms, (c) => this.ktArmCond(subj, c));
  }

  ktArmCond(subj, c) {
    if (subj == null) return { cond: this.expr(c) };
    if (c[0] && (c[0].v === 'in' || (c[0].v === '!' && c[1] && c[1].v === 'in'))) {
      const neg = c[0].v === '!';
      const rest = c.slice(neg ? 2 : 1);
      const k = findTop(rest, (x) => ['..', '..<', 'until'].includes(x.v));
      let cond;
      if (k > 0) {
        const hi = this.expr(rest.slice(k + 1));
        cond = `${subj} >= ${this.expr(rest.slice(0, k))} and ${subj} ${rest[k].v === '..' ? '<=' : '<'} ${hi}`;
      } else cond = `${subj} in ${this.expr(rest)}`;
      return { cond: neg ? `not (${cond})` : cond };
    }
    if (c[0] && (c[0].v === 'is' || (c[0].v === '!' && c[1] && c[1].v === 'is'))) return { cond: `${subj} ${joinTokens(c)}` };
    return { value: this.expr(c) };
  }

  matchStmt(end) {
    const T = this.T;
    this.p++;
    const discToks = this.untilBrace(end);
    const subj = this.expr(discToks);
    if (!T[this.p] || T[this.p].v !== '{') return [mk.instruction('match ' + subj)];
    const close = matchClose(T, this.p);
    const stop = close < 0 ? end : close;
    this.p++;
    const arms = [];
    while (this.p < stop) {
      if (T[this.p].v === ',' || T[this.p].v === ';') { this.p++; continue; }
      let k = this.p, depth = 0;
      for (; k < stop; k++) {
        const v = T[k].t === 'op' ? T[k].v : '';
        if (OPEN[v]) depth++; else if (CLOSE[v]) depth--;
        else if (depth === 0 && v === '=>') break;
      }
      let pat = T.slice(this.p, k);
      this.p = k + 1;
      let guard = null;
      const gi = findTop(pat, (x) => x.v === 'if');
      if (gi >= 0) {
        guard = this.expr(pat.slice(gi + 1));
        pat = pat.slice(0, gi);
        // Bindung "x if x > 10" -> Bedingung über den geprüften Ausdruck
        if (pat.length === 1 && pat[0].t === 'id' && /^[a-z_]/.test(pat[0].v) && pat[0].v !== subj) {
          guard = joinTokens(P.ptoks(guard).map((x) => (x.t === 'id' && x.v === pat[0].v ? { ...x, v: subj } : x)));
        }
      }
      let body;
      if (T[this.p] && T[this.p].v === '{') {
        body = this.block();
      } else {
        let j = this.p, d = 0;
        for (; j < stop; j++) {
          const v = T[j].t === 'op' ? T[j].v : '';
          if (OPEN[v]) d++; else if (CLOSE[v]) d--;
          else if (d === 0 && v === ',') break;
        }
        const toks = T.slice(this.p, j);
        this.p = j + 1;
        body = toks.length === 2 && toks[0].v === '(' && toks[1].v === ')' ? [] : this.simple(toks);
      }
      const isDefault = pat.length === 1 && pat[0].v === '_' && !guard;
      arms.push({ isDefault, conds: isDefault ? [] : splitTop(pat, '|'), body, guard });
    }
    this.p = stop + 1;
    return this.buildCase(subj, arms, (c, arm) => {
      if (arm.guard) return { cond: arm.guard };
      const k = findTop(c, (x) => x.v === '..=' || x.v === '..');
      if (k > 0) return { cond: `${subj} >= ${this.expr(c.slice(0, k))} and ${subj} ${c[k].v === '..=' ? '<=' : '<'} ${this.expr(c.slice(k + 1))}` };
      if (c.length === 1 && c[0].t === 'id' && /^[a-z_]/.test(c[0].v) && c[0].v !== 'true' && c[0].v !== 'false') return { cond: 'true' }; // Bindung
      return { value: this.expr(c) };
    });
  }

  /** Fallauswahl bauen – mit Bereichen/Bedingungen als verschachtelte Alternativen */
  buildCase(subj, arms, condOf) {
    const conv = arms.map((a) => ({ ...a, parts: a.isDefault ? [] : a.conds.filter((c) => c.length).map((c) => condOf(c, a)) }));
    const plain = subj != null && conv.every((a) => a.isDefault || a.parts.every((p) => p.value != null));
    if (plain) {
      const normal = conv.filter((a) => !a.isDefault);
      const def = conv.find((a) => a.isDefault);
      const labels = normal.map((a) => a.parts.map((p) => p.value).join(', '));
      const branches = normal.map((a) => a.body);
      if (def) { labels.push('default'); branches.push(def.body); } else { labels.push('%'); branches.push([]); }
      return [mk.case(subj, labels, branches)];
    }
    // if / else if / else
    let tail = [];
    for (let i = conv.length - 1; i >= 0; i--) {
      const a = conv[i];
      if (a.isDefault) { tail = a.body; continue; }
      const cond = a.parts.map((p) => (p.cond != null ? p.cond : `${subj} = ${p.value}`)).map((c, _, arr) => (arr.length > 1 && /\b(and|or)\b/.test(c) ? `(${c})` : c)).join(' or ');
      if (cond === 'true') { tail = a.body; continue; }
      tail = [mk.alternative(cond, a.body, tail)];
    }
    return tail;
  }

  tryStmt(end) {
    const T = this.T;
    this.p++;
    const body = this.body(end);
    // Kotlin: try { } catch (e: Exception) { } finally { } -> TRY-Element
    let catchVar = null, catchBody = null, fin = [], extra = 0;
    while (T[this.p] && (T[this.p].v === 'catch' || T[this.p].v === 'finally')) {
      if (T[this.p].v === 'catch') {
        this.p++;
        const g = this.group();
        const b = this.body(end);
        if (catchBody) { extra++; continue; }
        catchVar = g[0] && g[0].t === 'id' ? g[0].v : null;
        catchBody = b;
      } else { this.p++; fin = this.body(end); }
    }
    const el = mk.try(catchVar || t('core.defErrorVar'), body, catchBody || [], fin);
    if (extra) addComment(el, t('parse.moreCatch', extra));
    return [el];
  }

  /* ------------------------------------------------------------ */
  /* einfache Anweisungen                                         */
  /* ------------------------------------------------------------ */
  idx(tok) { return this.T.indexOf(tok); }

  /** Teil-Tokens als eigene Anweisungsfolge parsen (für if-/when-/match-Ausdrücke) */
  subStatements(toks) {
    if (!toks.length) return [];
    const s = this.idx(toks[0]);
    const e = this.idx(toks[toks.length - 1]) + 1;
    const save = this.p;
    this.p = s;
    const res = this.statementsUntil(e);
    this.p = save;
    return res;
  }

  /** Ausdruck mit if/when/match als Wert -> Struktur, deren Blätter leaf(expr) erhalten */
  valueStatement(toks, leaf) {
    const v0 = toks[0] && toks[0].v;
    if (['if', 'when', 'match'].includes(v0) || (v0 === '{' && this.rs)) {
      const els = this.subStatements(toks);
      this.applyLeaves(els, leaf);
      return els;
    }
    const call = this.callInfo(toks);
    return [leaf(this.expr(toks), call && this.userFuncs.has(call.name) && !call.callee.includes('.'))];
  }

  applyLeaves(seq, leaf) {
    const last = seq[seq.length - 1];
    if (!last) return;
    if (last.type === 'alternative') { this.applyLeaves(last.qTrue, leaf); this.applyLeaves(last.qFalse, leaf); return; }
    if (last.type === 'case') { last.branches.forEach((b) => this.applyLeaves(b, leaf)); return; }
    if ((last.type === 'instruction' || last.type === 'call') && last.text.length === 1) {
      const c = P.classifyLine(last.text[0]);
      if (c.kind === 'expr') seq[seq.length - 1] = { ...leaf(last.text[0], last.type === 'call'), ...(last.comment ? { comment: last.comment } : {}) };
    }
  }

  returnLeaves(body) { this.applyLeaves(body, (e) => mk.jump('return ' + e)); }

  simple(toks) {
    toks = toks.slice();
    while (toks.length && (toks[toks.length - 1].v === ';' || toks[toks.length - 1].v === '?')) toks.pop();
    if (!toks.length) return [];
    const T0 = toks[0];
    const v0 = T0.v;
    switch (v0) {
      case 'return': {
        const rest = toks.slice(1);
        if (rest[0] && rest[0].v === '@') rest.splice(0, 2);
        if (!rest.length) return [mk.jump('return')];
        if (['if', 'when', 'match'].includes(rest[0].v)) return this.valueStatement(rest, (e) => mk.jump('return ' + e));
        return [mk.jump('return ' + this.expr(rest))];
      }
      case 'break': return [mk.jump('leave')];
      case 'continue': return [mk.jump('continue')];
      case 'throw': return [mk.jump('throw ' + this.throwArg(toks.slice(1)))];
      case 'val': case 'var': case 'let': case 'const': case 'static': case 'lateinit': return this.declaration(toks);
      default: break;
    }
    if (this.kt && v0 === 'repeat' && toks[1] && toks[1].v === '(') return this.ktRepeat(toks);
    const fe = this.ktForEach(toks);
    if (fe) return fe;
    const eq = findTop(toks, (x) => x.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].includes(x.v));
    if (eq > 0) return this.assignment(toks.slice(0, eq), toks[eq].v, toks.slice(eq + 1));
    const last = toks[toks.length - 1];
    if ((last.v === '++' || last.v === '--') && toks.length > 1) { const tg = this.expr(toks.slice(0, -1)); return [mk.instruction(`${tg} <- ${tg} ${last.v[0]} 1`)]; }
    if ((v0 === '++' || v0 === '--') && toks.length > 1) { const tg = this.expr(toks.slice(1)); return [mk.instruction(`${tg} <- ${tg} ${v0[0]} 1`)]; }
    const call = this.callInfo(toks);
    if (call) {
      const io = this.ioCall(call, toks);
      if (io) return io;
      if (this.userFuncs.has(call.name) && !/[.:]/.test(call.callee.replace(/^(self|this)\./, ''))) return [mk.call(this.expr(toks))];
    }
    // Rust: stdin().read_line(&mut s)
    const flat = toks.map((x) => x.v).join('');
    const rl = /read_line\(&mut(\w+)\)/.exec(flat);
    if (rl) { this.inputBufs.add(rl[1]); return [mk.instruction(inputLine(null, [rl[1]]))]; }
    if (/stdout\(\)\.flush\(\)|^\w+\.clear\(\)$/.test(flat) && (!/clear/.test(flat) || this.inputBufs.has(flat.split('.')[0]))) return [];
    return [mk.instruction(this.expr(toks))];
  }

  throwArg(toks) {
    const call = this.callInfo(toks);
    if (call && /(Exception|Error)$/.test(call.name) && call.args.length === 1) return this.expr(call.args[0]);
    if (call && call.args.length === 0 && /(Exception|Error)$/.test(call.name)) return `"${call.name}"`;
    return this.expr(toks);
  }

  /** Kotlin: repeat(n) { ... } */
  ktRepeat(toks) {
    const T = toks;
    const c = matchClose(T, 1);
    if (c < 0 || !T[c + 1] || T[c + 1].v !== '{' || matchClose(T, c + 1) !== T.length - 1) return [mk.instruction(this.expr(toks))];
    const n = this.expr(T.slice(2, c));
    const lam = this.lambda(T.slice(c + 1));
    const v = lam.params[0] || (lam.usesIt ? 'it' : 'i');
    return [mk.for(lam.params[0] || lam.usesIt ? `for ${v} <- 0 to ${P.addConst(n, -1)}` : `for i <- 1 to ${n}`, lam.body)];
  }

  /** Kotlin: coll.forEach { x -> ... }  /  (1..n).forEach { ... } */
  ktForEach(toks) {
    if (!this.kt) return null;
    const n = toks.length;
    if (n < 5 || toks[n - 1].v !== '}') return null;
    const open = this.openOf(toks, n - 1);
    if (open < 2 || toks[open - 1].v !== 'forEach' || toks[open - 2].v !== '.') return null;
    const coll = toks.slice(0, open - 2);
    const lam = this.lambda(toks.slice(open));
    const v = lam.params[0] || 'it';
    return [mk.for(this.loopHead(v, coll), lam.body)];
  }

  /** Lambda-Block { a -> ... } parsen */
  lambda(toks) {
    const inner = toks.slice(1, -1);
    const arrow = findTop(inner, (x) => x.v === '->');
    let params = [], bodyToks = inner;
    if (arrow >= 0) { params = splitTop(inner.slice(0, arrow), ',').map((p) => (p[0] ? p[0].v : '')).filter(Boolean); bodyToks = inner.slice(arrow + 1); }
    const usesIt = bodyToks.some((x) => (x.t === 'id' && x.v === 'it') || (x.t === 'str' && /\$\{?it(?![\p{L}\p{N}_])/u.test(x.v)));
    return { params, body: this.subStatements(bodyToks), usesIt };
  }

  callInfo(toks) {
    if (!toks.length || !(toks[toks.length - 1].v === ')' || (this.rs && toks[toks.length - 1].v === ']'))) return null;
    let open = this.openOf(toks, toks.length - 1);
    if (open <= 0) return null;
    let head = toks.slice(0, open);
    // Rust: turbofish  parse::<i32>
    if (head.length > 3 && head[head.length - 1].v === '>') {
      const lt = head.map((x) => x.v).lastIndexOf('<');
      if (lt > 0 && head[lt - 1].v === '::') head = head.slice(0, lt - 1);
    }
    for (let k = 0; k < head.length; k++) {
      const ok = k % 2 === 0 ? head[k].t === 'id' : ['.', '::', '?.'].includes(head[k].v);
      if (!ok) return null;
    }
    if (head.length % 2 === 0) return null;
    const inner = toks.slice(open + 1, -1);
    return { callee: head.map((x) => x.v).join(''), name: head[head.length - 1].v, args: inner.length ? splitTop(inner, ',') : [] };
  }

  ioCall(call) {
    const n = call.callee.replace(/^std::io::|^io::/, '');
    const a = call.args;
    if (OUT_LN.has(n) || OUT_NOLN.has(n)) {
      let parts;
      if (n.endsWith('!')) parts = a.length ? this.fmtParts(a) : [];
      else parts = a.length ? this.concatParts(a[0]) : [];
      return this.outEl(parts, OUT_LN.has(n));
    }
    if (EXIT.has(n)) return [mk.jump('exit' + (a.length ? ' ' + this.expr(a[0]) : ''))];
    if (n === 'panic!' || n === 'unreachable!' || n === 'todo!' || n === 'unimplemented!') {
      const parts = a.length ? this.fmtParts(a) : [{ lit: n.slice(0, -1) }];
      return [mk.jump('throw ' + this.partsExpr(parts))];
    }
    if (/^(System\.out\.flush|Console\.ReadKey)$/.test(n)) return [];
    const m = /^(\w+)\.close$/.exec(n);
    if (m && this.scannerVars.has(m[1])) return [];
    return null;
  }

  outEl(parts, newline) {
    stripTrailingNewline(parts);
    const el = mk.instruction(outputLine(parts));
    if (!newline && parts.length === 1 && parts[0].lit != null) el._prompt = parts[0].lit;
    return [el];
  }

  /** Teile -> Pseudocode-Ausdruck "a" + x */
  partsExpr(parts) {
    if (!parts.length) return '""';
    return parts.map((p) => (p.lit != null ? '"' + p.lit + '"' : (/[^\w.()[\]]/.test(p.expr) ? '(' + p.expr + ')' : p.expr))).join(' + ');
  }

  /** Rust-Formatstring: println!("a {} b {x}", y) */
  fmtParts(args) {
    const f = args[0];
    if (!(f.length === 1 && f[0].t === 'str')) return args.map((x) => ({ expr: this.expr(x) }));
    const fmt = litContent(f[0].v);
    const parts = [];
    let lit = '', ai = 1;
    for (let i = 0; i < fmt.length; i++) {
      const ch = fmt[i];
      if (ch === '{' && fmt[i + 1] === '{') { lit += '{'; i++; continue; }
      if (ch === '}' && fmt[i + 1] === '}') { lit += '}'; i++; continue; }
      if (ch === '{') {
        const j = fmt.indexOf('}', i);
        if (j < 0) { lit += fmt.slice(i); break; }
        const spec = fmt.slice(i + 1, j).split(':')[0].trim();
        if (lit) { parts.push({ lit }); lit = ''; }
        if (spec === '') { if (args[ai]) parts.push({ expr: this.expr(args[ai++]) }); }
        else if (/^\d+$/.test(spec)) { const arg = args[1 + parseInt(spec, 10)]; if (arg) parts.push({ expr: this.expr(arg) }); }
        else parts.push({ expr: spec });
        i = j;
        continue;
      }
      lit += ch;
    }
    if (lit) parts.push({ lit });
    return parts;
  }

  /** Kotlin: "a" + x + "b" bzw. String-Templates -> Teile */
  concatParts(toks) {
    if (toks.length === 1 && toks[0].t === 'str') return this.strParts(toks[0]);
    const terms = splitTop(toks, '+');
    const firstStr = terms.findIndex((t) => t.length === 1 && t[0].t === 'str');
    if (firstStr < 0 || terms.length === 1) return [{ expr: this.expr(isWrapped(toks) ? toks.slice(1, -1) : toks) }];
    const parts = [];
    if (firstStr > 0) {
      const head = [].concat(...terms.slice(0, firstStr).map((t, k) => (k ? [{ t: 'op', v: '+', ws: true }, ...t] : t)));
      parts.push({ expr: firstStr === 1 ? this.expr(terms[0]) : '(' + this.expr(head) + ')' });
    }
    for (let k = firstStr; k < terms.length; k++) {
      const t = terms[k];
      if (t.length === 1 && t[0].t === 'str') parts.push(...this.strParts(t[0]));
      else parts.push({ expr: this.expr(isWrapped(t) ? t.slice(1, -1) : t) });
    }
    return parts;
  }

  /** String-Literal -> Teile (Kotlin: $x und ${...} auflösen) */
  strParts(tok) {
    const v = tok.v;
    if (!this.kt || v[0] !== '"' || !v.includes('$')) return [{ lit: litContent(v) }];
    const inner = v.slice(1, v.endsWith('"') && v.length > 1 ? -1 : undefined);
    const parts = [];
    let lit = '';
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '\\') { if (inner[i + 1] === '$') { lit += '$'; i++; } else { lit += ch + (inner[i + 1] || ''); i++; } continue; }
      if (ch === '$' && inner[i + 1] === '{') {
        let depth = 0, j = i + 2;
        for (; j < inner.length; j++) { if (inner[j] === '{') depth++; else if (inner[j] === '}') { if (depth === 0) break; depth--; } }
        if (lit) { parts.push({ lit }); lit = ''; }
        parts.push({ expr: this.expr(mergeTokens(tokenize(inner.slice(i + 2, j), 'c'), false)) });
        i = j;
        continue;
      }
      const m = ch === '$' ? /^[\p{L}_][\p{L}\p{N}_]*/u.exec(inner.slice(i + 1)) : null;
      if (m) {
        if (lit) { parts.push({ lit }); lit = ''; }
        parts.push({ expr: m[0] });
        i += m[0].length;
        continue;
      }
      lit += ch;
    }
    if (lit) parts.push({ lit });
    return parts;
  }

  /** Eingabe-Ausdrücke: readln(), readLine()!!.toInt(), sc.nextInt() … */
  inputInfo(toks) {
    if (!toks.length) return null;
    const s = toks.map((x) => x.v).join('');
    const m = /^\(?(readln|readLine|readlnOrNull)\(\)\)?(!!)?(\.trim\(\))?(?:[.?]+(toInt|toLong|toDouble|toFloat|toBoolean|toIntOrNull|toDoubleOrNull|toLongOrNull)\(\))?(!!|\?:.*)?$/.exec(s);
    if (m) {
      const conv = m[4] || '';
      return { type: /Int|Long/.test(conv) ? 'int' : /Double|Float/.test(conv) ? 'double' : /Boolean/.test(conv) ? 'boolean' : 'string' };
    }
    const sc = /^(\w+)\.(nextInt|nextDouble|nextLine|next|nextBoolean|nextLong|nextFloat)\(\)$/.exec(s);
    if (sc && this.scannerVars.has(sc[1])) return { type: { nextInt: 'int', nextLong: 'int', nextDouble: 'double', nextFloat: 'double', nextBoolean: 'boolean' }[sc[2]] || 'string' };
    const wrap = /^(Integer\.parseInt|Integer\.valueOf|Double\.parseDouble|Double\.valueOf)\((readln|readLine)\(\)(!!)?\)$/.exec(s);
    if (wrap) return { type: /Integer/.test(wrap[1]) ? 'int' : 'double' };
    return null;
  }

  declaration(toks) {
    let i = 0, isConst = false;
    while (toks[i] && (KT_MODIFIERS.has(toks[i].v) || toks[i].v === 'pub') && toks[i + 1] && ['val', 'var', 'const', 'static', 'lateinit'].includes(toks[i + 1].v)) { if (toks[i].v === 'const') isConst = true; i++; }
    const kw = toks[i] && toks[i].v;
    if (kw === 'const') isConst = true;
    i++;
    if (toks[i] && toks[i].v === 'mut') i++;
    const eq = findTop(toks, (x) => x.v === '=', i);
    const head = toks.slice(i, eq < 0 ? toks.length : eq);
    const rhs = eq < 0 ? [] : toks.slice(eq + 1);
    const colon = findTop(head, (x) => x.v === ':');
    let nameToks = colon < 0 ? head : head.slice(0, colon);
    const type = colon < 0 ? null : this.pseudoType(head.slice(colon + 1));
    if (isWrapped(nameToks)) {
      const names = splitTop(nameToks.slice(1, -1), ',').map((p) => joinTokens(p.filter((x) => x.v !== 'mut'))).filter(Boolean);
      if (!rhs.length) return [];
      let r = rhs;
      if (isWrapped(r)) r = r.slice(1, -1);
      const vals = splitTop(r, ',');
      if (vals.length === names.length) return [mk.instruction(`${names.join(', ')} <- ${vals.map((v) => this.expr(v)).join(', ')}`)];
      return [mk.instruction(`${names.join(', ')} <- ${this.expr(rhs)}`)];
    }
    nameToks = nameToks.filter((x) => x.v !== 'mut');
    const name = joinTokens(nameToks);
    if (!rhs.length) return type ? [mk.instruction(`var ${name}: ${type}`)] : [];
    // Scanner(System.`in`)
    if (rhs[0] && rhs[0].v === 'Scanner') { this.scannerVars.add(name); return []; }
    return this.assignLike(type, name, rhs, isConst);
  }

  assignLike(type, target, rhs, isConst) {
    const inp = this.inputInfo(rhs);
    if (inp) {
      const lines = [];
      const t = type || (inp.type !== 'string' ? inp.type : null);
      if (t) lines.push(`var ${target}: ${t}`);
      lines.push(inputLine(null, [target]));
      return [mk.instruction(lines)];
    }
    const v0 = rhs[0] && rhs[0].v;
    if (['if', 'when', 'match'].includes(v0)) {
      const out = [];
      if (type) out.push(mk.instruction(`var ${target}: ${type}`));
      out.push(...this.valueStatement(rhs, (e, isCall) => (isCall ? mk.call(`${target} <- ${e}`) : mk.instruction(`${target} <- ${e}`))));
      return out;
    }
    const r = this.expr(rhs, type);
    const call = this.callInfo(rhs);
    const line = isConst ? `const ${target}${type ? ': ' + type : ''} <- ${r}` : (type ? `var ${target}: ${type} <- ${r}` : `${target} <- ${r}`);
    return [call && this.userFuncs.has(call.name) && !call.callee.includes('.') ? mk.call(line) : mk.instruction(line)];
  }

  assignment(lhs, op, rhs) {
    const target = this.expr(lhs);
    if (op === '=') return this.assignLike(null, target, rhs, false);
    const o = op.slice(0, -1);
    const r = this.expr(rhs);
    const paren = rhs.length > 1 && o !== '+';
    return [mk.instruction(`${target} <- ${target} ${o} ${paren ? '(' + r + ')' : r}`)];
  }

  /* ------------------------------------------------------------ */
  /* Rust: Eingabepuffer zusammenfassen                            */
  /* ------------------------------------------------------------ */
  /** INPUT s + n <- int(s)  ->  INPUT n */
  mergeInput(seq) {
    for (const el of seq) for (const s of sequencesOf(el)) this.mergeInput(s.seq);
    for (let i = 0; i < seq.length - 1; i++) {
      const el = seq[i];
      if (el.type !== 'instruction' || el.text.length !== 1) continue;
      const m = /^INPUT\s+([\p{L}_][\p{L}\p{N}_]*)$/u.exec(el.text[0]);
      if (!m || !this.inputBufs.has(m[1])) continue;
      const buf = m[1];
      const nx = seq[i + 1];
      if (!['instruction', 'call'].includes(nx.type) || nx.text.length !== 1) continue;
      const c = P.classifyLine(nx.text[0]);
      let target, type, init;
      if (c.kind === 'decl' && c.decls.length === 1) { target = c.decls[0].name; type = c.type; init = c.decls[0].init; }
      else if (c.kind === 'assign') { target = c.target; init = c.expr; }
      else continue;
      const im = new RegExp(`^(?:(int|float)\\(\\s*${buf}\\s*\\)|${buf})$`).exec(String(init || '').trim());
      if (!im) continue;
      const t = type || (im[1] === 'int' ? 'int' : im[1] === 'float' ? 'double' : null);
      const lines = [];
      if (c.kind === 'decl' && t) lines.push(`var ${target}: ${t}`);
      else if (c.kind === 'assign' && t && !/[[.]/.test(target)) lines.push(`var ${target}: ${t}`);
      lines.push(`INPUT ${target}`);
      seq[i] = { ...mk.instruction(lines), ...(el.comment ? { comment: el.comment } : {}) };
      seq.splice(i + 1, 1);
    }
  }

  /** "s <- ''" entfernen, wenn der Eingabepuffer nicht mehr benutzt wird */
  dropUnusedBuffers(root) {
    for (const buf of this.inputBufs) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}_"])${buf}(?![\\p{L}\\p{N}_])`, 'u');
      let uses = 0, declSeq = null, declIdx = -1;
      const visit = (seq) => {
        seq.forEach((el, k) => {
          for (const l of el.text || []) if (re.test(l)) {
            uses++;
            if (/^(var\s+)?\S+(\s*:\s*\w+)?\s*<-\s*""$/.test(l.trim()) && l.trim().replace(/^var\s+/, '').startsWith(buf)) { declSeq = seq; declIdx = k; }
          }
          for (const s of sequencesOf(el)) visit(s.seq);
        });
      };
      visit(root.children);
      if (uses === 1 && declSeq) declSeq.splice(declIdx, 1);
    }
  }

  /* ------------------------------------------------------------ */
  /* Ausdrücke                                                    */
  /* ------------------------------------------------------------ */
  /**
   * Kotlin-/Rust-Ausdruck -> Pseudocode
   * @param {any[]} toks
   * @param {string|null} hint erwarteter Typ (für parse())
   */
  expr(toks, hint) {
    const out = [];
    let forceWs = false;
    const prevEnds = () => out.length && canEnd(out[out.length - 1]);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      let nt = { ...t };
      if (forceWs) { nt.ws = true; forceWs = false; }
      if (t.t === 'op') {
        if (t.v === '==' || t.v === '===') nt.v = '=';
        else if (t.v === '!=' || t.v === '!==') nt.v = '<>';
        else if (t.v === '&&') { nt = { ...nt, t: 'id', v: 'and', ws: true }; forceWs = true; }
        else if (t.v === '||') { nt = { ...nt, t: 'id', v: 'or', ws: true }; forceWs = true; }
        else if (t.v === '!') { nt = { ...nt, t: 'id', v: 'not' }; forceWs = true; }
        else if (t.v === '!!') continue;
        else if (t.v === '?' && this.rs && prevEnds()) continue;
        else if ((t.v === '&' || t.v === '*') && this.rs && !prevEnds()) {
          if (toks[i + 1] && toks[i + 1].v === 'mut') i++;
          forceWs = t.ws;
          continue;
        } else if (t.v === '?:') { nt.v = '?:'; }
        else if ((t.v === '.' || t.v === '?.') && toks[i + 1] && toks[i + 1].t === 'id') {
          const r = this.postfix(out, toks, i, hint);
          if (r >= 0) { i = r; continue; }
          nt.v = '.';
        } else if (t.v === '::' && toks[i + 1] && toks[i + 1].t === 'id') {
          // Rust-Pfade: String::from(x), String::new(), std::f64::consts::PI
          const prev = out[out.length - 1];
          const nx = toks[i + 1].v;
          if (prev && prev.t === 'id') {
            if (prev.v === 'String' && (nx === 'from' || nx === 'new') && toks[i + 2] && toks[i + 2].v === '(') {
              const c = closeOf(toks, i + 2);
              const inner = toks.slice(i + 3, c);
              out[out.length - 1] = { ...prev, v: nx === 'new' || !inner.length ? '""' : this.expr(inner), t: nx === 'new' ? 'str' : 'id' };
              i = c;
              continue;
            }
            if ((prev.v === 'Vec' || prev.v === 'VecDeque') && nx === 'new' && toks[i + 2] && toks[i + 2].v === '(') {
              out[out.length - 1] = { ...prev, v: '{}' }; i = closeOf(toks, i + 2); continue;
            }
            if (/^(std|core|f64|f32|consts|io|process|cmp|i32|i64|u32|usize)$/.test(prev.v) && !(nx === 'MAX' || nx === 'MIN')) { out.pop(); forceWs = prev.ws; continue; }
          }
          nt.v = '.';
        }
        out.push(nt);
        continue;
      }
      if (t.t === 'num') {
        const hex = /^0[xXbB]/.test(t.v);
        nt.v = t.v.replace(/_/g, '');
        if (!hex) nt.v = nt.v.replace(/(?:[iu](?:8|16|32|64|128|size)|f32|f64|[lLfFuU]+)$/, '');
        out.push(nt);
        continue;
      }
      if (t.t === 'str') {
        if (this.kt && t.v[0] === '"' && t.v.includes('$')) {
          const parts = this.strParts(t);
          if (parts.some((p) => p.expr)) { out.push({ ...nt, t: 'id', v: this.partsExpr(parts) }); continue; }
          nt.v = '"' + parts.map((p) => p.lit).join('') + '"';
        }
        out.push(nt);
        continue;
      }
      if (t.t === 'id') {
        const nx = toks[i + 1];
        // Makros und Array-Erzeugung
        if (t.v === 'vec!' && nx && (nx.v === '[' || nx.v === '(')) {
          const c = closeOf(toks, i + 1);
          const inner = toks.slice(i + 2, c);
          const semi = findTop(inner, (x) => x.v === ';');
          if (semi >= 0) {
            const val = this.expr(inner.slice(0, semi));
            const el = P.inferType(val) || 'int';
            out.push({ ...nt, v: `new ${el}[${this.expr(inner.slice(semi + 1))}]` });
          } else out.push({ ...nt, v: '{' + splitTop(inner, ',').filter((p) => p.length).map((p) => this.expr(p)).join(', ') + '}' });
          i = c;
          continue;
        }
        if (t.v === 'format!' && nx && nx.v === '(') {
          const c = closeOf(toks, i + 1);
          out.push({ ...nt, v: this.partsExpr(this.fmtParts(splitTop(toks.slice(i + 2, c), ','))) });
          i = c;
          continue;
        }
        if (ARRAY_BUILDERS.has(t.v) && nx && (nx.v === '(' || nx.v === '<')) {
          let o = i + 1;
          if (toks[o].v === '<') { while (toks[o] && toks[o].v !== '(') o++; }
          const c = closeOf(toks, o);
          if (c > 0) {
            out.push({ ...nt, v: '{' + splitTop(toks.slice(o + 1, c), ',').filter((p) => p.length).map((p) => this.expr(p)).join(', ') + '}' });
            i = c;
            continue;
          }
        }
        if ((KT_ARRAYS[t.v] || t.v === 'Array' || t.v === 'arrayOfNulls') && nx && nx.v === '(') {
          const c = closeOf(toks, i + 1);
          const size = this.expr(toks.slice(i + 2, c));
          let el = KT_ARRAYS[t.v] ? KT_ARRAYS[t.v].slice(0, -2) : 'int';
          let j = c;
          if (toks[c + 1] && toks[c + 1].v === '{') { const c2 = closeOf(toks, c + 1); const init = this.expr(toks.slice(c + 2, c2)); el = P.inferType(init) || el; j = c2; }
          out.push({ ...nt, v: `new ${el}[${size}]` });
          i = j;
          continue;
        }
        if ((t.v === 'Math' || t.v === 'kotlin') && nx && nx.v === '.' && toks[i + 2] && toks[i + 2].t === 'id') {
          // Math.sqrt -> sqrt, Math.PI bleibt
          if (toks[i + 3] && toks[i + 3].v === '(') { forceWs = t.ws; i++; continue; }
        }
        if ((t.v === 'this' || t.v === 'self') && nx && nx.v === '.') { i++; forceWs = t.ws; continue; }
        if (t.v === 'as' && toks[i + 1] && toks[i + 1].t === 'id') {
          // Rust/Kotlin-Cast: x as f64 -> float(x)
          let j = i + 1;
          const tt = this.pseudoType([toks[j]]);
          if (toks[j + 1] && toks[j + 1].v === '?') j++;
          const fn = tt === 'int' ? 'int' : tt === 'double' ? 'float' : null;
          if (fn) this.wrapPrev(out, fn);
          i = j;
          continue;
        }
        if (t.v === 'Some' && nx && nx.v === '(') { forceWs = t.ws; continue; }
        if (t.v === 'None') { out.push({ ...nt, v: 'null' }); continue; }
      }
      out.push(nt);
    }
    return joinTokens(out);
  }

  /** Ab toks[i] ("." oder "?.") folgt Methode/Eigenschaft – ggf. in Funktionsform umsetzen. Rückgabe: letzter verbrauchter Index oder -1 */
  postfix(out, toks, i, hint) {
    const name = toks[i + 1].v;
    let k = i + 2;
    // Turbofish ::<T>
    let turbo = null;
    if (toks[k] && toks[k].v === '::' && toks[k + 1] && toks[k + 1].v === '<') {
      const s = k + 2;
      let d = 1, j = s;
      for (; j < toks.length; j++) { if (toks[j].v === '<') d++; else if (toks[j].v === '>') { d--; if (d === 0) break; } }
      turbo = this.pseudoType(toks.slice(s, j));
      k = j + 1;
    }
    const isCall = toks[k] && toks[k].v === '(';
    const close = isCall ? closeOf(toks, k) : k - 1;
    const args = isCall ? splitTop(toks.slice(k + 1, close), ',').filter((p) => p.length) : [];
    if (!out.length) return -1;
    if (isCall && DROP_METHODS.has(name) && !args.length) return close;
    if (isCall && (name === 'expect' || name === 'unwrap_or_default')) return close;
    if (isCall && name === 'unwrap_or' && args.length === 1) return close;
    if (isCall && name === 'parse') {
      const t = turbo || P.normType(hint) || 'int';
      this.wrapPrev(out, t === 'double' ? 'float' : t === 'int' ? 'int' : 'str');
      return close;
    }
    if (isCall && KT_CONV[name] && !args.length) {
      const fn = KT_CONV[name];
      const s = this.operandStart(out);
      const opnd = out.slice(s);
      if (fn === 'str' && opnd.length === 1 && opnd[0].t === 'str') return close;
      this.wrapPrev(out, fn);
      return close;
    }
    if (isCall && (name === 'to_string' || name === 'into') && !args.length) {
      const s = this.operandStart(out);
      if (!(out.length - s === 1 && out[s].t === 'str')) this.wrapPrev(out, 'str');
      return close;
    }
    if (isCall && (name === 'len' || name === 'count') && !args.length) { this.wrapPrev(out, 'length'); return close; }
    if (!isCall && this.kt && (name === 'length' || name === 'size')) { this.wrapPrev(out, 'length'); return i + 1; }
    if (!isCall && this.kt && name === 'lastIndex') { this.wrapPrev(out, 'length'); out.push({ t: 'op', v: '-', ws: true }, { t: 'num', v: '1', ws: true }); return i + 1; }
    if (isCall && MATH_METHODS[name] && !args.length) { this.wrapPrev(out, MATH_METHODS[name]); return close; }
    if (!isCall && name === 'absoluteValue') { this.wrapPrev(out, 'abs'); return i + 1; }
    if (isCall && ['pow', 'powi', 'powf'].includes(name) && args.length === 1) { this.wrapPrev(out, 'pow', this.expr(args[0])); return close; }
    if (isCall && (name === 'max' || name === 'min') && args.length === 1 && this.rs) { this.wrapPrev(out, name, this.expr(args[0])); return close; }
    return -1;
  }

  /** Beginn des letzten Operanden in out (inkl. Aufruf-/Index-/Member-Kette) */
  operandStart(out) {
    let k = out.length - 1;
    for (;;) {
      if (k < 0) return 0;
      const t = out[k];
      let start;
      if (t.t === 'op' && (t.v === ')' || t.v === ']')) {
        const open = this.openOf(out.slice(0, k + 1), k);
        start = Math.max(open, 0);
        if (start > 0 && out[start - 1].t === 'id' && !['and', 'or', 'not', 'in', 'return'].includes(out[start - 1].v)) start--;
      } else if (t.t === 'id' || t.t === 'num' || t.t === 'str') start = k;
      else return k + 1;
      if (start > 1 && out[start - 1].t === 'op' && out[start - 1].v === '.') { k = start - 2; continue; }
      return start;
    }
  }

  wrapPrev(out, fn, extra) {
    const s = this.operandStart(out);
    let opnd = out.slice(s);
    if (isWrapped(opnd)) opnd = opnd.slice(1, -1);
    const txt = joinTokens(opnd);
    const ws = out[s] ? out[s].ws : false;
    out.splice(s);
    out.push({ t: 'id', v: `${fn}(${txt}${extra != null ? ', ' + extra : ''})`, ws });
  }
}

function parseKotlin(src, opts) { return new ModernParser(src, 'kotlin', opts).parse(); }
function parseRust(src, opts) { return new ModernParser(src, 'rust', opts).parse(); }

module.exports = { parseKotlin, parseRust, ModernParser };
