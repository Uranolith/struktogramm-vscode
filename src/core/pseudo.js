'use strict';
/**
 * Der neutrale Struktogramm-Pseudocode (Structorizer-Stil):
 *   Zuweisung   x <- 5   (auch :=)
 *   Vergleich   =  <>  <  >  <=  >=      Logik: and or not
 *   Ein/Ausgabe INPUT "Text", x      OUTPUT "Summe: ", s
 *   Schleifen   for i <- 1 to 10 by 2 | foreach x in liste | while x > 0 | until x = 0
 *   Sprünge     return x | leave | exit 0 | throw e
 *   Deklaration int x <- 5 | var x: int | const PI <- 3.14
 */
const { tokenize, joinTokens, splitTop, findTop, isWrapped, matchClose, tok, OPEN, CLOSE } = require('./tokenizer');

const INPUT_KW = ['input', 'eingabe', 'read', 'readln', 'lies', 'lese', 'einlesen'];
const OUTPUT_KW = ['output', 'ausgabe', 'print', 'write', 'writeln', 'schreibe', 'drucke'];
const REL_OPS = new Set(['=', '==', '===', '<>', '!=', '!==', '<', '>', '<=', '>=']);
const TYPE_WORDS = new Set(['int', 'integer', 'long', 'short', 'byte', 'double', 'float', 'real', 'number', 'char',
  'boolean', 'bool', 'string', 'str', 'void', 'unsigned', 'signed', 'longint', 'single', 'decimal', 'auto']);
const ASSIGN_OPS = new Set(['+=', '-=', '*=', '/=', '%=']);
const IDENT_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function ptoks(text) { return tokenize(String(text || ''), 'pseudo'); }
const lc = (t) => (t && t.t === 'id' ? t.v.toLowerCase() : null);

/** Liegt in toks[i..] ein Typ (int, String, List<Integer>, int[], char*)? Rückgabe: Endindex oder -1 */
function typeEnd(toks, i, strict) {
  const t = toks[i];
  if (!t || t.t !== 'id') return -1;
  let j = i + 1;
  while (toks[j] && (toks[j].v === '.' || toks[j].v === '::') && toks[j + 1] && toks[j + 1].t === 'id') j += 2;
  while (toks[j] && toks[j].t === 'id' && TYPE_WORDS.has(toks[j - 1].v) && TYPE_WORDS.has(toks[j].v)) j++;
  let generic = false, array = false;
  if (toks[j] && toks[j].v === '<') {
    let depth = 0;
    for (; j < toks.length; j++) {
      const v = toks[j].v;
      if (v === '<') depth++;
      else if (v === '>') depth--;
      else if (v === '>>') depth -= 2;
      else if (v === '>>>') depth -= 3;
      else if (v === ';' || v === '=' || v === '<-' || v === '(' || v === '{') return -1;
      if (depth <= 0) { j++; break; }
    }
    if (depth > 0) return -1;
    generic = true;
  }
  while (toks[j] && toks[j].v === '[' && toks[j + 1] && toks[j + 1].v === ']') { j += 2; array = true; }
  while (toks[j] && (toks[j].v === '*' || toks[j].v === '&' || toks[j].v === '?')) { j++; array = true; }
  if (strict) {
    const known = TYPE_WORDS.has(t.v.toLowerCase()) || /^[A-Z]/.test(t.v) || generic || array;
    if (!known) return -1;
  }
  return j;
}

/**
 * Eine Zeile Pseudocode klassifizieren.
 * @returns {{kind:string, [k:string]:any}}
 */
/** Enthält der Text eine Zuweisung (:= oder <-)? In Bedingungen verboten – dort vergleicht man mit = */
function hasAssignOp(text) {
  try { return ptoks(String(text == null ? '' : text)).some((t) => t.t === 'op' && (t.v === ':=' || t.v === '<-')); } catch (e) { return false; }
}

function classifyLine(line) {
  const s = String(line || '').trim();
  if (!s) return { kind: 'empty' };
  let toks = ptoks(s);
  while (toks.length && toks[toks.length - 1].v === ';') toks.pop();
  if (!toks.length) return { kind: 'empty' };
  const first = lc(toks[0]);

  if (first && (INPUT_KW.includes(first) || OUTPUT_KW.includes(first))) {
    let rest = toks.slice(1);
    if (rest[0] && rest[0].v === ':') rest = rest.slice(1);
    const isCall = rest.length && isWrapped(rest);
    // "print(x)" nur als Ausgabe werten, wenn das Wort kein Bezeichner-Teil ist (z.B. print.x)
    if (!(rest[0] && (rest[0].v === '.' || rest[0].v === '=' || rest[0].v === '<-'))) {
      if (isCall) rest = rest.slice(1, -1);
      if (INPUT_KW.includes(first)) {
        let prompt = null;
        if (rest[0] && rest[0].t === 'str') { prompt = rest[0].v; rest = rest.slice(1); if (rest[0] && rest[0].v === ',') rest = rest.slice(1); }
        const vars = rest.length ? splitTop(rest, ',').map(joinTokens).filter(Boolean) : [];
        return { kind: 'input', prompt, vars };
      }
      const items = rest.length ? splitTop(rest, ',').map(joinTokens).filter(Boolean) : [];
      return { kind: 'output', items };
    }
  }
  if (first === 'return' || first === 'zurück' || first === 'rückgabe') return { kind: 'return', expr: joinTokens(toks.slice(1)) };
  if (first === 'exit' || first === 'halt' || first === 'ende') {
    let rest = toks.slice(1);
    if (isWrapped(rest)) rest = rest.slice(1, -1);
    return { kind: 'exit', expr: joinTokens(rest) };
  }
  if ((first === 'leave' || first === 'break' || first === 'verlassen') && toks.length <= 2) {
    // "leave 2" verlässt zwei geschachtelte Schleifen (Structorizer)
    const n = toks[1] && toks[1].t === 'num' ? parseInt(toks[1].v, 10) : 1;
    return { kind: 'leave', count: n > 0 ? n : 1 };
  }
  // Typdefinition: type Punkt = record{x: int; y: int}  |  type Farbe = enum{ROT, GRUEN}
  if (first === 'type' && toks[1] && toks[1].t === 'id' && toks[2] && toks[2].v === '=') {
    const kindTok = lc(toks[3]);
    const open = toks.findIndex((t, k) => k > 2 && t.v === '{');
    const close = open >= 0 ? matchClose(toks, open) : -1;
    const inner = open >= 0 ? toks.slice(open + 1, close < 0 ? toks.length : close) : [];
    if (kindTok === 'enum') {
      const items = splitTop(inner, ',').filter((p) => p.length).map((p) => {
        const eq = findTop(p, (t) => t.v === '=');
        return { name: joinTokens(eq >= 0 ? p.slice(0, eq) : p), value: eq >= 0 ? joinTokens(p.slice(eq + 1)) : null };
      });
      return { kind: 'typedef', name: toks[1].v, typeKind: 'enum', items };
    }
    const fields = [];
    for (const part of splitTop(inner, (t) => t.v === ';' || t.v === ',')) {
      if (!part.length) continue;
      const colon = findTop(part, (t) => t.v === ':' || lc(t) === 'as');
      if (colon > 0) { for (const n of splitTop(part.slice(0, colon), ',')) fields.push({ name: joinTokens(n), type: joinTokens(part.slice(colon + 1)) }); }
      else if (part.length >= 2) fields.push({ name: part[part.length - 1].v, type: joinTokens(part.slice(0, -1)) }); // C-Stil: int x
      else fields.push({ name: part[0].v, type: null });
    }
    return { kind: 'typedef', name: toks[1].v, typeKind: 'record', fields };
  }
  if (first === 'continue' && toks.length === 1) return { kind: 'continue' };
  if (first === 'throw' || first === 'raise') return { kind: 'throw', expr: joinTokens(toks.slice(1)) };

  // Deklarationen
  const decl = parseDecl(toks);
  if (decl) return decl;

  // Zuweisungen: nur := und <- (= ist im Struktogramm immer der Vergleich – x = 5 ist keine Zuweisung)
  let k = findTop(toks, (t) => t.v === '<-' || t.v === ':=');
  if (k > 0) {
    return { kind: 'assign', target: joinTokens(toks.slice(0, k)), expr: joinTokens(toks.slice(k + 1)) };
  }
  k = findTop(toks, (t) => ASSIGN_OPS.has(t.v));
  if (k > 0 && isLvalue(toks.slice(0, k))) {
    const target = joinTokens(toks.slice(0, k));
    const rhs = toks.slice(k + 1);
    const op = toks[k].v[0];
    const rtxt = joinTokens(rhs);
    const needParen = rhs.length > 1 && op !== '+';
    return { kind: 'assign', target, expr: `${target} ${op === '%' ? 'mod' : op} ${needParen ? '(' + rtxt + ')' : rtxt}` };
  }
  if (toks.length === 2 && (toks[1].v === '++' || toks[1].v === '--') && toks[0].t === 'id') {
    return { kind: 'assign', target: toks[0].v, expr: `${toks[0].v} ${toks[1].v[0]} 1` };
  }
  if (toks.length === 2 && (toks[0].v === '++' || toks[0].v === '--') && toks[1].t === 'id') {
    return { kind: 'assign', target: toks[1].v, expr: `${toks[1].v} ${toks[0].v[0]} 1` };
  }
  return { kind: 'expr', expr: joinTokens(toks) };
}

function isLvalue(toks) {
  if (!toks.length) return false;
  // Tupel a, b
  const parts = splitTop(toks, ',');
  return parts.every((p) => {
    if (!p.length || p[0].t !== 'id') return false;
    let i = 1;
    while (i < p.length) {
      if (p[i].v === '.' && p[i + 1] && p[i + 1].t === 'id') i += 2;
      else if (p[i].v === '[') { const c = matchClose(p, i); if (c < 0) return false; i = c + 1; }
      else return false;
    }
    return true;
  });
}

function parseDecl(toks) {
  let i = 0, isConst = false;
  const f = lc(toks[0]);
  if (f === 'var' || f === 'dim' || f === 'let' || f === 'const' || f === 'konst') {
    isConst = f === 'const' || f === 'konst';
    i = 1;
    if (!toks[i] || toks[i].t !== 'id') return null;
    // var x: int <- 5 | dim x as int | const x <- 5 | var x, y: int
    const assignIdx = findTop(toks, (t) => t.v === '<-' || t.v === ':=', i);
    // var x: int = 5 ist keine gültige Deklaration (= ist der Vergleich)
    if (assignIdx < 0 && findTop(toks, (t) => t.v === '=', i) >= 0) return null;
    const head = assignIdx < 0 ? toks.slice(i) : toks.slice(i, assignIdx);
    const init = assignIdx < 0 ? null : joinTokens(toks.slice(assignIdx + 1));
    let type = null, namesToks = head;
    const colon = findTop(head, (t) => t.v === ':' || lc(t) === 'as');
    if (colon >= 0) { type = joinTokens(head.slice(colon + 1)); namesToks = head.slice(0, colon); }
    else {
      // const int X <- 5
      const te = typeEnd(head, 0, true);
      if (te > 0 && head[te] && head[te].t === 'id') { type = joinTokens(head.slice(0, te)); namesToks = head.slice(te); }
    }
    const names = splitTop(namesToks, ',').map(joinTokens).filter(Boolean);
    if (!names.length || !names.every((n) => IDENT_RE.test(n))) return null;
    return { kind: 'decl', type, isConst, decls: names.map((name, j) => ({ name, init: j === names.length - 1 ? init : null })) };
  }
  if (f === 'final') { isConst = true; i = 1; }
  const te = typeEnd(toks, i, true);
  if (te < 0 || !toks[te] || toks[te].t !== 'id') return null;
  const after = toks[te + 1];
  if (after && !['<-', ':=', ',', '['].includes(after.v)) return null; // int x = 5: = ist der Vergleich
  const type = joinTokens(toks.slice(i, te));
  if (['return', 'new', 'not', 'and', 'or', 'foreach', 'for', 'while', 'until'].includes(type.toLowerCase())) return null;
  const decls = [];
  for (const part of splitTop(toks.slice(te), ',')) {
    if (!part.length || part[0].t !== 'id') return null;
    let j = 1, suffix = '';
    while (part[j] && part[j].v === '[') { const c = matchClose(part, j); if (c < 0) return null; suffix += joinTokens(part.slice(j, c + 1)); j = c + 1; }
    let init = null;
    if (part[j]) {
      if (!['<-', ':='].includes(part[j].v)) return null;
      init = joinTokens(part.slice(j + 1));
    }
    decls.push({ name: part[0].v, suffix, init });
  }
  return { kind: 'decl', type: type.toLowerCase() === 'auto' ? null : type, isConst, decls };
}

/* ------------------------------------------------------------------ */
/* Übersetzung Pseudocode -> Zielsprache                               */
/* ------------------------------------------------------------------ */

const MATH_FUNCS = {
  sqrt: { java: 'Math.sqrt', csharp: 'Math.Sqrt', javascript: 'Math.sqrt', python: 'math.sqrt', c: 'sqrt', cpp: 'sqrt' },
  abs: { java: 'Math.abs', csharp: 'Math.Abs', javascript: 'Math.abs', python: 'abs', c: 'abs', cpp: 'abs' },
  pow: { java: 'Math.pow', csharp: 'Math.Pow', javascript: 'Math.pow', python: 'math.pow', c: 'pow', cpp: 'pow' },
  floor: { java: 'Math.floor', csharp: 'Math.Floor', javascript: 'Math.floor', python: 'math.floor', c: 'floor', cpp: 'floor' },
  ceil: { java: 'Math.ceil', csharp: 'Math.Ceiling', javascript: 'Math.ceil', python: 'math.ceil', c: 'ceil', cpp: 'ceil' },
};
const CFAM = new Set(['java', 'c', 'cpp', 'csharp', 'javascript', 'typescript', 'kotlin', 'rust']);
const MODERN = new Set(['kotlin', 'rust']);
const MODERN_FN = new Set(['sqrt', 'pow', 'floor', 'ceil', 'abs', 'round', 'random', 'int', 'trunc', 'float', 'str', 'length', 'len',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'toradians', 'todegrees']);
const SIMPLE_CHAIN = /^[\p{L}_][\p{L}\p{N}_.]*(\[[^\]]*\]|\([^()]*\))?$/u;

/**
 * Kotlin/Rust: eingebaute Funktionen mit Typumwandlung (beide Sprachen wandeln Int nicht automatisch in Double).
 * args: [{src: Pseudocode, out: übersetzt}]
 */
function modernFn(l, args, lang, ctx) {
  const kt = lang === 'kotlin';
  const a = args[0] || { src: '', out: '' };
  const typeOf = (arg) => (ctx.exprType ? normType(ctx.exprType(arg.src)) : inferType(arg.src));
  const wrap = (s) => (SIMPLE_CHAIN.test(s) ? s : `(${s})`);
  const dbl = (arg) => {
    const s = arg.out;
    if (/^-?\d+$/.test(s)) return kt ? s + '.0' : `${s}.0_f64`;
    if (/^-?\d+\.\d+$/.test(s)) return kt ? s : `${s}_f64`;
    if (typeOf(arg) === 'double') return kt ? s : wrap(s);
    return kt ? `${wrap(s)}.toDouble()` : `(${wrap(s)} as f64)`;
  };
  const TRIG = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log'];
  if (TRIG.includes(l)) return kt ? `Math.${l}(${dbl(a)})` : `${dbl(a)}.${l === 'log' ? 'ln' : l}()`;
  if (l === 'toradians' || l === 'todegrees') return kt ? `Math.${l === 'toradians' ? 'toRadians' : 'toDegrees'}(${dbl(a)})` : `${dbl(a)}.${l === 'toradians' ? 'to_radians' : 'to_degrees'}()`;
  if (l === 'random' && args.length) {
    if (kt) return `(Math.random() * ${wrap(a.out)}).toInt()`;
    if (ctx.needs) ctx.needs.add('random');
    return `((random() * ${wrap(a.out)} as f64) as i32)`;
  }
  if (kt) {
    switch (l) {
      case 'sqrt': case 'floor': case 'ceil': return `Math.${l}(${dbl(a)})`;
      case 'pow': return `Math.pow(${dbl(a)}, ${dbl(args[1] || a)})`;
      case 'abs': return `Math.abs(${a.out})`;
      case 'round': return `Math.round(${dbl(a)}).toInt()`;
      case 'random': return 'Math.random()';
      case 'int': case 'trunc': return `${wrap(a.out)}.toInt()`;
      case 'float': return `${wrap(a.out)}.toDouble()`;
      case 'str': return `${wrap(a.out)}.toString()`;
      default: { // length / len
        const t = typeOf(a);
        return `${wrap(a.out)}.${t === 'string' ? 'length' : 'size'}`;
      }
    }
  }
  switch (l) {
    case 'sqrt': case 'floor': case 'ceil': return `${dbl(a)}.${l}()`;
    case 'pow': return `${dbl(a)}.powf(${dbl(args[1] || a)})`;
    case 'abs': return /^-?\d+$/.test(a.out) ? `(${a.out}_i32).abs()` : /^-?\d+\.\d+$/.test(a.out) ? `(${a.out}_f64).abs()` : `${wrap(a.out)}.abs()`;
    case 'round': return `((${dbl(a)} + 0.5).floor() as i32)`;
    case 'random': if (ctx.needs) ctx.needs.add('random'); return 'random()';
    case 'int': case 'trunc': return typeOf(a) === 'string' ? `${wrap(a.out)}.trim().parse::<i32>().unwrap()` : `(${wrap(a.out)} as i32)`;
    case 'float': return typeOf(a) === 'string' ? `${wrap(a.out)}.trim().parse::<f64>().unwrap()` : `(${wrap(a.out)} as f64)`;
    case 'str': return `${wrap(a.out)}.to_string()`;
    default: return `(${wrap(a.out)}.len() as i32)`;
  }
}

/**
 * Kotlin/Rust: ganzzahlige Literale in Ausdrücken mit Kommazahlen als Kommazahl schreiben
 * (d * 2 -> d * 2.0, d == 12 -> d == 12.0). Indizes und Funktionsargumente bleiben unverändert.
 */
function promoteFloats(toks, ctx) {
  const res = toks.map((t) => ({ ...t }));
  const typeOf = (a, b) => {
    if (b <= a) return null;
    const txt = joinTokens(res.slice(a, b));
    try { return normType(ctx.exprType ? ctx.exprType(txt) : inferType(txt)); } catch (e) { return null; }
  };
  const isLogic = (t) => ['and', 'or', 'xor'].includes(lc(t)) || t.v === '&&' || t.v === '||';
  const topIdx = (a, b, pred) => {
    const r = [];
    let depth = 0;
    for (let k = a; k < b; k++) {
      const t = res[k];
      if (t.t === 'op' && OPEN[t.v]) depth++;
      else if (t.t === 'op' && CLOSE[t.v]) depth--;
      else if (depth === 0 && pred(t)) r.push(k);
    }
    return r;
  };
  const promoteRange = (a, b) => {
    for (let k = a; k < b; k++) {
      const t = res[k];
      if (t.t === 'op' && t.v === '(') {
        const c = matchClose(res, k);
        if (c < 0 || c > b) return;
        const isCall = k > a && res[k - 1].t === 'id';
        if (!isCall) promoteRange(k + 1, c);
        k = c;
        continue;
      }
      if (t.t === 'op' && (t.v === '[' || t.v === '{')) { const c = matchClose(res, k); if (c < 0) return; k = c; continue; }
      if (t.t === 'num' && /^\d+$/.test(t.v)) t.v += '.0';
    }
  };
  const visit = (a, b) => {
    const logic = topIdx(a, b, isLogic);
    if (logic.length) {
      let s = a;
      for (const k of logic.concat([b])) { visit(s, k); s = k + 1; }
      return;
    }
    let s = a;
    while (s < b && lc(res[s]) === 'not') s++;
    if (s < b && res[s].v === '(' && matchClose(res, s) === b - 1) { visit(s + 1, b - 1); return; }
    const rel = topIdx(s, b, (t) => REL_OPS.has(t.v));
    if (rel.length === 1) {
      const k = rel[0];
      if (typeOf(s, k) === 'double' || typeOf(k + 1, b) === 'double') { promoteRange(s, k); promoteRange(k + 1, b); }
      return;
    }
    if (!rel.length && typeOf(s, b) === 'double') promoteRange(s, b);
  };
  visit(0, res.length);
  return res;
}

/* ------------------------------------------------------------------ */
/* Structorizer-Funktionen in den Zielsprachen                          */
/* ------------------------------------------------------------------ */
const WRAP_OK = /^[\p{L}_][\p{L}\p{N}_.]*(\([^()]*\)|\[[^\]]*\])?$|^"(?:[^"\\]|\\.)*"$|^'(?:[^'\\]|\\.|'')*'$/u;
const W = (s) => (WRAP_OK.test(s) ? s : `(${s})`);
const PI_OF = { python: 'math.pi', java: 'Math.PI', csharp: 'Math.PI', javascript: 'Math.PI', c: 'M_PI', cpp: 'M_PI' };
/** Rust: &str-Argument */
const rsStr = (x) => (/^"/.test(x.out) ? x.out : `${W(x.out)}.as_str()`);

/**
 * Tabelle: Funktionsname -> { sprache: (args, ctx, lang) => Code }. args: [{src, out}]
 * Kotlin/Rust werden für Mathematik in modernFn behandelt.
 */
const SFN = {
  uppercase: { c: (a, ctx) => { need(ctx, 'strupper'); return `str_upper(${a[0].out})`; }, python: (a) => `${W(a[0].out)}.upper()`, java: (a) => `${W(a[0].out)}.toUpperCase()`, csharp: (a) => `${W(a[0].out)}.ToUpper()`, javascript: (a) => `${W(a[0].out)}.toUpperCase()`, kotlin: (a) => `${W(a[0].out)}.uppercase()`, rust: (a) => `${W(a[0].out)}.to_uppercase()`, cpp: (a, ctx) => { need(ctx, 'strupper'); return `str_upper(${a[0].out})`; } },
  lowercase: { c: (a, ctx) => { need(ctx, 'strlower'); return `str_lower(${a[0].out})`; }, python: (a) => `${W(a[0].out)}.lower()`, java: (a) => `${W(a[0].out)}.toLowerCase()`, csharp: (a) => `${W(a[0].out)}.ToLower()`, javascript: (a) => `${W(a[0].out)}.toLowerCase()`, kotlin: (a) => `${W(a[0].out)}.lowercase()`, rust: (a) => `${W(a[0].out)}.to_lowercase()`, cpp: (a, ctx) => { need(ctx, 'strlower'); return `str_lower(${a[0].out})`; } },
  trim: { c: (a, ctx) => { need(ctx, 'strtrim'); return `str_trim(${a[0].out})`; }, python: (a) => `${W(a[0].out)}.strip()`, java: (a) => `${W(a[0].out)}.trim()`, csharp: (a) => `${W(a[0].out)}.Trim()`, javascript: (a) => `${W(a[0].out)}.trim()`, kotlin: (a) => `${W(a[0].out)}.trim()`, rust: (a) => `${W(a[0].out)}.trim().to_string()`, cpp: (a, ctx) => { need(ctx, 'strtrim'); return `str_trim(${a[0].out})`; } },
  pos: { c: (a, ctx) => { need(ctx, 'strpos'); return `str_pos(${a[0].out}, ${a[1].out})`; }, python: (a) => `(${W(a[1].out)}.find(${a[0].out}) + 1)`, java: (a) => `(${W(a[1].out)}.indexOf(${a[0].out}) + 1)`, csharp: (a) => `(${W(a[1].out)}.IndexOf(${a[0].out}) + 1)`, javascript: (a) => `(${W(a[1].out)}.indexOf(${a[0].out}) + 1)`, kotlin: (a) => `(${W(a[1].out)}.indexOf(${a[0].out}) + 1)`, rust: (a) => `${W(a[1].out)}.find(${rsStr(a[0])}).map_or(0, |i| ${W(a[1].out)}[..i].chars().count() as i32 + 1)`, cpp: (a) => `((int) ${W(a[1].out)}.find(${a[0].out}) + 1)` },
  copy: { c: (a, ctx) => { need(ctx, 'strcopy'); return `str_copy(${a[0].out}, ${a[1].out}, ${a[2].out})`; }, python: (a) => `${W(a[0].out)}[${a[1].out} - 1:${a[1].out} - 1 + ${W(a[2].out)}]`, java: (a) => `${W(a[0].out)}.substring(${a[1].out} - 1, Math.min(${W(a[0].out)}.length(), ${a[1].out} - 1 + ${W(a[2].out)}))`, csharp: (a) => `${W(a[0].out)}.Substring(${a[1].out} - 1, Math.Min(${W(a[2].out)}, ${W(a[0].out)}.Length - (${a[1].out} - 1)))`, javascript: (a) => `${W(a[0].out)}.substr(${a[1].out} - 1, ${a[2].out})`, kotlin: (a) => `${W(a[0].out)}.substring(${a[1].out} - 1, minOf(${W(a[0].out)}.length, ${a[1].out} - 1 + ${W(a[2].out)}))`, rust: (a) => `${W(a[0].out)}.chars().skip((${a[1].out} - 1) as usize).take((${a[2].out}) as usize).collect::<String>()`, cpp: (a) => `${W(a[0].out)}.substr(${a[1].out} - 1, ${a[2].out})` },
  insert: { c: (a, ctx) => { need(ctx, 'strinsert'); return `str_insert(${a[0].out}, ${a[1].out}, ${a[2].out})`; }, python: (a) => `${W(a[1].out)}[:${a[2].out} - 1] + ${a[0].out} + ${W(a[1].out)}[${a[2].out} - 1:]`, java: (a) => `${W(a[1].out)}.substring(0, ${a[2].out} - 1) + ${a[0].out} + ${W(a[1].out)}.substring(${a[2].out} - 1)`, csharp: (a) => `${W(a[1].out)}.Insert(${a[2].out} - 1, ${a[0].out})`, javascript: (a) => `${W(a[1].out)}.slice(0, ${a[2].out} - 1) + ${a[0].out} + ${W(a[1].out)}.slice(${a[2].out} - 1)`, kotlin: (a) => `${W(a[1].out)}.substring(0, ${a[2].out} - 1) + ${a[0].out} + ${W(a[1].out)}.substring(${a[2].out} - 1)`, rust: (a) => `{ let mut t = ${W(a[1].out)}.clone(); t.insert_str((${a[2].out} - 1) as usize, ${rsStr(a[0])}); t }`, cpp: (a) => `string(${a[1].out}).insert(${a[2].out} - 1, ${a[0].out})` },
  delete: { c: (a, ctx) => { need(ctx, 'strdelete'); return `str_delete(${a[0].out}, ${a[1].out}, ${a[2].out})`; }, python: (a) => `${W(a[0].out)}[:${a[1].out} - 1] + ${W(a[0].out)}[${a[1].out} - 1 + ${W(a[2].out)}:]`, java: (a) => `${W(a[0].out)}.substring(0, ${a[1].out} - 1) + ${W(a[0].out)}.substring(Math.min(${W(a[0].out)}.length(), ${a[1].out} - 1 + ${W(a[2].out)}))`, csharp: (a) => `${W(a[0].out)}.Remove(${a[1].out} - 1, ${a[2].out})`, javascript: (a) => `${W(a[0].out)}.slice(0, ${a[1].out} - 1) + ${W(a[0].out)}.slice(${a[1].out} - 1 + ${W(a[2].out)})`, kotlin: (a) => `${W(a[0].out)}.removeRange(${a[1].out} - 1, minOf(${W(a[0].out)}.length, ${a[1].out} - 1 + ${W(a[2].out)}))`, rust: (a) => `{ let mut t = ${W(a[0].out)}.clone(); let e = ((${a[1].out} - 1 + ${W(a[2].out)}) as usize).min(t.len()); t.replace_range((${a[1].out} - 1) as usize..e, ""); t }`, cpp: (a) => `string(${a[0].out}).erase(${a[1].out} - 1, ${a[2].out})` },
  ord: { python: (a) => `ord(${a[0].out})`, java: (a, ctx) => (isCharArg(a[0], ctx) ? `(int) ${W(a[0].out)}` : `(int) ${W(a[0].out)}.charAt(0)`), csharp: (a, ctx) => (isCharArg(a[0], ctx) ? `(int) ${W(a[0].out)}` : `(int) ${W(a[0].out)}[0]`), javascript: (a) => `${W(a[0].out)}.charCodeAt(0)`, kotlin: (a, ctx) => (isCharArg(a[0], ctx) ? `${W(a[0].out)}.code` : `${W(a[0].out)}[0].code`), rust: (a, ctx) => (isCharArg(a[0], ctx) ? `(${a[0].out} as i32)` : `(${W(a[0].out)}.chars().next().unwrap() as i32)`), cpp: (a, ctx) => (isCharArg(a[0], ctx) ? `(int) ${W(a[0].out)}` : `(int) ${W(a[0].out)}[0]`), c: (a, ctx) => (isCharArg(a[0], ctx) ? `(int) ${W(a[0].out)}` : `(int) ${W(a[0].out)}[0]`) },
  chr: { python: (a) => `chr(${a[0].out})`, java: (a) => `(char) ${W(a[0].out)}`, csharp: (a) => `(char) ${W(a[0].out)}`, javascript: (a) => `String.fromCharCode(${a[0].out})`, kotlin: (a) => `${W(a[0].out)}.toChar()`, rust: (a) => `char::from_u32((${a[0].out}) as u32).unwrap()`, cpp: (a) => `(char) ${W(a[0].out)}`, c: (a) => `(char) ${W(a[0].out)}` },
  sgn: { python: (a) => `((${a[0].out} > 0) - (${a[0].out} < 0))`, java: (a) => `(int) Math.signum(${a[0].out})`, csharp: (a) => `Math.Sign(${a[0].out})`, javascript: (a) => `Math.sign(${a[0].out})`, kotlin: (a) => `(if (${a[0].out} > 0) 1 else if (${a[0].out} < 0) -1 else 0)`, rust: (a) => `(if ${a[0].out} > 0 { 1 } else if ${a[0].out} < 0 { -1 } else { 0 })`, cpp: (a) => `((${a[0].out} > 0) - (${a[0].out} < 0))`, c: (a) => `((${a[0].out} > 0) - (${a[0].out} < 0))` },
  sqr: { '*': (a) => `${W(a[0].out)} * ${W(a[0].out)}` },
  toradians: { '*': (a, ctx, lang) => { mathNeed(ctx, lang); return `${W(a[0].out)} * ${PI_OF[lang]} / 180`; } },
  todegrees: { '*': (a, ctx, lang) => { mathNeed(ctx, lang); return `${W(a[0].out)} * 180 / ${PI_OF[lang]}`; } },
  min: { python: (a) => `min(${a.map((x) => x.out).join(', ')})`, java: (a) => `Math.min(${a[0].out}, ${a[1].out})`, csharp: (a) => `Math.Min(${a[0].out}, ${a[1].out})`, javascript: (a) => `Math.min(${a.map((x) => x.out).join(', ')})`, kotlin: (a) => `minOf(${a[0].out}, ${a[1].out})`, rust: (a) => `${W(a[0].out)}.min(${a[1].out})`, cpp: (a) => `min(${a[0].out}, ${a[1].out})`, c: (a) => `(${W(a[0].out)} < ${W(a[1].out)} ? ${W(a[0].out)} : ${W(a[1].out)})` },
  max: { python: (a) => `max(${a.map((x) => x.out).join(', ')})`, java: (a) => `Math.max(${a[0].out}, ${a[1].out})`, csharp: (a) => `Math.Max(${a[0].out}, ${a[1].out})`, javascript: (a) => `Math.max(${a.map((x) => x.out).join(', ')})`, kotlin: (a) => `maxOf(${a[0].out}, ${a[1].out})`, rust: (a) => `${W(a[0].out)}.max(${a[1].out})`, cpp: (a) => `max(${a[0].out}, ${a[1].out})`, c: (a) => `(${W(a[0].out)} > ${W(a[1].out)} ? ${W(a[0].out)} : ${W(a[1].out)})` },
  split: { python: (a) => `${W(a[0].out)}.split(${a[1].out})`, java: (a) => `${W(a[0].out)}.split(java.util.regex.Pattern.quote(${a[1].out}))`, csharp: (a) => `${W(a[0].out)}.Split(${a[1].out})`, javascript: (a) => `${W(a[0].out)}.split(${a[1].out})`, kotlin: (a) => `${W(a[0].out)}.split(${a[1].out}).toTypedArray()`, rust: (a) => `${W(a[0].out)}.split(${rsStr(a[1])}).map(String::from).collect::<Vec<String>>()` },
  strcmp: { python: (a) => `((${a[0].out} > ${a[1].out}) - (${a[0].out} < ${a[1].out}))`, java: (a) => `${W(a[0].out)}.compareTo(${a[1].out})`, csharp: (a) => `string.Compare(${a[0].out}, ${a[1].out})`, javascript: (a) => `${W(a[0].out)}.localeCompare(${a[1].out})`, kotlin: (a) => `${W(a[0].out)}.compareTo(${a[1].out})`, rust: (a) => `(${W(a[0].out)}.cmp(&${W(a[1].out)}) as i32)`, cpp: (a) => `${W(a[0].out)}.compare(${a[1].out})`, c: (a, ctx) => { need(ctx, 'string'); return `strcmp(${a[0].out}, ${a[1].out})`; } },
  copyarray: { python: (a) => `list(${a[0].out})`, java: (a) => `${W(a[0].out)}.clone()`, csharp: (a) => `${W(a[0].out)}.ToArray()`, javascript: (a) => `[...${W(a[0].out)}]`, kotlin: (a) => `${W(a[0].out)}.copyOf()`, rust: (a) => `${W(a[0].out)}.clone()`, cpp: (a) => a[0].out },
};
/** Turtleizer -> Python-Modul turtle (Structorizer: 0° = oben, y nach unten) */
const TURTLE_PY = {
  forward: (a) => `turtle.forward(${a[0].out})`, fd: (a) => `turtle.forward(${a[0].out})`,
  backward: (a) => `turtle.backward(${a[0].out})`, bk: (a) => `turtle.backward(${a[0].out})`,
  left: (a) => `turtle.left(${a[0].out})`, rl: (a) => `turtle.left(${a[0].out})`,
  right: (a) => `turtle.right(${a[0].out})`, rr: (a) => `turtle.right(${a[0].out})`,
  gotoxy: (a) => `turtle.goto(${a[0].out}, -${W(a[1].out)})`, gotox: (a) => `turtle.setx(${a[0].out})`, gotoy: (a) => `turtle.sety(-${W(a[0].out)})`,
  penup: () => 'turtle.penup()', up: () => 'turtle.penup()', pendown: () => 'turtle.pendown()', down: () => 'turtle.pendown()',
  hideturtle: () => 'turtle.hideturtle()', showturtle: () => 'turtle.showturtle()',
  setpencolor: (a) => `turtle.pencolor(${a.map((x) => x.out).join(', ')})`, setbackground: (a) => `turtle.bgcolor(${a.map((x) => x.out).join(', ')})`,
  clear: () => 'turtle.clear()', getx: () => 'turtle.xcor()', gety: () => '-turtle.ycor()', getorientation: () => '((turtle.heading() - 90) % 360)',
};
for (const [n, f] of Object.entries(TURTLE_PY)) {
  SFN[n] = { python: (a, ctx) => { need(ctx, 'turtle'); return f(a); } };
}

/** trigonometrische Funktionen / exp / log (für Python, Java, C#, JS, C/C++) */
for (const fn of ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log']) {
  const cs = fn[0].toUpperCase() + fn.slice(1);
  SFN[fn] = {
    python: (a, ctx) => { need(ctx, 'math'); return `math.${fn}(${a[0].out})`; },
    java: (a) => `Math.${fn}(${a[0].out})`, javascript: (a) => `Math.${fn}(${a[0].out})`, csharp: (a) => `Math.${cs}(${a[0].out})`,
    c: (a, ctx) => { need(ctx, 'math'); return `${fn}(${a[0].out})`; }, cpp: (a, ctx) => { need(ctx, 'math'); return `${fn}(${a[0].out})`; },
  };
}
/** random(n): ganze Zufallszahl 0 … n-1 */
const RANDOM_N = {
  python: (a, ctx) => { need(ctx, 'random'); return `random.randrange(${a[0].out})`; },
  java: (a) => `(int) (Math.random() * ${W(a[0].out)})`, csharp: (a) => `new Random().Next(${a[0].out})`,
  javascript: (a) => `Math.floor(Math.random() * ${W(a[0].out)})`, 
  cpp: (a, ctx) => { need(ctx, 'stdlib'); return `rand() % ${W(a[0].out)}`; }, c: (a, ctx) => { need(ctx, 'stdlib'); return `rand() % ${W(a[0].out)}`; },
};
function need(ctx, what) { if (ctx && ctx.needs) ctx.needs.add(what); }
function mathNeed(ctx, lang) { if (lang === 'python' || lang === 'c' || lang === 'cpp') need(ctx, 'math'); }
function isCharArg(arg, ctx) {
  const t = ctx && ctx.exprType ? normType(ctx.exprType(arg.src)) : inferType(arg.src);
  return t === 'char' || (/^'.'$/.test(arg.src.trim()));
}

/** Kotlin/Rust: neues Array "new int[n]" */
function modernNewArray(elType, size, lang) {
  const n = normType(elType);
  if (lang === 'kotlin') {
    const typed = { int: 'IntArray', double: 'DoubleArray', boolean: 'BooleanArray', char: 'CharArray' }[n];
    return typed ? `${typed}(${size})` : `Array(${size}) { ${n === 'string' ? '""' : '0'} }`;
  }
  const def = { int: '0', double: '0.0', boolean: 'false', char: "' '", string: 'String::new()' }[n] || '0';
  return `vec![${def}; ${/^\d+$/.test(size) ? size : `(${size}) as usize`}]`;
}

/**
 * new int[n] (neues Array mit Vorgabewerten wie im Interpreter: 0, 0.0, "", false) für Python, JavaScript, Java und
 * C#. Java und C# füllten ein Text-Array mit null. C und C++ fehlen noch (Array-Länge, siehe docs/CODEGEN-PLAN.md 4.2/4.6).
 */
const NEW_ARRAY = {
  python: (t, n) => `[${{ double: '0.0', string: '""', boolean: 'False', char: '" "' }[t] || '0'}] * ${/^\w+$/.test(n) ? n : `(${n})`}`,
  javascript: (t, n) => `new Array(${n}).fill(${{ string: '""', boolean: 'false', char: '" "' }[t] || '0'})`,
  java: (t, n) => (t === 'string' ? `java.util.Collections.nCopies(${n}, "").toArray(new String[0])` : `new ${{ boolean: 'boolean', double: 'double', char: 'char' }[t] || 'int'}[${n}]`),
  cpp: (t, n) => `vector<${{ boolean: 'bool', double: 'double', char: 'char', string: 'string' }[t] || 'int'}>(${n})`,
  csharp: (t, n) => (t === 'string' ? `System.Linq.Enumerable.Repeat("", ${n}).ToArray()` : `new ${{ boolean: 'bool', double: 'double', char: 'char' }[t] || 'int'}[${n}]`),
};

/** Operand-Ende nach "not" bestimmen (bis and/or/Klammer zu/Komma auf gleicher Ebene) */
function operandEnd(toks, i) {
  let depth = 0;
  for (let k = i; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'op' && OPEN[t.v]) depth++;
    else if (t.t === 'op' && CLOSE[t.v]) { if (depth === 0) return k; depth--; }
    else if (depth === 0) {
      const l = lc(t);
      if (l === 'and' || l === 'or' || l === 'xor' || t.v === '&&' || t.v === '||' || t.v === ',' || t.v === '?' || t.v === ':') return k;
    }
  }
  return toks.length;
}

function isSimpleOperand(toks) {
  if (toks.length <= 1) return true;
  if (isWrapped(toks)) return true;
  // Aufruf / Memberzugriff ohne Operatoren
  let k = 0;
  while (k < toks.length) {
    const t = toks[k];
    if (t.t === 'op' && (t.v === '(' || t.v === '[')) { k = matchClose(toks, k) + 1; if (k <= 0) return false; continue; }
    if (t.t === 'op' && t.v !== '.') return false;
    k++;
  }
  return true;
}

function requote(strTok, quote) {
  const v = strTok.v;
  const q = v[0];
  if (q !== '"' && q !== "'") return v;
  const inner = v.slice(1, -1);
  if (q === quote) return v;
  let body = inner;
  if (q === "'") body = body.replace(/\\'/g, "'");
  if (quote === '"') body = body.replace(/(^|[^\\])"/g, '$1\\"');
  if (quote === "'") body = body.replace(/\\"/g, '"').replace(/'/g, "''");
  return quote + body + quote;
}

/**
 * Ausdruck aus Pseudocode in Zielsprache übersetzen.
 * @param {string} text
 * @param {string} lang java|c|cpp|csharp|javascript|python|kotlin|rust
 * @param {{needs?:Set<string>}} ctx
 */
function translateExpr(text, lang, ctx = {}) {
  if (text == null) return '';
  // double(x) ist dasselbe wie float(x): Ganzzahl in Kommazahl
  const toks = ptoks(text).map((t, i, a) => (t.t === 'id' && t.v.toLowerCase() === 'double' && a[i + 1] && a[i + 1].v === '(' ? { ...t, v: 'float' } : t));
  return joinTokens(mapToks(toks, lang, ctx));
}

/**
 * Textvergleiche (a < b, a = b mit Zeichenketten) für Sprachen, in denen die Operatoren dafür nicht taugen:
 *  Java: a.compareTo(b) < 0, a.equals(b)        C: strcmp(a, b) < 0, strcmp(a, b) == 0
 *  C#: string.CompareOrdinal(a, b) < 0 (== passt)  Rust: a.as_str() < "x" (String mit Literal)
 *  C++: string("a") < "b" (nur wenn beide Seiten Literale sind – sonst passt std::string)
 * Verglichen wird wie im Interpreter zeichenweise nach Zeichencode. Ersetzt jeden betroffenen Vergleich durch einen
 * fertig übersetzten Baustein; liefert die neue Tokenliste oder null, wenn nichts zu tun war.
 */
const STRCMP_LANGS = new Set(['java', 'c', 'csharp', 'rust', 'cpp']);
function stringCompare(toks, lang, ctx) {
  if (!toks.length) return null;
  const isLogic = (t) => ['and', 'or', 'xor'].includes(lc(t)) || t.v === '&&' || t.v === '||';
  // Teile zwischen and/or einzeln behandeln
  if (findTop(toks, isLogic) >= 0) {
    const out = [];
    let changed = false, cur = [];
    let depth = 0;
    const flush = () => { const r = stringCompare(cur, lang, ctx); if (r) changed = true; out.push(...(r || cur)); cur = []; };
    for (const t of toks) {
      if (t.t === 'op' && OPEN[t.v]) depth++;
      else if (t.t === 'op' && CLOSE[t.v]) depth--;
      if (depth === 0 && isLogic(t)) { flush(); out.push(t); continue; }
      cur.push(t);
    }
    flush();
    return changed ? out : null;
  }
  // not … bzw. ( … )
  if (lc(toks[0]) === 'not' || toks[0].v === '!') {
    const r = stringCompare(toks.slice(1), lang, ctx);
    // geklammert: sonst bände „!“ nur an strcmp(…) bzw. a.compareTo(…) statt an den ganzen Vergleich
    return r ? [toks[0], tok('(', 'op', true), ...r.map((t, i) => (i === 0 ? { ...t, ws: false } : t)), tok(')', 'op', false)] : null;
  }
  if (isWrapped(toks)) {
    const r = stringCompare(toks.slice(1, -1), lang, ctx);
    return r ? [toks[0], ...r, toks[toks.length - 1]] : null;
  }
  const rels = [];
  let depth = 0;
  toks.forEach((t, k) => { if (t.t === 'op' && OPEN[t.v]) depth++; else if (t.t === 'op' && CLOSE[t.v]) depth--; else if (depth === 0 && REL_OPS.has(t.v)) rels.push(k); });
  if (rels.length !== 1) return null;
  const k = rels[0];
  const L = toks.slice(0, k), R = toks.slice(k + 1);
  if (!L.length || !R.length) return null;
  const typeOf = (part) => operandType(part, ctx);
  const lit = (part) => part.length === 1 && part[0].t === 'str' && part[0].v[0] === '"';
  const isStr = (part) => lit(part) || typeOf(part) === 'string';
  // Zeichen (char) vergleichen alle Sprachen direkt
  const isChar = (part) => typeOf(part) === 'char' || (part.length === 1 && part[0].t === 'str' && CHAR_LIT.test(part[0].v));
  if (isChar(L) || isChar(R)) return null;
  if (!isStr(L) && !isStr(R)) return null;
  const v = toks[k].v;
  const op = v === '=' || v === '==' || v === '===' ? '==' : v === '<>' || v === '!=' || v === '!==' ? '!=' : v;
  const eq = op === '==' || op === '!=';
  const tr = (part) => { const p = part.slice(); p[0] = { ...p[0], ws: false }; return joinTokens(mapToks(p, lang, ctx)); };
  let code = null;
  if (lang === 'java') {
    const a = W(tr(L)), b = tr(R);
    code = eq ? `${op === '!=' ? '!' : ''}${a}.equals(${b})` : `${a}.compareTo(${b}) ${op} 0`;
  } else if (lang === 'c') {
    if (ctx.needs) ctx.needs.add('string');
    code = `strcmp(${tr(L)}, ${tr(R)}) ${op} 0`;
  } else if (lang === 'csharp') {
    if (eq) return null;
    code = `string.CompareOrdinal(${tr(L)}, ${tr(R)}) ${op} 0`;
  } else if (lang === 'rust') {
    // String mit &str-Literal lässt sich nur auf Gleichheit vergleichen, nicht mit < / >
    if (eq || lit(L) === lit(R)) return null;
    const asStr = (part) => (lit(part) ? tr(part) : `${W(tr(part))}.as_str()`);
    code = `${asStr(L)} ${op} ${asStr(R)}`;
  } else if (lang === 'cpp') {
    // zwei Literale wären Zeigervergleiche
    if (!(lit(L) && lit(R))) return null;
    code = `string(${tr(L)}) ${op} ${tr(R)}`;
    if (ctx.needs) ctx.needs.add('string');
  }
  if (!code) return null;
  return [{ t: 'id', v: code, ws: toks[0].ws }];
}

/** Grenzen eines Operanden links bzw. rechts von Position k (bis and/or/Komma/Zuweisung oder Klammerrand) */
const OPERAND_STOP = (t) => (t.t === 'op' && [',', ':=', '<-', '&&', '||', ';'].includes(t.v)) || (t.t === 'id' && ['and', 'or', 'xor', 'not'].includes(t.v.toLowerCase())) || REL_OPS.has(t.v);
function operandLeft(toks, k) {
  let depth = 0, s = k;
  for (let j = k - 1; j >= 0; j--) {
    const t = toks[j];
    if (t.t === 'op' && CLOSE[t.v]) depth++;
    else if (t.t === 'op' && OPEN[t.v]) { if (depth === 0) break; depth--; }
    else if (depth === 0 && OPERAND_STOP(t)) break;
    s = j;
  }
  return s;
}
function operandRight(toks, k) {
  let depth = 0, e = k + 1;
  for (let j = k + 1; j < toks.length; j++) {
    const t = toks[j];
    if (t.t === 'op' && OPEN[t.v]) depth++;
    else if (t.t === 'op' && CLOSE[t.v]) { if (depth === 0) break; depth--; }
    else if (depth === 0 && OPERAND_STOP(t)) break;
    e = j + 1;
  }
  return e;
}

/** Typ eines Operanden; eine einzelne Variable mit ihrem eigenen Typ (ein char bleibt char, inferType macht Text daraus) */
function operandType(part, ctx) {
  try {
    if (part.length === 1 && part[0].t === 'id' && ctx.typeOf) { const t = normType(ctx.typeOf(part[0].v)); if (t) return t; }
    return normType(ctx.exprType ? ctx.exprType(joinTokens(part)) : inferType(joinTokens(part)));
  } catch (e) { return null; }
}

/**
 * Ein einzelnes Zeichen in einfachen Anführungszeichen ('G') ist im Structorizer auch Text. Wird es mit einem Text
 * verglichen (kundentyp = 'G'), als Text-Literal "G" schreiben – sonst wäre es in Java, C, C#, Kotlin, Rust ein char.
 * Umgekehrt wird "a" im Vergleich mit einem Zeichen (foreach z in wort: z = "a") zum Zeichen-Literal 'a'.
 */
const CHAR_LIT = /^'(?:[^'\\]|\\.)'$/;
const STR1_LIT = /^"(?:[^"\\]|\\.)"$/;
function charsToStrings(toks, ctx) {
  let res = null;
  const typeOf = (a, b) => operandType(toks.slice(a, b), ctx);
  for (let k = 0; k < toks.length; k++) {
    if (!REL_OPS.has(toks[k].v)) continue;
    const s = operandLeft(toks, k), e = operandRight(toks, k);
    for (const [lit, a, b] of [[k - 1, k + 1, e], [k + 1, s, k]]) {
      const t = toks[lit];
      const single = lit === k - 1 ? s === k - 1 : e === k + 2;
      if (!t || t.t !== 'str' || !single) continue;
      const other = typeOf(a, b);
      const inner = t.v.slice(1, -1);
      if (CHAR_LIT.test(t.v) && other === 'string') {
        res = res || toks.slice();
        res[lit] = { ...t, v: '"' + (inner === '"' ? '\\"' : inner) + '"' };
      } else if (STR1_LIT.test(t.v) && other === 'char') {
        res = res || toks.slice();
        res[lit] = { ...t, v: "'" + (inner === "'" ? "\\'" : inner) + "'" };
      }
    }
  }
  return res || toks;
}

/**
 * Ganzzahldivision wie im Interpreter (Structorizer): int / int schneidet ab (-3 / 4 = 0).
 * Python: int(a / b) (// rundet ab), JavaScript: Math.trunc(a / b). In den übrigen Sprachen teilt
 * „/“ mit Ganzzahlen ohnehin so. Bestimmt wird je Division aus den Operandentypen.
 */
const INTDIV_LANGS = new Set(['python', 'javascript']);
// Sprachen, in denen Division durch 0 keinen abfangbaren Fehler auslöst (C/C++: Absturz, JavaScript: Infinity/NaN)
const CHECKDIV_LANGS = new Set(['c', 'cpp', 'javascript']);
function intDivision(toks, lang, ctx) {
  // zuerst in Klammergruppen
  const res = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'op' && OPEN[t.v]) {
      const c = matchClose(toks, i);
      if (c > i) { res.push(t, ...intDivision(toks.slice(i + 1, c), lang, ctx), toks[c]); i = c; continue; }
    }
    res.push(t);
  }
  const isMod = (t) => lang === 'python' && !t.modDone && ((t.t === 'op' && t.v === '%') || (t.t === 'id' && t.v.toLowerCase() === 'mod'));
  // innerhalb von try (C, C++, JavaScript): Ganzzahldivision und Rest über Prüf-Hilfsfunktionen, die bei 0 einen
  // abfangbaren Fehler werfen wie der Interpreter (siehe generators.js, checkDiv)
  const checked = !!(ctx && ctx.checkDiv) && CHECKDIV_LANGS.has(lang);
  const isChk = (t) => checked && !t.chkDone && ((t.t === 'op' && ['/', '%'].includes(t.v)) || (t.t === 'id' && ['div', 'mod'].includes(t.v.toLowerCase())));
  if (!res.some((t) => (t.t === 'op' && t.v === '/' && !t.intDivDone) || isMod(t) || isChk(t))) return res;
  const isMul = (t) => (t.t === 'op' && ['*', '/', '%'].includes(t.v)) || (t.t === 'id' && ['div', 'mod'].includes(t.v.toLowerCase()));
  const KW = new Set(['and', 'or', 'xor', 'not', 'div', 'mod']);
  const endsFactor = (t) => t && (t.t === 'num' || t.t === 'str' || (t.t === 'id' && !KW.has(t.v.toLowerCase())) || (t.t === 'op' && CLOSE[t.v]));
  // Ketten aus Faktoren und * / % div mod (höchste Bindung) – begrenzt durch alle anderen zweistelligen Operatoren
  const out = [];
  let i = 0;
  while (i < res.length) {
    let j = i;
    const parts = [[]], ops = [];
    for (; j < res.length; j++) {
      const t = res[j];
      if (t.t === 'op' && OPEN[t.v]) { const c = matchClose(res, j); const end = c < 0 ? res.length - 1 : c; parts[parts.length - 1].push(...res.slice(j, end + 1)); j = end; continue; }
      const cur = parts[parts.length - 1];
      if (cur.length && endsFactor(cur[cur.length - 1]) && isMul(t)) { ops.push(t); parts.push([]); continue; }
      const binary = cur.length && endsFactor(cur[cur.length - 1]);
      if (binary && !(t.t === 'op' && (t.v === '.' || OPEN[t.v]))) break; // anderer zweistelliger Operator: Kette endet
      cur.push(t);
    }
    if (!ops.length) { out.push(...parts[0]); if (j < res.length) out.push(res[j]); i = j + 1; continue; }
    let acc = parts[0];
    ops.forEach((op, k) => {
      const f = parts[k + 1];
      const intOf = (p) => { try { return normType(ctx.exprType ? ctx.exprType(joinTokens(p)) : inferType(joinTokens(p))) === 'int'; } catch (e) { return false; } };
      if (isChk(op) && f.length) {
        const kw = op.t === 'id' ? op.v.toLowerCase() : op.v;
        const ints = intOf(acc) && intOf(f);
        // geprüft wird, was der Interpreter bei 0 ablehnt: div und mod immer, / nur mit Ganzzahlen; % in C/C++ nur Ganzzahlen
        const fn = kw === 'div' || (kw === '/' && ints) ? '_idiv' : (kw === 'mod' || kw === '%') && (ints || lang === 'javascript') ? '_imod' : null;
        if (fn) {
          if (ctx.needs) ctx.needs.add(fn === '_idiv' ? 'checkdiv' : 'checkmod');
          const first = { ...acc[0], ws: false };
          acc = [{ t: 'id', v: fn, ws: acc[0].ws }, tok('(', 'op', false), first, ...acc.slice(1), { t: 'op', v: ',', ws: false },
            ...f.map((x, k) => (k === 0 ? { ...x, ws: true } : x)), tok(')', 'op', false)];
          return;
        }
      }
      if (!INTDIV_LANGS.has(lang)) { acc = [...acc, op, ...f]; return; } // C/C++: nur die Prüfung oben
      if (isMod(op) && f.length) {
        // Python rechnet -7 % 3 = 2, der Interpreter (wie Java) -1: math.fmod behält das Vorzeichen
        if (ctx.needs) ctx.needs.add('math');
        const first = { ...acc[0], ws: false };
        const fm = [{ t: 'id', v: 'math', ws: false }, tok('.', 'op', false), { t: 'id', v: 'fmod', ws: false }, tok('(', 'op', false), first, ...acc.slice(1),
          { t: 'op', v: ',', ws: false, modDone: true }, ...f.map((x, k) => (k === 0 ? { ...x, ws: true } : x)), tok(')', 'op', false)];
        acc = intOf(acc) && intOf(f) ? [{ t: 'id', v: 'int', ws: acc[0].ws }, tok('(', 'op', false), ...fm, tok(')', 'op', false)] : fm;
        return;
      }
      if (op.t === 'op' && op.v === '/' && !op.intDivDone && f.length && intOf(acc) && intOf(f)) {
        const first = { ...acc[0], ws: false };
        acc = [{ t: 'id', v: 'int', ws: acc[0].ws }, tok('(', 'op', false), first, ...acc.slice(1), { ...op, intDivDone: true }, ...f, tok(')', 'op', false)];
        return;
      }
      acc = [...acc, op, ...f];
    });
    out.push(...acc);
    if (j < res.length) out.push(res[j]);
    i = j + 1;
  }
  return out;
}

/** pi als Konstante der Zielsprache (wenn es keine Variable dieses Namens gibt) */
const PI_CONST = { python: 'math.pi', java: 'Math.PI', csharp: 'Math.PI', javascript: 'Math.PI', c: 'M_PI', cpp: 'M_PI', kotlin: 'Math.PI', rust: 'std::f64::consts::PI' };

/** s[i] auf einem Text je Sprache als Text aus einem Zeichen (Python und JavaScript können das selbst) */
const TEXT_INDEX = {
  java: (s, i) => `String.valueOf(${s}.charAt(${i}))`,
  csharp: (s, i) => `${s}[${i}].ToString()`,
  kotlin: (s, i) => `${s}[${i}].toString()`,
  cpp: (s, i) => `string(1, ${s}[${i}])`,
  c: (s, i) => `str_chr(${s}[${i}])`,
  rust: (s, i) => `${s}.chars().nth(${/^\d+$/.test(i) ? i : `(${i}) as usize`}).unwrap().to_string()`,
};

function mapToks(toks, lang, ctx) {
  if (STRCMP_LANGS.has(lang) || lang === 'kotlin') toks = charsToStrings(toks, ctx);
  if (INTDIV_LANGS.has(lang) || (ctx && ctx.checkDiv && CHECKDIV_LANGS.has(lang))) toks = intDivision(toks, lang, ctx);
  // Textvergleiche zuerst (Operanden werden dabei selbst übersetzt)
  if (STRCMP_LANGS.has(lang)) { const sc = stringCompare(toks, lang, ctx); if (sc) toks = sc; }
  if (MODERN.has(lang)) toks = promoteFloats(toks, ctx);
  const out = [];
  const c = CFAM.has(lang);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const l = lc(t);
    const nt = { ...t };
    // Index in einen Text (s[i]): wie im Interpreter ein Text aus einem Zeichen – Java kennt s[i] nicht, Rust indiziert
    // Bytes, C/C++/C#/Kotlin lieferten ein Zeichen statt eines Texts
    const prev = out[out.length - 1];
    if (TEXT_INDEX[lang] && t.t === 'op' && t.v === '[' && prev && prev.t === 'id' && !(out[out.length - 2] && out[out.length - 2].v === '.') &&
      ctx && ctx.cur && ctx.cur.types && normType(ctx.cur.types.get(prev.v)) === 'string') {
      const close = matchClose(toks, i);
      const r = joinTokens(mapToks(toks.slice(i + 1, close < 0 ? toks.length : close), lang, ctx));
      if (lang === 'c' && ctx.needs) { ctx.needs.add('strcat'); ctx.needs.add('string'); }
      out.pop();
      out.push({ ...prev, v: TEXT_INDEX[lang](prev.v, r) });
      i = close < 0 ? toks.length : close;
      continue;
    }
    // Rust: Indizes müssen usize sein  a[i] -> a[i as usize]
    if (lang === 'rust' && t.t === 'op' && t.v === '[' && out.length && (out[out.length - 1].t === 'id' || [')', ']'].includes(out[out.length - 1].v))) {
      const close = matchClose(toks, i);
      const r = joinTokens(mapToks(toks.slice(i + 1, close < 0 ? toks.length : close), lang, ctx));
      out.push({ ...t, ws: false }, { t: 'id', v: /^\d+$/.test(r) ? r : (SIMPLE_CHAIN.test(r) ? `${r} as usize` : `(${r}) as usize`), ws: false }, { t: 'op', v: ']', ws: false });
      // Element eines Arrays aus Texten oder Records: Rust kann es nicht aus dem Index herausbewegen -> Kopie (Plan 4.7)
      const arrName = out[out.length - 4];
      if (arrName && arrName.t === 'id' && ctx.typeOf) {
        const at = normType(ctx.typeOf(arrName.v));
        const et = at && at.endsWith('[]') ? at.slice(0, -2) : null;
        if (et === 'string' || (et && ctx.recordTypes && ctx.recordTypes.has(et))) out.push({ t: 'op', v: '.clone()', ws: false });
      }
      i = close < 0 ? toks.length : close;
      continue;
    }
    if (t.t === 'op') {
      if (t.v === '=' || t.v === '==' || t.v === '===') nt.v = lang === 'javascript' ? '===' : '==';
      else if (t.v === '<>' || t.v === '!=' || t.v === '!==') nt.v = lang === 'javascript' ? '!==' : '!=';
      else if (t.v === '&&') nt.v = c ? '&&' : 'and';
      else if (t.v === '||') nt.v = c ? '||' : 'or';
      else if (t.v === '!' ) {
        if (!c) { nt.v = 'not'; nt.t = 'id'; }
      } else if (t.v === '%') nt.v = '%';
      else if (t.v === '//' && lang !== 'python') nt.v = '/';
      else if (t.v === '<-' || t.v === ':=') nt.v = '=';
      if (nt.t === 'id' && out.length && !t.ws) nt.ws = true;
      if (t.v === '!' && !c) { const nx = toks[i + 1]; if (nx) toks[i + 1] = { ...nx, ws: true }; }
      out.push(nt);
      continue;
    }
    if (t.t === 'str') {
      if (c && t.v[0] === "'" && !(t.v.length === 3 || (t.v.length === 4 && t.v[1] === '\\'))) nt.v = requote(t, '"');
      if (lang === 'kotlin' && nt.v[0] === '"') nt.v = nt.v.replace(/(^|[^\\])\$/g, '$1\\$');
      out.push(nt);
      continue;
    }
    if (t.t === 'id' && ctx.recordTypes && ctx.recordTypes.has(t.v) && toks[i + 1] && toks[i + 1].v === '{' && ctx.recordLiteral) {
      // Record-Literal Punkt{x: 3, y: 4} / Punkt{3, 4}
      const close = matchClose(toks, i + 1);
      const entries = splitTop(toks.slice(i + 2, close < 0 ? toks.length : close), (x) => x.v === ',' || x.v === ';').filter((x) => x.length).map((p) => {
        if (p[0].t === 'id' && p[1] && p[1].v === ':') return { name: p[0].v, src: joinTokens(p.slice(2)) };
        return { name: null, src: joinTokens(p) };
      });
      out.push({ t: 'id', v: ctx.recordLiteral(t.v, entries), ws: t.ws });
      i = close < 0 ? toks.length : close;
      continue;
    }
    if (t.t === 'id') {
      if (l === 'and') { nt.v = c ? '&&' : 'and'; nt.t = c ? 'op' : 'id'; nt.ws = true; }
      else if (l === 'or') { nt.v = c ? '||' : 'or'; nt.t = c ? 'op' : 'id'; nt.ws = true; }
      else if (l === 'xor') { nt.v = lang === 'kotlin' ? 'xor' : '^'; nt.ws = true; }
      else if (toks[i + 1] && toks[i + 1].v === '(' && !(out.length && out[out.length - 1].v === '.') && !(ctx.funcs && ctx.funcs.has(t.v)) &&
          (SFN[l] || (l === 'random' && toks[i + 2] && toks[i + 2].v !== ')')) && !(MODERN.has(lang) && MODERN_FN.has(l))) {
        // Structorizer-Funktion (uppercase, pos, copy, ord, sgn …) in der Zielsprache
        const close = matchClose(toks, i + 1);
        const args = splitTop(toks.slice(i + 2, close < 0 ? toks.length : close), ',').filter((x) => x.length)
          .map((x) => ({ src: joinTokens(x), out: joinTokens(mapToks(x, lang, ctx)) }));
        const tab = l === 'random' ? RANDOM_N : SFN[l];
        const fn = tab[lang] || tab['*'];
        if (!fn || (!args.length && !(TURTLE_PY[l] && lang === 'python'))) { out.push(nt); continue; }
        out.push({ t: 'id', v: fn(args, ctx, lang), ws: t.ws });
        i = close < 0 ? toks.length : close;
        continue;
      } else if ((MODERN.has(lang) || NEW_ARRAY[lang]) && l === 'new' && toks[i + 1] && toks[i + 1].t === 'id' && toks[i + 2] && toks[i + 2].v === '[') {
        const c = matchClose(toks, i + 2);
        const size = joinTokens(mapToks(toks.slice(i + 3, c < 0 ? toks.length : c), lang, ctx));
        if (lang === 'cpp' && ctx.needs) ctx.needs.add('vector');
        out.push({ t: 'id', v: MODERN.has(lang) ? modernNewArray(toks[i + 1].v, size, lang) : NEW_ARRAY[lang](normType(toks[i + 1].v), size), ws: t.ws });
        i = c < 0 ? toks.length : c;
        continue;
      } else if (MODERN.has(lang) && toks[i + 1] && toks[i + 1].v === '(' && !(out.length && out[out.length - 1].v === '.') &&
          (MODERN_FN.has(l) || (ctx.funcs && ctx.funcs.has(t.v)))) {
        const close = matchClose(toks, i + 1);
        const argToks = splitTop(toks.slice(i + 2, close < 0 ? toks.length : close), ',').filter((x) => x.length);
        const args = argToks.map((x) => ({ src: joinTokens(x), out: joinTokens(mapToks(x, lang, ctx)), toks: x }));
        let v;
        if (ctx.funcs && ctx.funcs.has(t.v)) {
          // eigene Funktion: Argumente an Parametertypen anpassen
          const sig = ctx.funcs.get(t.v);
          v = `${t.v}(${args.map((x, k) => {
            const prm = sig.params[k];
            const pt = prm && normType(prm.type || prm.inferredType);
            if (pt === 'double' && /^-?\d+$/.test(x.out)) return x.out + '.0';
            if (lang === 'rust' && pt === 'string' && isStringLiteral(x.src)) return `String::from(${x.out})`;
            if (lang === 'rust' && x.toks.length === 1 && x.toks[0].t === 'id' && ctx.typeOf) {
              const vt = normType(ctx.typeOf(x.toks[0].v));
              // Arrays als Referenz (wie im Interpreter, Plan 4.3), Texte als Kopie
              if (vt && vt.endsWith('[]') && ctx.rsArrayArg) return ctx.rsArrayArg(t.v, k, x.out);
              if (vt === 'string' || (vt && vt.endsWith('[]'))) return x.out + '.clone()';
            }
            return x.out;
          }).join(', ')})`;
        } else v = modernFn(l, args, lang, ctx);
        out.push({ t: 'id', v, ws: t.ws });
        i = close < 0 ? toks.length : close;
        continue;
      }
      else if (l === 'div') { nt.v = lang === 'python' ? '//' : '/'; nt.t = 'op'; nt.ws = true; }
      else if (l === 'mod') { nt.v = '%'; nt.t = 'op'; nt.ws = true; }
      else if (l === 'true' || l === 'false' || l === 'wahr' || l === 'falsch') {
        const val = l === 'true' || l === 'wahr';
        nt.v = lang === 'python' ? (val ? 'True' : 'False') : (val ? 'true' : 'false');
        if (lang === 'c' && ctx.needs) ctx.needs.add('stdbool');
      } else if (l === 'pi' && !(toks[i + 1] && toks[i + 1].v === '(') && !(out.length && out[out.length - 1].v === '.') && !(ctx.typeOf && ctx.typeOf(t.v))) {
        nt.v = PI_CONST[lang] || t.v;
        if (ctx.needs && lang === 'python') ctx.needs.add('math');
        if (ctx.needs && (lang === 'c' || lang === 'cpp')) ctx.needs.add('math');
      } else if (l === 'null' || l === 'nil' || l === 'none') {
        nt.v = lang === 'python' || lang === 'rust' ? 'None' : lang === 'c' ? 'NULL' : lang === 'cpp' ? 'nullptr' : 'null';
      } else if (l === 'not') {
        if (c) {
          const end = operandEnd(toks, i + 1);
          const operand = toks.slice(i + 1, end);
          const inner = mapToks(operand, lang, ctx);
          out.push({ ...t, t: 'op', v: '!', ws: t.ws });
          if (isSimpleOperand(operand)) { if (inner[0]) inner[0] = { ...inner[0], ws: false }; out.push(...inner); }
          else { out.push(tok('(', 'op', false)); if (inner[0]) inner[0] = { ...inner[0], ws: false }; out.push(...inner, tok(')', 'op', false)); }
          i = end - 1;
          continue;
        }
        nt.v = 'not';
      } else if ((l === 'floor' || l === 'ceil') && lang === 'python' && toks[i + 1] && toks[i + 1].v === '(' && !(out.length && out[out.length - 1].v === '.')) {
        // math.floor/ceil liefern in Python eine Ganzzahl – im Interpreter (wie Java) eine Kommazahl: -3.0
        const close = matchClose(toks, i + 1);
        const arg = joinTokens(mapToks(toks.slice(i + 2, close < 0 ? toks.length : close), lang, ctx));
        if (ctx.needs) ctx.needs.add('math');
        out.push({ t: 'id', v: `float(math.${l}(${arg}))`, ws: t.ws });
        i = close < 0 ? toks.length : close;
        continue;
      } else if (MATH_FUNCS[l] && toks[i + 1] && toks[i + 1].v === '(' && !(out.length && out[out.length - 1].v === '.')) {
        nt.v = MATH_FUNCS[l][lang] || t.v;
        if (l === 'abs' && lang === 'c') {
          const close = matchClose(toks, i + 1);
          let at = null;
          try { at = normType(ctx.exprType ? ctx.exprType(joinTokens(toks.slice(i + 2, close))) : null); } catch (e) { at = null; }
          if (at === 'double') { nt.v = 'fabs'; if (ctx.needs) ctx.needs.add('math'); }
        }
        if (ctx.needs && (lang === 'python' && nt.v.startsWith('math.'))) ctx.needs.add('math');
        if (ctx.needs && (lang === 'c' || lang === 'cpp') && l !== 'abs') ctx.needs.add('math');
      } else if (l === 'random' && toks[i + 1] && toks[i + 1].v === '(') {
        nt.v = { java: 'Math.random', javascript: 'Math.random', python: 'random.random', c: 'rand', cpp: 'rand', csharp: 'new Random().NextDouble' }[lang] || t.v;
        if (ctx.needs && lang === 'python') ctx.needs.add('random');
      } else if ((l === 'int' || l === 'trunc' || l === 'float' || l === 'str' || l === 'round') && toks[i + 1] && toks[i + 1].v === '(' && !(out.length && out[out.length - 1].v === '.')) {
        const close = matchClose(toks, i + 1);
        const arg = joinTokens(mapToks(toks.slice(i + 2, close < 0 ? toks.length : close), lang, ctx));
        const simple = /^[\p{L}\p{N}_.]+$/u.test(arg);
        const a = simple ? arg : '(' + arg + ')';
        const CAST = {
          int: { java: `(int) ${a}`, c: `(int) ${a}`, cpp: `(int) ${a}`, csharp: `(int) ${a}`, javascript: `Math.trunc(${arg})`, python: `int(${arg})` },
          float: { java: `(double) ${a}`, c: `(double) ${a}`, cpp: `(double) ${a}`, csharp: `(double) ${a}`, javascript: `Number(${arg})`, python: `float(${arg})` },
          str: { java: `String.valueOf(${arg})`, c: arg, cpp: `to_string(${arg})`, csharp: `Convert.ToString(${arg})`, javascript: `String(${arg})`, python: `str(${arg})` },
          // wie im Interpreter (Structorizer/Java): .5 rundet aufwärts, auch negativ (-2.5 -> -2)
          round: { java: `(int) Math.round(${arg})`, c: `(int) floor(${a} + 0.5)`, cpp: `(int) floor(${a} + 0.5)`, csharp: `(int) Math.Floor(${a} + 0.5)`, javascript: `Math.round(${arg})`, python: `math.floor(${a} + 0.5)` },
        }[l === 'trunc' ? 'int' : l];
        if (ctx.needs && l === 'round' && (lang === 'c' || lang === 'cpp' || lang === 'python')) ctx.needs.add('math');
        out.push({ t: 'id', v: CAST[lang] || t.v, ws: t.ws });
        i = close < 0 ? toks.length : close;
        continue;
      } else if (l === 'length' || l === 'len') {
        if (toks[i + 1] && toks[i + 1].v === '(' && !(out.length && out[out.length - 1].v === '.')) {
          const close = matchClose(toks, i + 1);
          const arg = joinTokens(mapToks(toks.slice(i + 2, close), lang, ctx));
          let at = null;
          try { at = normType(ctx.exprType ? ctx.exprType(joinTokens(toks.slice(i + 2, close))) : null); } catch (e) { at = null; }
          const isArr = !!(at && at.endsWith('[]'));
          const sz = `(int) (sizeof(${arg}) / sizeof(${arg}[0]))`;
          if (lang === 'c' && !isArr && ctx.needs) ctx.needs.add('string');
          const repl = { java: isArr ? `${arg}.length` : `${arg}.length()`, javascript: `${arg}.length`, csharp: `${arg}.Length`, python: `len(${arg})`,
            cpp: `(int) ${arg}.size()`, c: isArr ? sz : `(int) strlen(${arg})` }[lang]; // C++: Arrays sind std::vector
          if (repl) { out.push({ t: 'id', v: repl, ws: t.ws }); i = close; continue; }
        }
      }
      out.push(nt);
      continue;
    }
    out.push(nt);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

const INVERT = { '=': '<>', '==': '!=', '<>': '=', '!=': '==', '<': '>=', '>': '<=', '<=': '>', '>=': '<' };

/** Bedingung (Pseudocode) logisch negieren */
function negateCond(text) {
  const toks = ptoks(text);
  if (!toks.length) return 'false';
  if (lc(toks[0]) === 'not' && toks.length > 1) {
    const rest = toks.slice(1);
    if (isWrapped(rest)) return joinTokens(rest.slice(1, -1));
    if (rest.length === 1) return rest[0].v;
  }
  if (toks.length === 1) {
    const l = lc(toks[0]);
    if (l === 'true') return 'false';
    if (l === 'false') return 'true';
    return 'not ' + toks[0].v;
  }
  const logic = findTop(toks, (t) => ['and', 'or', 'xor'].includes(lc(t)) || t.v === '&&' || t.v === '||' || t.v === '?');
  if (logic < 0) {
    const rels = [];
    let depth = 0;
    toks.forEach((t, k) => { if (OPEN[t.v]) depth++; else if (CLOSE[t.v]) depth--; else if (depth === 0 && REL_OPS.has(t.v)) rels.push(k); });
    if (rels.length === 1) {
      const k = rels[0];
      const nt = toks.slice();
      nt[k] = { ...toks[k], v: INVERT[toks[k].v] || toks[k].v };
      return joinTokens(nt);
    }
  }
  if (isWrapped(toks)) return 'not ' + joinTokens(toks);
  return 'not (' + joinTokens(toks) + ')';
}

/** "n - 1" + 1 -> "n";  "10" - 1 -> "9" */
function addConst(expr, delta) {
  const e = String(expr).trim();
  if (delta === 0) return e;
  if (/^-?\d+$/.test(e)) return String(parseInt(e, 10) + delta);
  const m = /^(.*?)\s*([+-])\s*(\d+)$/.exec(e);
  if (m && !/[<>=]|\band\b|\bor\b/.test(m[1])) {
    const v = (m[2] === '+' ? 1 : -1) * parseInt(m[3], 10) + delta;
    if (v === 0) return m[1];
    return `${m[1]} ${v > 0 ? '+' : '-'} ${Math.abs(v)}`;
  }
  return `${e} ${delta > 0 ? '+' : '-'} ${Math.abs(delta)}`;
}

/**
 * Position des Schrittweiten-Schlüsselworts (by / step / schritt) im Zählschleifenkopf nach „to“, sonst -1.
 * Es ist nur dann ein Schlüsselwort, wenn davor ein vollständiger Endwert und danach ein Ausdruck steht – so bleibt
 * eine Variable dieses Namens eine Variable: „for i := 1 to by“ (Endwert by), „for i := 1 to n by by“ (Schritt by).
 */
const ARITH_KW = ['and', 'or', 'not', 'xor', 'div', 'mod'];
function stepKeyword(toks, toK) {
  let depth = 0;
  for (let k = toK + 1; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'op' && OPEN[t.v]) { depth++; continue; }
    if (t.t === 'op' && CLOSE[t.v]) { depth--; continue; }
    if (depth !== 0 || t.t !== 'id' || !['by', 'step', 'schritt'].includes(lc(t)) || k <= toK + 1 || k >= toks.length - 1) continue;
    const p = toks[k - 1], n = toks[k + 1];
    const endsOperand = p.t === 'num' || p.t === 'str' || (p.t === 'id' && !ARITH_KW.includes(lc(p))) || (p.t === 'op' && CLOSE[p.v]);
    const startsOperand = !(n.t === 'op' && !['-', '+', '('].includes(n.v)) && !(n.t === 'id' && ARITH_KW.filter((w) => w !== 'not').includes(lc(n)));
    if (endsOperand && startsOperand) return k;
  }
  return -1;
}

/** for-Text zerlegen */
function parseForText(text) {
  let toks = ptoks(text);
  if (!toks.length) return null;
  let l = lc(toks[0]);
  if (l === 'foreach' || l === 'für' && lc(toks[1]) === 'jedes' || (l === 'for' && lc(toks[1]) === 'each')) {
    toks = toks.slice(l === 'foreach' ? 1 : 2);
    const k = findTop(toks, (t) => lc(t) === 'in' || lc(t) === 'of' || t.v === ':');
    if (k < 0) return null;
    return { kind: 'each', var: joinTokens(toks.slice(0, k)), coll: joinTokens(toks.slice(k + 1)) };
  }
  if (l === 'for' || l === 'für' || l === 'zähle' || l === 'von') toks = toks.slice(1);
  if (isWrapped(toks)) toks = toks.slice(1, -1);
  // for i = 1 to 10 ist ungültig: = ist der Vergleich (nur :=, <-, from/von)
  const asg = findTop(toks, (t) => t.v === '<-' || t.v === ':=' || lc(t) === 'from' || lc(t) === 'von');
  const toK = findTop(toks, (t) => lc(t) === 'to' || lc(t) === 'bis' || lc(t) === 'downto');
  if (asg > 0 && toK > asg) {
    const byK = stepKeyword(toks, toK);
    const down = lc(toks[toK]) === 'downto';
    let step = byK > 0 ? joinTokens(toks.slice(byK + 1)) : (down ? '-1' : '1');
    if (/^\(\s*-\s*\d+\s*\)$/.test(step)) step = step.replace(/[()\s]/g, '');
    return {
      kind: 'count',
      var: joinTokens(toks.slice(0, asg)),
      start: joinTokens(toks.slice(asg + 1, toK)),
      end: joinTokens(toks.slice(toK + 1, byK > 0 ? byK : toks.length)),
      step: step.replace(/^-\s+/, '-'),
    };
  }
  const inK = findTop(toks, (t) => lc(t) === 'in');
  if (inK > 0) return { kind: 'each', var: joinTokens(toks.slice(0, inK)), coll: joinTokens(toks.slice(inK + 1)) };
  return null;
}

/** Schlüsselwort am Anfang entfernen (while/solange, until/bis) */
function stripKeyword(text, kws) {
  let s = String(text || '').trim();
  const toks = ptoks(s);
  if (toks.length && kws.includes(lc(toks[0]))) s = joinTokens(toks.slice(1));
  // abschließendes "do"
  s = s.replace(/\s+do$/i, '').trim();
  const t2 = ptoks(s);
  if (isWrapped(t2)) s = joinTokens(t2.slice(1, -1));
  return s;
}

/**
 * Genauer Typ (für die Code-Erzeugung): int, long, short, byte, float, double, char, string, boolean – oder null.
 * Anders als normType bleibt float von double und long von int unterschieden.
 */
const CANON = {
  int: 'int', integer: 'int', int32: 'int', i32: 'int', unsigned: 'int', 'unsigned int': 'int', size_t: 'int', usize: 'int', isize: 'int', u32: 'int',
  long: 'long', 'long long': 'long', longint: 'long', int64: 'long', i64: 'long', u64: 'long', 'unsigned long': 'long',
  short: 'short', smallint: 'short', int16: 'short', i16: 'short', u16: 'short',
  byte: 'byte', u8: 'byte', i8: 'byte', shortint: 'byte',
  float: 'float', single: 'float', f32: 'float',
  double: 'double', real: 'double', f64: 'double', number: 'double', extended: 'double', 'long double': 'double', decimal: 'double',
  char: 'char', string: 'string', str: 'string', 'std::string': 'string', ansistring: 'string', 'char*': 'string', '&str': 'string',
  boolean: 'boolean', bool: 'boolean',
};
function canonType(t) {
  if (!t) return null;
  const k = String(t).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*\*$/, '*');
  return CANON[k] || null;
}

/** Typnamen vereinheitlichen */
function normType(t) {
  if (!t) return null;
  const s = String(t).trim();
  const low = s.toLowerCase().replace(/\s+/g, ' ');
  if (/^(int|integer|long|short|byte|longint|unsigned int|unsigned|long long|unsigned long|size_t|int32|int64|[iu](8|16|32|64|128|size)|uint|ulong)$/.test(low)) return 'int';
  if (/^(double|float|real|single|number|decimal|long double|extended|f32|f64)$/.test(low)) return 'double';
  if (/^(string|str|&\s*str|char\s*\*|const char\s*\*|std::string|ansistring|charsequence)$/.test(low)) return 'string';
  const kArr = { intarray: 'int[]', longarray: 'int[]', doublearray: 'double[]', floatarray: 'double[]', booleanarray: 'boolean[]', chararray: 'char[]' }[low];
  if (kArr) return kArr;
  const gen = /^(?:vec|array|list|mutablelist|arraylist)\s*<\s*(.+)\s*>$/.exec(low);
  if (gen) return (normType(gen[1]) || gen[1]) + '[]';
  if (/^(boolean|bool)$/.test(low)) return 'boolean';
  if (low === 'char') return 'char';
  const arr = /^(.*?)\s*\[\s*\]$/.exec(s);
  if (arr) { const b = normType(arr[1]); return (b || arr[1]) + '[]'; }
  return s;
}

/** Ausdruckstyp abschätzen (int/double/string/boolean/char oder null) */
function inferType(expr, varTypes = new Map(), funcs = new Map()) {
  const toks = ptoks(expr);
  if (!toks.length) return null;
  if (toks.length === 1 && toks[0].t === 'str') return (toks[0].v.length === 3 && toks[0].v[0] === "'") ? 'char' : 'string';
  // eine Feldvariable allein hat ihren Feldtyp (foreach name in namen -> string[])
  if (toks.length === 1 && toks[0].t === 'id' && varTypes.has(toks[0].v)) {
    const vt = normType(varTypes.get(toks[0].v));
    if (vt && vt.endsWith('[]')) return vt;
    // ein einzelnes Zeichen bleibt ein Zeichen (in Ausdrücken wie z + "x" wird daraus Text, siehe unten)
    if (vt === 'char') return 'char';
    // ebenso ein Wahrheitswert (b := a > 3; OUTPUT b)
    if (vt === 'boolean') return 'boolean';
    // und ein Record (p als Argument: Parameter vom Typ Punkt)
    if (vt && funcs && funcs.records && funcs.records.has(vt)) return vt;
  }
  // new int[n]: Array dieses Typs
  if (toks.length >= 4 && toks[0].t === 'id' && toks[0].v.toLowerCase() === 'new' && toks[1].t === 'id' && toks[2].v === '[' &&
    matchClose(toks, 2) === toks.length - 1 && normType(toks[1].v)) return normType(toks[1].v) + '[]';
  // Feldzugriff auf einen Record als ganzer Ausdruck (p.ok, leute[1].name): Typ des Feldes, auch Wahrheitswert
  if (toks[0].t === 'id' && varTypes.has(toks[0].v)) {
    const fa = fieldAccess(toks, 0, varTypes, funcs);
    if (fa && fa.end === toks.length - 1) return fa.type;
  }
  // chr(…) allein ist ein Zeichen
  if (toks.length >= 3 && toks[0].t === 'id' && toks[0].v.toLowerCase() === 'chr' && toks[1].v === '(' && matchClose(toks, 1) === toks.length - 1) return 'char';
  // ein einzelner Aufruf eines Unterprogramms hat dessen Rückgabetyp – auch Wahrheitswert, Zeichen, Feld oder Record
  // (OUTPUT istGerade(4) -> true statt True bzw. 1)
  if (toks.length >= 3 && toks[0].t === 'id' && toks[1].v === '(' && matchClose(toks, 1) === toks.length - 1 &&
    funcs && funcs.has(toks[0].v) && funcs.get(toks[0].v).returnType) return normType(funcs.get(toks[0].v).returnType);
  // Record-Literal Punkt{…} hat den Typ Punkt
  if (toks.length >= 3 && toks[0].t === 'id' && toks[1].v === '{' && matchClose(toks, 1) === toks.length - 1) return toks[0].v;
  if (findTop(toks, (t) => REL_OPS.has(t.v) || ['and', 'or', 'not', 'xor'].includes(lc(t)) || t.v === '&&' || t.v === '||' || t.v === '!') >= 0) return 'boolean';
  if (toks.length === 1 && ['true', 'false', 'wahr', 'falsch'].includes(lc(toks[0]))) return 'boolean';
  if (toks[0].v === '{' || toks[0].v === '[') {
    const inner = toks.slice(1, -1);
    const parts = splitTop(inner, ',');
    const et = parts.length && parts[0].length ? inferType(joinTokens(parts[0]), varTypes, funcs) : null;
    return et ? et + '[]' : null;
  }
  let res = null;
  const rank = { int: 1, double: 2, string: 3 };
  const bump = (t) => { if (t && rank[t] && (!res || rank[t] > rank[res])) res = t; };
  let unknown = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'str') bump('string');
    else if (t.t === 'num') bump(/[.eE]/.test(t.v) && !/^0[xX]/.test(t.v) ? 'double' : 'int');
    else if (t.t === 'id') {
      const l = t.v.toLowerCase();
      if (toks[i + 1] && toks[i + 1].v === '(') {
        const close = matchClose(toks, i + 1);
        if (funcs.has(t.v) && funcs.get(t.v).returnType) bump(normType(funcs.get(t.v).returnType));
        else if (l === 'random' && toks[i + 2] && toks[i + 2].v !== ')') bump('int'); // random(n): ganze Zahl
        else if (['sqrt', 'pow', 'random', 'float', 'double', 'floor', 'ceil', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'toradians', 'todegrees', 'signum'].includes(l)) bump('double');
        else if (l === 'abs') bump(inferType(joinTokens(toks.slice(i + 2, close)), varTypes, funcs) === 'double' ? 'double' : 'int'); // abs hat den Typ des Arguments
        else if (['len', 'length', 'int', 'round', 'ord', 'trunc', 'pos', 'sgn', 'strcmp'].includes(l)) bump('int');
        else if (['str', 'input', 'chr', 'tostring', 'uppercase', 'lowercase', 'trim', 'copy', 'insert', 'delete'].includes(l)) bump('string');
        else unknown = true;
        i = close;
        continue;
      }
      if (toks[i - 1] && toks[i - 1].v === '.') continue;
      if (['div', 'mod'].includes(l)) continue;
      if (l === 'pi' && !varTypes.has(t.v)) { bump('double'); continue; }
      const fa = varTypes.has(t.v) ? fieldAccess(toks, i, varTypes, funcs) : null;
      if (fa) {
        if (fa.type === 'char') bump('string'); else bump(fa.type);
        if (!rank[fa.type] && fa.type !== 'char') unknown = true;
        i = fa.end;
        continue;
      }
      if (varTypes.has(t.v)) {
        const vt = normType(varTypes.get(t.v));
        if (vt && vt.endsWith('[]') && toks[i + 1] && toks[i + 1].v === '[') { bump(vt.slice(0, -2)); i = matchClose(toks, i + 1); continue; }
        if (vt === 'char') bump('string'); else bump(vt);
        if (!rank[vt] && vt !== 'char') unknown = true;
      } else unknown = true;
    } else if (t.v === '/' && res === 'int') { /* Ganzzahldivision bleibt int */ }
  }
  if (res === 'string') return 'string';
  if (unknown && res !== 'double') return res === 'int' && toks.length > 1 ? null : (unknown ? null : res);
  return res;
}

/**
 * Feldzugriff ab toks[i] (Variable eines Record-Typs, optional mit Index: p.x, leute[1].name, a.b.c): Typ des
 * letzten Feldes und Index des letzten Tokens – sonst null. Die Record-Definitionen kommen als funcs.records
 * (Map Typname -> [{ name, type }], gesetzt von der Codeerzeugung).
 */
function fieldAccess(toks, i, varTypes, funcs) {
  const recs = funcs && funcs.records;
  if (!recs || !recs.size) return null;
  let vt = normType(varTypes.get(toks[i].v));
  let j = i;
  if (vt && vt.endsWith('[]') && toks[j + 1] && toks[j + 1].v === '[') {
    const c = matchClose(toks, j + 1);
    if (c < 0) return null;
    vt = vt.slice(0, -2);
    j = c;
  }
  let any = false;
  while (vt && recs.has(vt) && toks[j + 1] && toks[j + 1].v === '.' && toks[j + 2] && toks[j + 2].t === 'id') {
    const f = recs.get(vt).find((x) => x.name === toks[j + 2].v);
    vt = f ? normType(f.type) : null;
    j += 2;
    any = true;
    // Feld, das selbst ein Array ist: f[k]
    if (vt && vt.endsWith('[]') && toks[j + 1] && toks[j + 1].v === '[') { const c = matchClose(toks, j + 1); if (c < 0) return null; vt = vt.slice(0, -2); j = c; }
  }
  return any && vt ? { type: vt, end: j } : null;
}

/**
 * Signatur aus Root-Text lesen.
 * Formen: "main" | "summe(a, b)" | "summe(a: int, b: int): int" | "int summe(int a, int b)"
 */
function parseSignature(text) {
  const s = (Array.isArray(text) ? text.join(' ') : String(text || '')).trim();
  const toks = ptoks(s);
  const open = toks.findIndex((t) => t.v === '(');
  if (open < 0) {
    const name = toks.length ? toks[toks.length - 1].v : 'main';
    return { name: sanitizeIdent(name), params: [], returnType: null, hasParens: false };
  }
  const close = matchClose(toks, open);
  const name = open > 0 ? toks[open - 1].v : 'unbenannt';
  let returnType = open > 1 ? joinTokens(toks.slice(0, open - 1)) : null;
  const after = close >= 0 ? toks.slice(close + 1) : [];
  if (after.length && (after[0].v === ':' || after[0].v === '->')) returnType = joinTokens(after.slice(1));
  // void & Co.: ausdrücklich kein Rückgabewert (returnVoid merkt sich, dass es so geschrieben wurde)
  let returnVoid = false;
  if (returnType && /^(void|procedure|function|sub|def)$/i.test(returnType)) { returnType = null; returnVoid = true; }
  const inner = toks.slice(open + 1, close < 0 ? toks.length : close);
  const params = [];
  for (const part of splitTop(inner, (t) => t.v === ',' || t.v === ';')) {
    if (!part.length) continue;
    let p = part;
    const eq = findTop(p, (t) => t.v === '=' || t.v === '<-');
    if (eq >= 0) p = p.slice(0, eq);
    p = p.filter((t) => !['var', 'const', 'final', 'ref', 'out', 'in', 'params', '...', '*', '**'].includes(t.v));
    const colon = findTop(p, (t) => t.v === ':' || lc(t) === 'as');
    if (colon >= 0) {
      const names = splitTop(p.slice(0, colon), ',');
      const type = joinTokens(p.slice(colon + 1));
      for (const n of names) params.push({ name: joinTokens(n), type });
    } else if (p.length === 1) {
      params.push({ name: p[0].v, type: null });
    } else {
      // C-Stil: Typ Name [ [] ]
      let k = p.length - 1, suffix = '';
      while (k > 0 && p[k].v === ']') { suffix += '[]'; k -= 2; }
      params.push({ name: p[k].v, type: joinTokens(p.slice(0, k)) + suffix });
    }
  }
  return { name: sanitizeIdent(name), params, returnType, returnVoid, hasParens: true };
}

function sanitizeIdent(n) {
  const s = String(n || '').replace(/[^\p{L}\p{N}_]/gu, '_');
  return /^\p{N}/u.test(s) ? '_' + s : (s || 'unbenannt');
}

/** Inhalt eines String-Literals (ohne Anführungszeichen) */
function literalInner(v) {
  const q = v[0];
  if (q !== '"' && q !== "'" && q !== '`') return v;
  let inner = v.slice(1, v.endsWith(q) && v.length > 1 ? -1 : undefined);
  if (q === "'") inner = inner.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"');
  return inner;
}

function isStringLiteral(text) {
  const toks = ptoks(text);
  return toks.length === 1 && toks[0].t === 'str';
}

module.exports = {
  hasAssignOp,
  classifyLine, translateExpr, negateCond, addConst, parseForText, stripKeyword, normType, inferType,
  parseSignature, literalInner, isStringLiteral, ptoks, IDENT_RE, REL_OPS, INPUT_KW, OUTPUT_KW, typeEnd, requote, canonType,
};
