'use strict';
/**
 * Struktogramm-Modell -> Quelltext.
 */
const P = require('./pseudo');
const { t: tr } = require('../i18n');
const { walk } = require('./model');
const { joinTokens, findTop, matchClose, OPEN, CLOSE } = require('./tokenizer');

const DYNAMIC_LANGS = new Set(['python', 'javascript']); // Variablen ohne festen Typ
// Sprachen, in denen break innerhalb von switch nur das switch verlässt (nicht die umgebende Schleife)
const SWITCH_BREAK_LANGS = new Set(['c', 'cpp', 'csharp', 'java', 'javascript']);

/**
 * Hilfsfunktion je Sprache: Kommazahl wie der Interpreter ausgeben (Regel von JavaScript): kürzeste exakte
 * Darstellung, ganze Werte mit .0 (80.0), Exponent erst unter 0.000001 bzw. ab 1e21 (1e-7, 1.5e-7, 1e+21).
 * Aus der kürzesten Darstellung der Sprache werden Ziffern und Dezimalexponent gelesen und neu zusammengesetzt.
 */
function fmtHelper(lang) {
  switch (lang) {
    case 'c': return [
      'const char* fmt_double(double x) {',
      '    static char buf[8][352];',
      '    static int k = 0;',
      '    char* r = buf[k++ % 8];',
      '    if (x != x) return "NaN";',
      '    if (x - x != 0) return x > 0 ? "Infinity" : "-Infinity";',
      '    if (x == 0) return "0.0";',
      '    double a = x < 0 ? -x : x;',
      '    char m[40];',
      '    for (int p = 0; p < 17; p++) { snprintf(m, sizeof m, "%.*e", p, a); if (strtod(m, NULL) == a) break; }',
      '    char d[24]; int nd = 0; char* e = strchr(m, \'e\');',
      '    for (char* c = m; c < e; c++) if (*c != \'.\') d[nd++] = *c;',
      '    while (nd > 1 && d[nd - 1] == \'0\') nd--;',
      '    d[nd] = 0;',
      '    int n = atoi(e + 1) + 1; /* Wert = 0.d mal 10 hoch n */',
      '    char* o = r;',
      '    if (x < 0) *o++ = \'-\';',
      '    if (nd <= n && n <= 21) { memcpy(o, d, nd); o += nd; for (int i = nd; i < n; i++) *o++ = \'0\'; strcpy(o, ".0"); }',
      '    else if (0 < n && n <= 21) { memcpy(o, d, n); o += n; *o++ = \'.\'; strcpy(o, d + n); }',
      '    else if (-6 < n && n <= 0) { *o++ = \'0\'; *o++ = \'.\'; for (int i = 0; i < -n; i++) *o++ = \'0\'; strcpy(o, d); }',
      '    else { *o++ = d[0]; if (nd > 1) { *o++ = \'.\'; memcpy(o, d + 1, nd - 1); o += nd - 1; } sprintf(o, "e%c%d", n - 1 >= 0 ? \'+\' : \'-\', abs(n - 1)); }',
      '    return r;',
      '}'];
    case 'cpp': return [
      'string fmt_double(double x) {',
      '    if (x != x) return "NaN";',
      '    if (x - x != 0) return x > 0 ? "Infinity" : "-Infinity";',
      '    if (x == 0) return "0.0";',
      '    double a = x < 0 ? -x : x;',
      '    char m[40];',
      '    for (int p = 0; p < 17; p++) { snprintf(m, sizeof m, "%.*e", p, a); if (strtod(m, nullptr) == a) break; }',
      '    string s = m, d;',
      '    size_t e = s.find(\'e\');',
      '    for (size_t i = 0; i < e; i++) if (s[i] != \'.\') d += s[i];',
      '    while (d.size() > 1 && d.back() == \'0\') d.pop_back();',
      '    int k = (int) d.size(), n = stoi(s.substr(e + 1)) + 1; // Wert = 0.d mal 10 hoch n',
      '    string r = x < 0 ? "-" : "";',
      '    if (k <= n && n <= 21) return r + d + string(n - k, \'0\') + ".0";',
      '    if (0 < n && n <= 21) return r + d.substr(0, n) + "." + d.substr(n);',
      '    if (-6 < n && n <= 0) return r + "0." + string(-n, \'0\') + d;',
      '    return r + d.substr(0, 1) + (k > 1 ? "." + d.substr(1) : string()) + "e" + (n - 1 >= 0 ? "+" : "-") + to_string(abs(n - 1));',
      '}'];
    case 'csharp': return [
      'static string Fmt(double x)',
      '{',
      '    if (double.IsNaN(x)) return "NaN";',
      '    if (double.IsInfinity(x)) return x > 0 ? "Infinity" : "-Infinity";',
      '    if (x == 0) return "0.0";',
      '    string s = Math.Abs(x).ToString("R", CultureInfo.InvariantCulture);',
      '    int ei = s.IndexOf(\'E\');',
      '    string m = ei < 0 ? s : s.Substring(0, ei);',
      '    int dot = m.IndexOf(\'.\');',
      '    string d = m.Replace(".", "");',
      '    int n = (dot < 0 ? m.Length : dot) + (ei < 0 ? 0 : int.Parse(s.Substring(ei + 1), CultureInfo.InvariantCulture));',
      '    while (d.Length > 1 && d[0] == \'0\') { d = d.Substring(1); n--; }',
      '    d = d.TrimEnd(\'0\');',
      '    int k = d.Length;',
      '    string r = x < 0 ? "-" : "";',
      '    if (k <= n && n <= 21) return r + d + new string(\'0\', n - k) + ".0";',
      '    if (0 < n && n <= 21) return r + d.Substring(0, n) + "." + d.Substring(n);',
      '    if (-6 < n && n <= 0) return r + "0." + new string(\'0\', -n) + d;',
      '    return r + d.Substring(0, 1) + (k > 1 ? "." + d.Substring(1) : "") + "e" + (n - 1 >= 0 ? "+" : "-") + Math.Abs(n - 1);',
      '}'];
    case 'java': return [
      'static String fmt(double x) {',
      '    if (Double.isNaN(x)) return "NaN";',
      '    if (Double.isInfinite(x)) return x > 0 ? "Infinity" : "-Infinity";',
      '    if (x == 0) return "0.0";',
      '    String s = Double.toString(Math.abs(x));',
      '    int ei = s.indexOf(\'E\');',
      '    String m = ei < 0 ? s : s.substring(0, ei);',
      '    int dot = m.indexOf(\'.\');',
      '    String d = m.replace(".", "");',
      '    int n = (dot < 0 ? m.length() : dot) + (ei < 0 ? 0 : Integer.parseInt(s.substring(ei + 1)));',
      '    while (d.length() > 1 && d.charAt(0) == \'0\') { d = d.substring(1); n--; }',
      '    d = d.replaceAll("0+$", "");',
      '    int k = d.length();',
      '    String r = x < 0 ? "-" : "";',
      '    if (k <= n && n <= 21) return r + d + "0".repeat(n - k) + ".0";',
      '    if (0 < n && n <= 21) return r + d.substring(0, n) + "." + d.substring(n);',
      '    if (-6 < n && n <= 0) return r + "0." + "0".repeat(-n) + d;',
      '    return r + d.charAt(0) + (k > 1 ? "." + d.substring(1) : "") + "e" + (n - 1 >= 0 ? "+" : "-") + Math.abs(n - 1);',
      '}'];
    case 'kotlin': return [
      'fun fmt(x: Double): String {',
      '    if (x.isNaN()) return "NaN"',
      '    if (x.isInfinite()) return if (x > 0) "Infinity" else "-Infinity"',
      '    if (x == 0.0) return "0.0"',
      '    val s = Math.abs(x).toString()',
      '    val ei = s.indexOf(\'E\')',
      '    val m = if (ei < 0) s else s.substring(0, ei)',
      '    val dot = m.indexOf(\'.\')',
      '    var d = m.replace(".", "")',
      '    var n = (if (dot < 0) m.length else dot) + (if (ei < 0) 0 else s.substring(ei + 1).toInt())',
      '    while (d.length > 1 && d[0] == \'0\') { d = d.substring(1); n-- }',
      '    d = d.trimEnd(\'0\')',
      '    val k = d.length',
      '    val r = if (x < 0) "-" else ""',
      '    return when {',
      '        n in k..21 -> r + d + "0".repeat(n - k) + ".0"',
      '        n in 1..21 -> r + d.substring(0, n) + "." + d.substring(n)',
      '        n in -5..0 -> r + "0." + "0".repeat(-n) + d',
      '        else -> r + d[0] + (if (k > 1) "." + d.substring(1) else "") + "e" + (if (n - 1 >= 0) "+" else "-") + Math.abs(n - 1)',
      '    }',
      '}'];
    case 'rust': return [
      'fn fmt_num(x: f64) -> String {',
      '    if x.is_nan() { return "NaN".to_string(); }',
      '    if x.is_infinite() { return if x > 0.0 { "Infinity".to_string() } else { "-Infinity".to_string() }; }',
      '    if x == 0.0 { return "0.0".to_string(); }',
      '    let s = format!("{:e}", x.abs());',
      '    let (m, e) = s.split_once(\'e\').unwrap();',
      '    let mut d: String = m.chars().filter(|c| *c != \'.\').collect();',
      '    let mut n = m.find(\'.\').unwrap_or(m.len()) as i32 + e.parse::<i32>().unwrap();',
      '    while d.len() > 1 && d.starts_with(\'0\') { d.remove(0); n -= 1; }',
      '    let d = d.trim_end_matches(\'0\').to_string();',
      '    let k = d.len() as i32;',
      '    let r = if x < 0.0 { "-" } else { "" };',
      '    if k <= n && n <= 21 { return format!("{}{}{}.0", r, d, "0".repeat((n - k) as usize)); }',
      '    if 0 < n && n <= 21 { return format!("{}{}.{}", r, &d[..n as usize], &d[n as usize..]); }',
      '    if -6 < n && n <= 0 { return format!("{}0.{}{}", r, "0".repeat((-n) as usize), d); }',
      '    let frac = if k > 1 { format!(".{}", &d[1..]) } else { String::new() };',
      '    format!("{}{}{}e{}{}", r, &d[..1], frac, if n - 1 >= 0 { "+" } else { "-" }, (n - 1).abs())',
      '}'];
    case 'python': return [
      'def fmt_num(x):',
      '    if x != x:',
      '        return "NaN"',
      '    if x in (float("inf"), float("-inf")):',
      '        return "Infinity" if x > 0 else "-Infinity"',
      '    if x == 0:',
      '        return "0.0"',
      '    m, _, e = repr(abs(float(x))).partition("e")',
      '    dot = m.find(".")',
      '    d = m.replace(".", "")',
      '    n = (dot if dot >= 0 else len(m)) + int(e or 0)',
      '    while len(d) > 1 and d[0] == "0":',
      '        d = d[1:]',
      '        n -= 1',
      '    d = d.rstrip("0")',
      '    k = len(d)',
      '    r = "-" if x < 0 else ""',
      '    if k <= n <= 21:',
      '        return r + d + "0" * (n - k) + ".0"',
      '    if 0 < n <= 21:',
      '        return r + d[:n] + "." + d[n:]',
      '    if -6 < n <= 0:',
      '        return r + "0." + "0" * -n + d',
      '    return r + d[0] + ("." + d[1:] if k > 1 else "") + "e" + ("+" if n - 1 >= 0 else "-") + str(abs(n - 1))'];
    default: return [];
  }
}


const TARGETS = {
  python: { label: 'Python', ext: 'py', languageId: 'python' },
  java: { label: 'Java', ext: 'java', languageId: 'java' },
  c: { label: 'C', ext: 'c', languageId: 'c' },
  cpp: { label: 'C++', ext: 'cpp', languageId: 'cpp' },
  csharp: { label: 'C#', ext: 'cs', languageId: 'csharp' },
  javascript: { label: 'JavaScript (Node.js)', ext: 'js', languageId: 'javascript' },
  kotlin: { label: 'Kotlin', ext: 'kt', languageId: 'kotlin' },
  rust: { label: 'Rust', ext: 'rs', languageId: 'rust' },
};

const TYPE_MAP = {
  java: { int: 'int', double: 'double', string: 'String', boolean: 'boolean', char: 'char' },
  c: { int: 'int', double: 'double', string: 'char*', boolean: 'bool', char: 'char' },
  cpp: { int: 'int', double: 'double', string: 'string', boolean: 'bool', char: 'char' },
  csharp: { int: 'int', double: 'double', string: 'string', boolean: 'bool', char: 'char' },
  python: { int: 'int', double: 'float', string: 'str', boolean: 'bool', char: 'str' },
  kotlin: { int: 'Int', double: 'Double', string: 'String', boolean: 'Boolean', char: 'Char' },
  rust: { int: 'i32', double: 'f64', string: 'String', boolean: 'bool', char: 'char' },
};

const SIMPLE_IDENT = P.IDENT_RE;
const TYPED_LANGS = new Set(['java', 'c', 'cpp', 'csharp', 'kotlin', 'rust']);
/** einfachen Ausdruck so lassen, sonst klammern (für b ? "true" : "false") */
const W = (e) => (/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(e) ? e : `(${e})`);

/** genaue Typnamen je Zielsprache (Schlüssel: P.canonType) */
const EXACT_TYPES = {
  java: { int: 'int', long: 'long', short: 'short', byte: 'byte', float: 'float', double: 'double', char: 'char', string: 'String', boolean: 'boolean' },
  csharp: { int: 'int', long: 'long', short: 'short', byte: 'byte', float: 'float', double: 'double', char: 'char', string: 'string', boolean: 'bool' },
  c: { int: 'int', long: 'long long', short: 'short', byte: 'unsigned char', float: 'float', double: 'double', char: 'char', string: 'char*', boolean: 'bool' },
  cpp: { int: 'int', long: 'long long', short: 'short', byte: 'unsigned char', float: 'float', double: 'double', char: 'char', string: 'string', boolean: 'bool' },
  kotlin: { int: 'Int', long: 'Long', short: 'Short', byte: 'Byte', float: 'Float', double: 'Double', char: 'Char', string: 'String', boolean: 'Boolean' },
  rust: { int: 'i32', long: 'i64', short: 'i16', byte: 'u8', float: 'f32', double: 'f64', char: 'char', string: 'String', boolean: 'bool' },
  python: { int: 'int', long: 'int', short: 'int', byte: 'int', float: 'float', double: 'float', char: 'str', string: 'str', boolean: 'bool' },
};
const identsOf = (text) => P.ptoks(text).filter((t, i, a) => t.t === 'id' && !(a[i - 1] && a[i - 1].v === '.')).map((t) => t.v);

/**
 * Gemeinsamer Typ zweier abgeleiteter Typen (z. B. Argumente an verschiedenen Aufrufstellen): Ganzzahl und Kommazahl
 * ergeben Kommazahl, ebenso bei Arrays (int[] und double[] -> double[]). Sonst bleibt der erste.
 */
function widenType(a, b) {
  if (!a) return b;
  if (!b) return a;
  const arr = (t) => /\[\]$/.test(String(t));
  if (arr(a) && arr(b)) { const w = widenType(String(a).slice(0, -2), String(b).slice(0, -2)); return w ? w + '[]' : a; }
  const na = P.normType(a), nb = P.normType(b);
  if (na === nb) return a;
  if ((na === 'int' && nb === 'double') || (na === 'double' && nb === 'int')) return 'double';
  return a;
}

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
    this.warnings = []; // {kind, name} – z. B. Variable mal Text, mal Zahl (nicht übersetzbar in typisierten Sprachen)
    // Variable wechselt Ganzzahl/Kommazahl: jeden Ausdruck mit dem Typ übersetzen, den sie an dieser Stelle hat
    const rawX = this.x.bind(this);
    this.x = (text) => this.withFlowTypes(() => rawX(this.flowRewrite(text)));
    this.I = '    ';
    this.sigs = new Map();
    this.funcs = new Map();
    this.collectTypes();
    for (const r of doc.roots) {
      const sig = P.parseSignature(r.text);
      this.sigs.set(r, sig);
      if (r.rootType !== 'program') this.funcs.set(sig.name, sig);
    }
    // Parametertypen ohne Angabe aus allen Aufrufstellen ableiten: Ganzzahl und Kommazahl ergeben Kommazahl (der
    // Interpreter wandelt Argumente beim Aufruf in diesen Typ um, siehe paramTypes in executor.js)
    this.inferringParams = true;
    for (let pass = 0; pass < 2; pass++) {
      const argTypes = new Map(); // Parameter -> Typen der Argumente
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
                if (!prm || prm.type || !a.length) return;
                const at = P.inferType(joinTokens(a), types, Object.assign(new Map(), { records: this.recordTypes }));
                if (at) argTypes.set(prm, [...(argTypes.get(prm) || []), at]);
              });
            });
          }
        });
      }
      for (const [prm, ts] of argTypes) prm.inferredType = ts.reduce((acc, t) => widenType(acc, t), prm.inferredType || null);
    }
    this.inferringParams = false;
    // Rückgabetypen vorab bestimmen (für Typinferenz bei Aufrufen)
    for (const r of doc.roots) {
      const sig = this.sigs.get(r);
      if (r.rootType !== 'program' && !sig.returnType) sig.inferredReturn = this.inferReturn(r, sig, this.analyze(r, sig).types);
    }
  }

  x(text) {
    // Textverkettung mit Zahlen („x = “ + x) je Sprache mit Umwandlung (Kotlin/Rust haben eigene Templates)
    const cc = this.concat(text);
    if (cc != null) return cc;
    // Ganzzahldivision wird je Division in translateExpr bestimmt (pseudo.js, intDivision)
    return P.translateExpr(text, this.lang, this);
  }

  /**
   * „a“ + x + … mit mindestens einem Text: Teile mit ihrem Typ, sonst null.
   * Nur ein reiner „+“-Ausdruck (keine Vergleiche/Logik auf oberster Ebene).
   */
  concatTerms(text) {
    if (!this.cur) return null;
    const { splitTop } = require('./tokenizer');
    const toks = P.ptoks(text);
    if (findTop(toks, (t) => P.REL_OPS.has(t.v) || ['and', 'or', 'not', 'xor'].includes(String(t.v).toLowerCase()) || t.v === ',') >= 0) return null;
    const terms = splitTop(toks, '+');
    if (terms.length < 2 || terms.some((t) => !t.length)) return null;
    const typed = terms.map((t) => {
      const src = joinTokens(t);
      const lit = t.length === 1 && t[0].t === 'str';
      let ty = lit ? (t[0].v[0] === "'" && t[0].v.length === 3 ? 'string' : 'string') : P.normType(this.exprType(src));
      if (!lit && t.length === 1 && t[0].t === 'id' && P.normType(this.typeOf(t[0].v)) === 'char') ty = 'char';
      return { src, lit, ty, code: lit ? null : this.xPlain(src) };
    });
    // Verkettung erst ab dem ersten Text (1 + 2 + „a“ rechnet zuerst)
    const first = typed.findIndex((t) => t.ty === 'string');
    if (first < 0) return null;
    if (first > 0) {
      const head = typed.slice(0, first + 1);
      if (first > 1) return null; // selten; Zahlen vorn bleiben wie bisher
      return typed;
    }
    return typed;
  }

  /** Ausdruck ohne Verkettungs-Behandlung übersetzen */
  xPlain(text) { return P.translateExpr(text, this.lang, this); }

  concat(text) {
    const L = this.lang;
    if (!['python', 'javascript', 'csharp', 'cpp', 'c', 'java'].includes(L)) return null;
    const terms = this.concatTerms(text);
    if (!terms) return null;
    if (L === 'java') {
      // Java verkettet selbst; nur Kommazahlen wie im Interpreter schreiben (sonst 1.0E-7)
      if (!terms.some((t) => t.ty === 'double')) return null;
      const litOfJ = (t) => P.literalInner(P.ptoks(t.src)[0].v);
      this.needs.add('fmtnum');
      const js = terms.map((t) => (t.lit ? '"' + litOfJ(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : t.ty === 'double' ? `fmt(${t.code})` : this.needsParens(t.src) ? `(${t.code})` : t.code));
      if (!terms[0].lit && terms[0].ty !== 'string') js.unshift('""');
      return js.join(' + ');
    }
    const mixed = terms.some((t) => t.ty !== 'string');
    if (!mixed && L !== 'c' && L !== 'cpp') return null; // nur Texte: die Sprache verkettet selbst
    const litOf = (t) => P.literalInner(P.ptoks(t.src)[0].v);
    const q = (str) => '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    if (L === 'python') {
      const code = (t) => (t.ty === 'double' ? (this.needs.add('fmtnum'), `fmt_num(${t.code})`) : t.code);
      return 'f"' + terms.map((t) => (t.lit ? litOf(t).replace(/\{/g, '{{').replace(/\}/g, '}}').replace(/"/g, '\\"') : `{${code(t).replace(/"/g, "'")}}`)).join('') + '"';
    }
    if (L === 'javascript') {
      return '`' + terms.map((t) => {
        if (t.lit) return litOf(t).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
        if (t.ty === 'double') { this.needs.add('fmtnum'); return '${fmtNum(' + t.code + ')}'; }
        return '${' + t.code + '}';
      }).join('') + '`';
    }
    if (L === 'csharp') {
      return terms.map((t) => {
        if (t.lit) return q(litOf(t));
        if (t.ty === 'double') { this.needs.add('fmtnum'); return `Fmt(${t.code})`; }
        if (t.ty === 'boolean') return `(${t.code} ? "true" : "false")`; // C# schriebe True/False
        return this.needsParens(t.src) ? `(${t.code})` : t.code;
      }).join(' + ');
    }
    if (L === 'cpp') {
      this.needs.add('string');
      return terms.map((t, k) => {
        if (t.lit) return k === 0 ? `string(${q(litOf(t))})` : q(litOf(t));
        if (t.ty === 'double') { this.needs.add('fmtdouble'); return `fmt_double(${t.code})`; }
        if (t.ty === 'int') return `to_string(${t.code})`;
        if (t.ty === 'char') return `string(1, ${t.code})`;
        if (t.ty === 'boolean') return `string(${t.code} ? "true" : "false")`;
        return k === 0 ? `string(${t.code})` : (this.needsParens(t.src) ? `(${t.code})` : t.code);
      }).join(' + ');
    }
    // C: Hilfsfunktionen (neuer Speicher je Verkettung)
    this.needs.add('strcat');
    this.needs.add('string');
    const parts = terms.map((t) => {
      if (t.lit) return q(litOf(t));
      if (t.ty === 'double') { this.needs.add('fmtdouble'); return `fmt_double(${t.code})`; }
      if (t.ty === 'int') return `str_int(${t.code})`;
      if (t.ty === 'char') return `str_chr(${t.code})`;
      if (t.ty === 'boolean') return `(${t.code} ? "true" : "false")`;
      return t.code;
    });
    return parts.slice(1).reduce((acc, p) => `str_cat(${acc}, ${p})`, parts[0]);
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
    fnTypes.records = this.recordTypes; // Feldtypen für p.x (inferType, fieldAccess)
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
    // Typ aus der Verwendung ableiten – wie der Interpreter (Structorizer): eine Eingabe ist eine Zahl, wenn mit ihr
    // gerechnet oder sie mit einer Zahl verglichen wird, sonst Text. Die Regeln laufen, bis sich nichts mehr ändert.
    const ARITH = new Set(['-', '*', '/', '%', 'div', 'mod']);
    const REL = new Set(['<', '>', '<=', '>=', '=', '<>', '!=', '==']);
    const inputVars = new Set();
    const cands = new Set(); // Variablen, deren Typ abgeleitet werden darf
    const exprs = [], assigns = [], cases = [], eachs = [];
    walk(root.children, (el) => {
      if (el.disabled) return false;
      if (el.type === 'for') {
        const f = P.parseForText(linesOf(el).join(' '));
        if (f && f.kind === 'count') [f.start, f.end].forEach((e) => { const toks = P.ptoks(e); if (toks.length === 1 && toks[0].t === 'id' && !types.get(toks[0].v) && !explicit.has(toks[0].v)) types.set(toks[0].v, 'int'); else exprs.push(e); });
        if (f && f.kind === 'each' && SIMPLE_IDENT.test(f.var)) { cands.add(f.var); eachs.push([f.var, f.coll]); }
        return;
      }
      if (['instruction', 'call', 'jump'].includes(el.type)) {
        for (const line of linesOf(el)) {
          const c = P.classifyLine(line);
          if (c.kind === 'input') c.vars.forEach((v) => { if (SIMPLE_IDENT.test(v)) { inputVars.add(v); cands.add(v); } });
          else if (c.kind === 'assign') {
            exprs.push(c.expr);
            if (SIMPLE_IDENT.test(c.target)) { assigns.push([c.target, c.expr]); cands.add(c.target); }
          } else if (c.kind === 'output') c.items.forEach((i) => exprs.push(i));
          else if (c.kind !== 'decl') exprs.push(c.expr || line);
        }
        return;
      }
      if (el.type === 'case') {
        const disc = String(el.text[0] || '');
        const vals = this.caseInfo(el).flatMap((b) => b.values);
        exprs.push(disc);
        // Marken wie Bedingungen betrachten: bei „case true of gewicht <= 20“ steht der Vergleich in der Marke
        exprs.push(...vals);
        cases.push([disc, vals]);
        return;
      }
      // Bedingungen von Verzweigung und Schleifen
      if (['alternative', 'while', 'repeat'].includes(el.type)) exprs.push(linesOf(el).join(' '));
    });
    for (const n of explicit) cands.delete(n);
    for (const n of params) cands.delete(n);
    const open = (n) => cands.has(n) && !types.get(n);
    const num = (t) => t === 'int' || t === 'double';
    const typeOfToks = (toks) => { try { return toks.length ? P.normType(P.inferType(joinTokens(toks), types, fnTypes)) : null; } catch (e) { return null; } };
    const isStrLit = (toks) => toks.length === 1 && toks[0].t === 'str';
    // Operand neben Position k (Richtung dir): einzelnes Token, Klammergruppe, Aufruf oder Index
    const operandAt = (toks, k, dir) => {
      if (dir > 0) {
        let j = k;
        while (toks[j] && toks[j].t === 'op' && (toks[j].v === '-' || toks[j].v === '+')) j++;
        if (!toks[j]) return [];
        let e = j + 1;
        if (toks[j].t === 'op' && toks[j].v === '(') e = matchClose(toks, j) + 1;
        else if (toks[j].t === 'id' && toks[j + 1] && (toks[j + 1].v === '(' || toks[j + 1].v === '[')) e = matchClose(toks, j + 1) + 1;
        return e > j ? toks.slice(j, e) : [];
      }
      const t = toks[k];
      if (!t) return [];
      if (t.t === 'op' && (t.v === ')' || t.v === ']')) {
        let depth = 0, j = k;
        for (; j >= 0; j--) {
          if (toks[j].v === ')' || toks[j].v === ']') depth++;
          else if (toks[j].v === '(' || toks[j].v === '[') { depth--; if (!depth) break; }
        }
        if (j > 0 && toks[j - 1].t === 'id') j--;
        return j >= 0 ? toks.slice(j, k + 1) : [];
      }
      return [t];
    };
    // Schleifenvariablen von foreach bekommen ihren Typ nur aus der Sammlung (z = "n" macht aus dem Zeichen keinen Text)
    const eachVars = new Set(eachs.map((e) => e[0]));
    const set = (n, t, fromEach) => { if (!open(n) || !t || (eachVars.has(n) && !fromEach)) return false; types.set(n, t); return true; };
    const opOf = (x) => x && (x.t === 'op' ? x.v : x.t === 'id' && ['div', 'mod'].includes(x.v.toLowerCase()) ? x.v.toLowerCase() : null);
    let weak = false; // zweite Stufe: a + b mit zwei unbekannten Eingaben gilt als Rechnung
    // In einer Summe, die einer Kommazahl zugewiesen wird (umfang := a + b + c), sind die Eingaben Kommazahlen –
    // außer sie werden direkt mit einer Kommazahl malgenommen/geteilt (kinderanzahl * 0.02 bleibt ganzzahlig).
    const toDouble = (expr) => {
      const toks = P.ptoks(expr);
      let changed = false;
      const stack = []; // Klammern: true = Aufruf/Index (Argumente nicht betrachten)
      toks.forEach((t, i) => {
        if (t.t === 'op' && OPEN[t.v]) { stack.push(t.v === '[' || (t.v === '(' && toks[i - 1] && toks[i - 1].t === 'id')); return; }
        if (t.t === 'op' && CLOSE[t.v]) { stack.pop(); return; }
        if (stack.some(Boolean) || t.t !== 'id' || !open(t.v) || (toks[i + 1] && (toks[i + 1].v === '(' || toks[i + 1].v === '['))) return;
        const dbl = (x) => x && ((x.t === 'num' && /[.eE]/.test(x.v)) || (x.t === 'id' && x.v.toLowerCase() === 'pi' && !types.has(x.v)));
        const mul = (x) => x && x.t === 'op' && (x.v === '*' || x.v === '/');
        if ((mul(toks[i - 1]) && dbl(toks[i - 2])) || (mul(toks[i + 1]) && dbl(toks[i + 2]))) return;
        changed = set(t.v, 'double') || changed;
      });
      return changed;
    };
    const step = () => {
      let changed = false;
      // foreach w in werte: Elementtyp der Sammlung (Text: einzelne Zeichen) – zuerst, er ist eindeutig
      for (const [v, coll] of eachs) {
        if (!open(v)) continue;
        const ct = P.normType(P.inferType(coll, types, fnTypes));
        if (ct && ct.endsWith('[]')) changed = set(v, ct.slice(0, -2), true) || changed;
        else if (ct === 'string') changed = set(v, 'char', true) || changed;
      }
      for (const [target, expr] of assigns) if (P.normType(types.get(target)) === 'double') changed = toDouble(expr) || changed;
      for (const e of exprs) {
        const toks = P.ptoks(e);
        toks.forEach((t, i) => {
          if (t.t !== 'id' || !open(t.v) || (toks[i - 1] && toks[i - 1].v === '.')) return;
          if (toks[i + 1] && (toks[i + 1].v === '(' || toks[i + 1].v === '[')) return;
          const prev = toks[i - 1], before = toks[i - 2];
          // einstelliges Minus: -x
          if (prev && prev.v === '-' && (!before || (before.t === 'op' && before.v !== ')' && before.v !== ']') ||
              (before.t === 'id' && ['and', 'or', 'not'].includes(before.v.toLowerCase())))) { changed = set(t.v, 'int') || changed; return; }
          for (const [op, other] of [[opOf(toks[i + 1]), operandAt(toks, i + 2, 1)], [opOf(prev), operandAt(toks, i - 2, -1)]]) {
            if (!op || !open(t.v)) continue;
            const ot = typeOfToks(other);
            if (ARITH.has(op)) changed = set(t.v, 'int') || changed;
            else if (op === '+') {
              // „x = “ + x ist kein Hinweis auf Text: eine Zahl lässt sich an Text anhängen (Verkettung wandelt um)
              if (num(ot)) changed = set(t.v, 'int') || changed;
              else if (weak && other.length === 1 && other[0].t === 'id' && cands.has(other[0].v)) changed = set(t.v, 'int') || changed;
            } else if (REL.has(op)) {
              if (ot === 'string' || ot === 'char' || isStrLit(other)) changed = set(t.v, 'string') || changed;
              else if (num(ot)) changed = set(t.v, ot) || changed;
              else if (ot === 'boolean') changed = set(t.v, 'boolean') || changed;
            }
          }
        });
      }
      // Argumente: eigenes Unterprogramm -> Parametertyp; int/trunc/round/floor/ceil(x) -> Kommazahl (sonst gäbe es
      // nichts umzuwandeln); sqrt/abs/sin … -> Zahl
      for (const e of exprs) {
        const toks = P.ptoks(e);
        toks.forEach((t, i) => {
          if (t.t !== 'id' || !toks[i + 1] || toks[i + 1].v !== '(' || (toks[i - 1] && toks[i - 1].v === '.')) return;
          const close = matchClose(toks, i + 1);
          if (close < 0) return;
          const args = require('./tokenizer').splitTop(toks.slice(i + 2, close), ',');
          const l = t.v.toLowerCase();
          args.forEach((a, k) => {
            if (a.length !== 1 || a[0].t !== 'id' || !open(a[0].v)) return;
            let want = null;
            if (this.funcs.has(t.v)) { const prm = this.funcs.get(t.v).params[k]; want = prm && P.normType(prm.type); }
            else if (['int', 'trunc', 'round', 'floor', 'ceil'].includes(l)) want = 'double';
            else if (['sqrt', 'abs', 'sin', 'cos', 'tan', 'exp', 'log', 'ln', 'pow', 'power', 'sgn', 'sqr'].includes(l)) want = 'int';
            if (want) changed = set(a[0].v, want) || changed;
          });
        });
      }
      // Zuweisungen in beide Richtungen: x := ausdruck  bzw.  temp := name (temp bekannt -> name)
      for (const [target, expr] of assigns) {
        if (open(target)) { const t = P.normType(P.inferType(expr, types, fnTypes)); if (t && t !== 'char') changed = set(target, t) || changed; }
        const et = P.ptoks(expr);
        if (et.length === 1 && et[0].t === 'id' && open(et[0].v) && types.get(target)) changed = set(et[0].v, P.normType(types.get(target))) || changed;
      }
      // Fallauswahl: die Marken bestimmen den Typ des Ausdrucks
      for (const [disc, vals] of cases) {
        const dt = P.ptoks(disc);
        if (dt.length !== 1 || dt[0].t !== 'id' || !open(dt[0].v)) continue;
        const lt = vals.map((v) => P.ptoks(v)).filter((x) => x.length === 1).map((x) => x[0]);
        if (lt.some((x) => x.t === 'str')) changed = set(dt[0].v, 'string') || changed;
        else if (lt.some((x) => x.t === 'num')) changed = set(dt[0].v, lt.some((x) => /[.eE]/.test(x.v)) ? 'double' : 'int') || changed;
      }
      return changed;
    };
    const settle = () => { for (let k = 0; k < 20 && step(); k++); };
    settle();
    weak = true;
    settle();
    // Eingaben ohne Hinweis auf eine Zahl bleiben Text (wie im Interpreter)
    let more = false;
    for (const v of inputVars) if (open(v)) { types.set(v, 'string'); more = true; }
    if (more) settle();

    // Zählvariablen, die auch außerhalb einer Schleife über sich selbst vorkommen (davor zugewiesen oder danach gelesen):
    // Sie gehören der ganzen Routine. Die Schleife zählt dann mit einer Hilfsvariable und setzt die Zählvariable in
    // jedem Durchlauf – danach hat sie wie im Interpreter den Wert des letzten Durchlaufs (auch nach leave).
    // Alle anderen deklariert jede Schleife in ihrem Kopf selbst (zwei Schleifen nacheinander mit demselben i).
    const loopVars = new Set();
    const outsideUse = new Set();
    const scanUse = (seq, active) => {
      for (const el of seq) {
        if (el.disabled) continue;
        const f = el.type === 'for' ? P.parseForText(linesOf(el).join(' ')) : null;
        if (f && (f.kind === 'count' || f.kind === 'each') && SIMPLE_IDENT.test(f.var)) {
          loopVars.add(f.var);
          identsOf(f.kind === 'count' ? `${f.start} ${f.end} ${f.step}` : f.coll).forEach((n) => { if (!active.has(n)) outsideUse.add(n); });
          scanUse(el.body, new Set([...active, f.var]));
          continue;
        }
        for (const line of linesOf(el)) identsOf(line).forEach((n) => { if (!active.has(n)) outsideUse.add(n); });
        for (const s of require('./model').sequencesOf(el)) scanUse(s.seq, active);
      }
    };
    scanUse(root.children, new Set());
    const loopOuter = new Set([...loopVars].filter((v) => outsideUse.has(v) && !explicit.has(v) && !params.has(v)));

    // Pass 2: Deklarationsorte bestimmen
    const seen = new Set(params);
    const inline = new Map();
    const hoist = new Set();
    const forDecl = new Map();
    const all = new Set();
    const note = (el, name) => { if (!inline.has(el)) inline.set(el, new Set()); inline.get(el).add(name); };
    // var x: double in einer Verzweigung/Schleife gilt im Interpreter für die ganze Routine (wie im Structorizer):
    // Deklaration an den Anfang ziehen, an der Stelle bleibt nur die Zuweisung des Anfangswerts
    const hoistDecl = new Set();
    walk(root.children, (el, depth) => {
      if (el.disabled) return false;
      if (['instruction', 'call', 'jump'].includes(el.type)) {
        for (const line of linesOf(el)) {
          const c = P.classifyLine(line);
          const assigned = [];
          if (c.kind === 'decl') c.decls.forEach((d) => {
            seen.add(d.name); all.add(d.name);
            if (depth > 0 && !c.isConst && !d.suffix && SIMPLE_IDENT.test(d.name)) { hoist.add(d.name); hoistDecl.add(d.name); }
          });
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
          if (loopOuter.has(f.var)) {
            // Variable der Routine: einmal deklarieren (am Anfang, falls nicht schon vorher zugewiesen)
            forDecl.set(el, false);
            if (!seen.has(f.var)) hoist.add(f.var);
            seen.add(f.var);
          } else forDecl.set(el, !explicit.has(f.var) && !params.has(f.var));
          identsOf(f.kind === 'count' ? `${f.start} ${f.end} ${f.step}` : f.coll).forEach((n) => seen.add(n));
        }
      } else if (el.type !== 'repeat') {
        // Bedingung der fußgesteuerten Schleife wird erst nach dem Rumpf ausgewertet: ihre Variablen (repeat INPUT x
        // until x > 0) nicht vorab als „verwendet“ zählen, sonst entfiele die Deklaration im Rumpf
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
    // Ganzzahlen, die sich selbst multiplizieren (f := f * i – Fakultät, Potenz, Produkt), überschreiten schnell 32 Bit:
    // 64-Bit-Ganzzahl (long, long long, Long, i64); einfache Kopien davon (x := f) ebenso
    const long = new Set();
    const asg = [];
    walk(root.children, (el) => {
      if (el.disabled) return false;
      if (el.type !== 'instruction') return;
      for (const line of linesOf(el)) { const c = P.classifyLine(line); if (c.kind === 'assign' && SIMPLE_IDENT.test(c.target.trim())) asg.push([c.target.trim(), c.expr]); }
    });
    const intVar = (n) => !explicit.has(n) && !params.has(n) && P.normType(types.get(n)) === 'int';
    for (const [n, e] of asg) {
      const toks = P.ptoks(e);
      if (intVar(n) && toks.some((t) => t.t === 'id' && t.v === n) && findTop(toks, (t) => t.v === '*') >= 0) long.add(n);
    }
    for (let more = true; more;) {
      more = false;
      for (const [n, e] of asg) if (!long.has(n) && intVar(n) && long.has(e.trim())) { long.add(n); more = true; }
    }
    for (const n of long) rawTypes.set(n, 'long');
    // Typwechsel wie im Interpreter (x := 5 … x := 2.5): gespeichert als Kommazahl, solange sie eine Ganzzahl ist,
    // wird sie beim Rechnen und Ausgeben umgewandelt (switching). Text und Zahl lassen sich nicht vereinen (mixed).
    const switching = new Set();
    const mixed = new Set();
    const kinds = new Map();
    for (const [n, e] of asg) {
      if (explicit.has(n) || params.has(n)) continue;
      let et = null;
      try { et = P.normType(P.inferType(e, types, fnTypes)); } catch (err) { et = null; }
      if (et === 'int' && P.normType(types.get(n)) === 'double') switching.add(n);
      const k = et === 'string' ? 'text' : et === 'int' || et === 'double' ? 'number' : null;
      if (k) { if (!kinds.has(n)) kinds.set(n, new Set()); kinds.get(n).add(k); }
    }
    for (const [n, ks] of kinds) if (ks.size > 1) mixed.add(n);
    return { types, rawTypes, explicit, params, inline, hoist, hoistDecl, forDecl, loopOuter, all, declared: new Set(), fnTypes,
      switching, mixed, flow: new Map(), flowLock: new Set() };
  }

  defaultParamType() { return 'int'; }

  /** Ist die Variable an dieser Stelle eine Ganzzahl, obwohl sie als Kommazahl gespeichert ist? */
  flowIsInt(n) {
    const c = this.cur;
    return !!(c && c.switching && c.switching.has(n) && !c.flowLock.has(n) && c.flow.get(n) === 'int');
  }

  /** Typisierte Sprachen: x -> int(x), solange x an dieser Stelle eine Ganzzahl ist */
  flowRewrite(text) {
    const c = this.cur;
    if (text == null || this.flowOff || DYNAMIC_LANGS.has(this.lang) || !c || !c.switching || !c.switching.size) return text;
    const toks = P.ptoks(String(text));
    let hit = false;
    const out = toks.map((t, i) => {
      if (t.t !== 'id' || !this.flowIsInt(t.v)) return t;
      const prev = toks[i - 1], next = toks[i + 1];
      if ((prev && prev.v === '.') || (next && (next.v === '(' || next.v === '['))) return t;
      // schon umgewandelt: int(x)
      if (prev && prev.v === '(' && toks[i - 2] && toks[i - 2].t === 'id' && toks[i - 2].v.toLowerCase() === 'int' && next && next.v === ')') return t;
      hit = true;
      return { ...t, v: `int(${t.v})` };
    });
    return hit ? joinTokens(out) : text;
  }

  /** Python/JavaScript: Variablen haben dort ihren aktuellen Typ – während fn() mit diesem rechnen */
  withFlowTypes(fn) {
    const c = this.cur;
    if (!DYNAMIC_LANGS.has(this.lang) || !c || !c.switching || !c.switching.size) return fn();
    const saved = [];
    for (const n of c.switching) if (this.flowIsInt(n)) { saved.push([n, c.types.get(n)]); c.types.set(n, 'int'); }
    try { return fn(); } finally { for (const [n, t] of saved) c.types.set(n, t); }
  }

  /** Variablen, die ein Element (mit allen Unterelementen) setzt */
  assignedIn(el) {
    const set = new Set();
    walk([el], (e) => {
      if (e.type === 'for') { const f = P.parseForText(linesOf(e).join(' ')); if (f && f.var) set.add(f.var); return; }
      if (!['instruction', 'call', 'jump'].includes(e.type)) return;
      for (const l of linesOf(e)) {
        const c = P.classifyLine(l);
        if (c.kind === 'assign') c.target.split(',').forEach((t) => set.add(t.trim()));
        else if (c.kind === 'input') (c.vars || []).forEach((v) => set.add(v));
      }
    });
    return set;
  }

  /** Anweisung mit schrittweisem Typ (Ganzzahl/Kommazahl) und Warnung bei Text/Zahl übersetzen */
  flowStmt(c, ind, el, line) {
    const cur = this.cur;
    // vorgezogene Deklaration (siehe analyze): hier nur den Anfangswert zuweisen
    if (c.kind === 'decl' && cur && cur.hoistDecl && c.decls.some((d) => cur.hoistDecl.has(d.name))) {
      const out = [];
      const rest = c.decls.filter((d) => !cur.hoistDecl.has(d.name));
      if (rest.length) out.push(...this.flowStmt({ ...c, decls: rest }, ind, el, null));
      for (const d of c.decls) {
        if (!cur.hoistDecl.has(d.name) || d.init == null || d.init === '') continue;
        out.push(...this.flowStmt({ kind: 'assign', target: d.name, expr: d.init }, ind, el, null));
      }
      return out;
    }
    if (!cur || ((!cur.switching || !cur.switching.size) && (!cur.mixed || !cur.mixed.size))) return this.stmt(c, ind, el);
    const dyn = DYNAMIC_LANGS.has(this.lang);
    const run = (cc) => this.withFlowTypes(() => this.stmt(cc, ind, el));
    if (c.kind === 'input') {
      for (const v of c.vars || []) if (cur.switching.has(v) && !cur.flowLock.has(v)) cur.flow.set(v, 'double');
      return run(c);
    }
    if (c.kind === 'assign') {
      const n = c.target.trim();
      let rhs = dyn ? c.expr : this.flowRewrite(c.expr);
      const pre = [];
      // Text in einer Zahl-Variable (oder umgekehrt): typisierte Sprachen können das nicht – Hinweis im Code
      if (!dyn && cur.mixed.has(n)) {
        let et = null;
        try { et = P.normType(this.exprType(rhs)); } catch (err) { et = null; }
        const vt = P.normType(this.declType(n));
        const cat = (t) => (t === 'string' ? 'text' : t === 'int' || t === 'double' ? 'number' : null);
        if (cat(et) && cat(vt) && cat(et) !== cat(vt)) {
          pre.push(ind + this.comment(tr(cat(et) === 'text' ? 'gen.typeMixText' : 'gen.typeMixNumber', n, TARGETS[this.lang].label)));
          if (!this.warnings.some((w) => w.name === n)) this.warnings.push({ kind: 'typeMix', name: n });
        }
      }
      if (!cur.switching.has(n)) {
        this.flowOff = true;
        try { return [...pre, ...run({ ...c, expr: rhs })]; } finally { this.flowOff = false; }
      }
      let rt = null;
      try { rt = P.normType(this.withFlowTypes(() => this.exprType(rhs))); } catch (err) { rt = null; }
      const now = rt === 'int' ? 'int' : 'double';
      // Kotlin/Rust wandeln Ganzzahlen nicht von selbst in Kommazahlen
      if (!dyn && now === 'int' && (this.lang === 'kotlin' || this.lang === 'rust') && !/^-?\d+$/.test(rhs.trim())) rhs = `float(${rhs})`;
      // der neue Typ gilt schon für die Zuweisung selbst (Python: x = 5 bleibt Ganzzahl, nicht 5.0)
      if (!cur.flowLock.has(n)) cur.flow.set(n, now);
      this.flowOff = true;
      this.noNarrow = !dyn && now === 'int' && (this.lang === 'kotlin' || this.lang === 'rust');
      let res;
      try { res = run({ ...c, expr: rhs }); } finally { this.flowOff = false; this.noNarrow = false; }
      return [...pre, ...res];
    }
    if (!dyn && c.kind !== 'decl' && line != null) {
      const r = this.flowRewrite(line);
      if (r !== line) c = P.classifyLine(r);
    }
    return run(c);
  }

  inferReturn(root, sig, types) {
    let t = null, any = false;
    const fnTypes = new Map([...this.funcs].map(([k, v]) => [k, { returnType: v.returnType || v.inferredReturn }]));
    fnTypes.records = this.recordTypes; // Feldtypen für p.x (inferType, fieldAccess)
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
    if (this.noNarrow) return code; // schon passend umgewandelt (Typwechsel Ganzzahl -> Kommazahl)
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
  /** Ist der Ausdruck eine Kommazahl? (für die Ausgabe wie im Interpreter: 80.0, 0.1) */
  isDouble(expr) { return P.normType(this.exprType(expr)) === 'double'; }
  /** Wahrheitswert? (Ausgabe wie im Interpreter als true/false) */
  isBool(expr) { return P.normType(this.exprType(expr)) === 'boolean'; }

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

  /**
   * Wird diese Schleife von einem „leave n“ (n > 1) weiter innen verlassen – oder von einem einfachen „leave“ in einer
   * Fallauswahl? In C, C++, C#, Java und JavaScript verließe break dort nur das switch (Endlosschleife).
   */
  loopNeedsLabel(loop) {
    const LOOPS = ['for', 'while', 'repeat', 'forever'];
    const switchBreaks = SWITCH_BREAK_LANGS.has(this.lang);
    const leave1 = (e) => { const ls = linesOf(e); return !ls.length || ls.some((l) => { const c = P.classifyLine(l); return c.kind === 'leave' && c.count === 1; }); };
    const scan = (seq, d, inCase) => seq.some((e) => {
      if (e.type === 'jump' && linesOf(e).some((l) => { const c = P.classifyLine(l); return c.kind === 'leave' && c.count > 1 && c.count === d + 1; })) return true;
      if (e.type === 'jump' && switchBreaks && inCase && d === 0 && leave1(e)) return true;
      if (LOOPS.includes(e.type)) return scan(e.body, d + 1, false);
      return require('./model').sequencesOf(e).some((s) => scan(s.seq, d, inCase || e.type === 'case'));
    });
    return scan(loop.body || [], 0, false);
  }

  /**
   * Bedingung der innersten Schleife, wenn sie eine Fußschleife (repeat … until) ist, sonst null. Python und Rust bilden
   * sie als Endlosschleife mit Prüfung am Ende des Rumpfs nach – ein continue muss vorher selbst prüfen.
   */
  innerRepeatCond() {
    const k = this.loopEls;
    const top = k && k[k.length - 1];
    return top && top.type === 'repeat' ? this.cond(top.text, ['until', 'bis', 'solange']) : null;
  }

  /** Elemente, die tatsächlich Code erzeugen (nicht deaktiviert) */
  activeEls(seq) { return (seq || []).filter((e) => !e.disabled); }

  /**
   * Zählvariable, die der ganzen Routine gehört (auch außerhalb der Schleife benutzt, siehe analyze): Name der
   * Hilfsvariable, mit der die Schleife zählt – sonst null. Python braucht sie nicht (Variable bleibt nach for erhalten).
   */
  loopHidden(v) {
    return this.lang !== 'python' && this.cur && this.cur.loopOuter && this.cur.loopOuter.has(v) ? '_' + v : null;
  }

  /**
   * Code im try-Teil erzeugen: Division und Rest werden dort geprüft (C, C++, JavaScript; siehe intDivision in pseudo.js),
   * damit Division durch 0 wie im Interpreter abgefangen werden kann
   */
  checked(fn) {
    this.checkDiv = (this.checkDiv || 0) + 1;
    try { return fn(); } finally { this.checkDiv--; }
  }

  /** Unterprogramme, die (auch über weitere Aufrufe) aus einem try-Teil heraus aufgerufen werden: dort ebenfalls prüfen */
  checkedRoutines() {
    if (this._checkedRoutines) return this._checkedRoutines;
    const callsIn = (seq) => {
      const names = new Set();
      walk(seq, (el) => {
        if (el.disabled) return false;
        for (const line of linesOf(el)) {
          const toks = P.ptoks(line);
          toks.forEach((t, i) => { if (t.t === 'id' && this.funcs.has(t.v) && toks[i + 1] && toks[i + 1].v === '(') names.add(t.v); });
        }
      });
      return names;
    };
    const res = new Set();
    const queue = [];
    for (const r of this.doc.roots) {
      walk(r.children, (el) => { if (el.disabled) return false; if (el.type === 'try') for (const n of callsIn(el.qTry)) queue.push(n); });
    }
    const byName = new Map(this.doc.roots.filter((r) => r.rootType !== 'program').map((r) => [this.sigs.get(r).name, r]));
    while (queue.length) {
      const n = queue.pop();
      if (res.has(n)) continue;
      res.add(n);
      const r = byName.get(n);
      if (r) for (const m of callsIn(r.children)) queue.push(m);
    }
    return (this._checkedRoutines = res);
  }

  /** Sprung aus try-Blöcken heraus – C und Rust brauchen Vorarbeit (CFamily.tryExit, RustGen.tryExit) */
  tryExit() { return null; }

  /** Steht die Ausgabe gerade in einem switch innerhalb der innersten Schleife? (dann verließe break nur das switch) */
  inSwitchOfLoop() {
    const s = this.switchCounts;
    return SWITCH_BREAK_LANGS.has(this.lang) && !!s && s.length > 0 && s[s.length - 1] > 0;
  }

  /** Rumpf eines switch erzeugen und dabei mitzählen, dass ein leave hier die Schleife per Sprungmarke verlassen muss */
  inSwitch(fn) {
    const s = this.switchCounts;
    if (s && s.length) s[s.length - 1]++;
    try { return fn(); } finally { if (s && s.length) s[s.length - 1]--; }
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
      case 'c': case 'cpp': case 'csharp': return [ind + `goto ${label};`];
      case 'python': return [ind + `raise _Leave${label}()`];
      default: return [ind + this.comment(tr('gen.leaveN', count)), ...this.stmt({ kind: 'leave' }, ind)];
    }
  }

  el(el, ind) {
    const sw = this.cur && this.cur.switching;
    if (!sw || !sw.size || ['instruction', 'call', 'jump'].includes(el.type)) return this.elPlain(el, ind);
    // Variablen, die in einer Schleife oder Verzweigung gesetzt werden, haben dort und danach keinen eindeutigen Typ:
    // als Kommazahl behandeln (bisheriges Verhalten)
    const added = [...this.assignedIn(el)].filter((n) => sw.has(n) && !this.cur.flowLock.has(n));
    added.forEach((n) => { this.cur.flowLock.add(n); this.cur.flow.set(n, 'double'); });
    try { return this.elPlain(el, ind); } finally { added.forEach((n) => this.cur.flowLock.delete(n)); }
  }

  elPlain(el, ind) {
    const LOOPS = ['for', 'while', 'repeat', 'forever'];
    if (LOOPS.includes(el.type) && !el.disabled) {
      const label = this.loopNeedsLabel(el) ? `L${(this.labelCount = (this.labelCount || 0) + 1)}` : null;
      this.loopStack = this.loopStack || [];
      this.loopStack.push(label);
      this.switchCounts = this.switchCounts || [];
      this.switchCounts.push(0);
      this.loopEls = this.loopEls || [];
      this.loopEls.push(el);
      let out;
      try { out = this.elInner(el, ind); } finally { this.loopStack.pop(); this.switchCounts.pop(); this.loopEls.pop(); }
      if (label) {
        const k = out.findIndex((l) => l.startsWith(ind) && !l.slice(ind.length).startsWith(this.comment('').trim()));
        const pre = { java: `${label}: `, javascript: `${label}: `, kotlin: `${label}@ `, rust: `'${label.toLowerCase()}: ` }[this.lang];
        if (pre && k >= 0) out[k] = ind + pre + out[k].slice(ind.length);
        if (['c', 'cpp', 'csharp'].includes(this.lang)) out.push(ind + `${label}: ;`);
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
        // leave in einer Fallauswahl (switch) verlässt die Schleife über deren Sprungmarke, nicht nur das switch
        const leaveSwitch = () => (this.inSwitchOfLoop() ? this.leaveN(1, ind) : null);
        // C: Sprung aus einem try-Block heraus (Sprungpunkt zurücksetzen, finally ausführen)
        const viaTry = (c, jump) => (['return', 'leave', 'continue'].includes(c.kind) && this.tryExit(c, ind, jump)) || jump();
        if (el.type === 'jump' && !lines.length) {
          const c = { kind: 'leave', count: 1 };
          out.push(...viaTry(c, () => leaveSwitch() || this.stmt(c, ind, el)));
        }
        for (const l of lines) {
          const pl = this.procLine(l);
          if (pl == null) continue;
          const c = P.classifyLine(pl);
          if (c.kind === 'typedef') continue; // Typdefinitionen stehen am Dateianfang (typeDefs)
          const multi = c.kind === 'leave' ? (c.count > 1 ? this.leaveN(c.count, ind) : leaveSwitch()) : null;
          out.push(...viaTry(c, () => multi || this.flowStmt(c, ind, el, pl)));
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
   * randomize() entfällt (null).
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
      case 'insert': return args.length !== 3 ? line : `${args[1]} := insert(${args.join(', ')})`;
      case 'delete': return args.length !== 3 ? line : `${args[0]} := delete(${args.join(', ')})`;
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
    const py = this.lang === 'python';
    return { int: '0', double: '0.0', string: '""', boolean: py ? 'False' : 'false', char: "' '" }[n] || (py ? 'None' : '0');
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
      let values = isLast ? [] : splitTop(P.ptoks(label), ',').map(joinTokens).filter(Boolean);
      // Fallauswahl über Text: 'G' als Text-Marke "G" (sonst in Java, C#, Kotlin, Rust … ein einzelnes Zeichen)
      const discText = String(el.text[0] || '').trim();
      // Fallauswahl über ein Zeichen (foreach z in wort: case z of "a", "e"): Marken als Zeichen-Literale 'a'
      if (this.cur && TYPED_LANGS.has(this.lang) && SIMPLE_IDENT.test(discText) && P.normType(this.typeOf(discText)) === 'char') {
        values = values.map((v) => (/^"(?:[^"\\]|\\.)"$/.test(v) ? `'${v.slice(1, -1) === "'" ? "\\'" : v.slice(1, -1)}'` : v));
      } else if (this.cur && TYPED_LANGS.has(this.lang) && P.normType(this.exprType(discText)) === 'string') {
        values = values.map((v) => (/^'(?:[^'\\]|\\.)'$/.test(v) ? `"${v.slice(1, -1) === '"' ? '\\"' : v.slice(1, -1)}"` : v));
      }
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
    const BOOL = ['true', 'false', 'wahr', 'falsch'];
    if (!BOOL.includes(lit)) {
      // „case a = 0 of true: … false: …“ – Bedingung als Ausdruck, Marken true/false: if/else
      const info = this.caseInfo(el);
      const vals = info.filter((b) => !b.isDefault).flatMap((b) => b.values.map((v) => v.toLowerCase()));
      if (!vals.length || !vals.every((v) => BOOL.includes(v))) return null;
      const disc = String(el.text[0] || '').trim();
      return info.map((b) => {
        if (b.isDefault) return { cond: null, body: b.body, isDefault: true };
        const t = b.values.some((v) => /^(true|wahr)$/i.test(v)), f = b.values.some((v) => /^(false|falsch)$/i.test(v));
        return { cond: t && f ? 'true' : t ? disc : P.negateCond(disc), body: b.body, isDefault: false };
      });
    }
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
    // genauer Typ aus der Analyse (z. B. long für f := f * i), wenn er zum vereinheitlichten passt
    const raw = this.cur && this.cur.rawTypes && SIMPLE_IDENT.test(name) ? this.cur.rawTypes.get(name) : null;
    if (raw && P.canonType(raw) && P.normType(raw) === P.normType(type)) type = raw;
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
    if (L === 'c' && P.normType(type) === 'string' && this.cur && this.cur.charArrays.has(name)) { tn = 'char'; nm = name + '[256]'; this.needs.add('string'); if (init != null) return P.isStringLiteral(String(init)) ? `${tn} ${nm} = ${init};` : `${tn} ${nm}; strcpy(${name}, ${init});`; }
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
        // C: Text in ein char-Array kopieren (= würde nur Zeiger setzen bzw. ist bei Arrays nicht erlaubt)
        if (L === 'c' && this.cur.charArrays.has(n) && (P.isStringLiteral(c.expr) || P.normType(this.exprType(c.expr)) === 'string')) { this.needs.add('string'); return [ind + `strcpy(${n}, ${this.x(c.expr)});`]; }
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
        // zeilenweise lesen: nextInt() ließe den Zeilenumbruch stehen (das nächste nextLine() wäre leer),
        // nextDouble() erwartet in deutscher Ländereinstellung ein Komma
        const ln = 'scanner.nextLine().trim()';
        // Ganzzahl: Kommazahl wird abgeschnitten wie im Interpreter (2.5 -> 2)
        const rd = { int: `(int) Double.parseDouble(${ln})`, long: `(long) Double.parseDouble(${ln})`, short: `(short) Double.parseDouble(${ln})`, byte: `(byte) Double.parseDouble(${ln})`, float: `Float.parseFloat(${ln})`, double: `Double.parseDouble(${ln})`, boolean: `Boolean.parseBoolean(${ln})`, char: 'scanner.nextLine().charAt(0)' }[ct] || 'scanner.nextLine()';
        out.push(ind + (decl ? this.declLine(v, t, rd) : `${tv} = ${rd};`));
      } else if (L === 'csharp') {
        // Ganzzahl: Kommazahl wird abgeschnitten wie im Interpreter (2.5 -> 2)
        const rd = { int: '(int) double.Parse(Console.ReadLine(), NumberStyles.Float)', long: '(long) double.Parse(Console.ReadLine(), NumberStyles.Float)', short: '(short) double.Parse(Console.ReadLine(), NumberStyles.Float)', byte: '(byte) double.Parse(Console.ReadLine(), NumberStyles.Float)', float: 'float.Parse(Console.ReadLine(), NumberStyles.Float)', double: 'double.Parse(Console.ReadLine(), NumberStyles.Float)', boolean: 'bool.Parse(Console.ReadLine())', char: 'Console.ReadLine()[0]' }[ct] || 'Console.ReadLine()';
        out.push(ind + (decl ? this.declLine(v, t, rd) : `${tv} = ${rd};`));
      } else if (L === 'javascript') {
        this.needs.add('prompt');
        const pr = `prompt(${k === 0 && c.prompt ? this.x(c.prompt) : ''})`;
        // Zahlen streng wie im Interpreter (Number() nähme 2.5 für eine Ganzzahl und "" als 0)
        if (t === 'int') this.needs.add('readint');
        if (t === 'int' || t === 'double') this.needs.add('readnum');
        const rd = t === 'int' ? `_int(${pr})` : t === 'double' ? `_num(${pr})` : pr;
        out.push(ind + (decl ? `let ${v} = ${rd};` : `${tv} = ${rd};`));
      } else if (L === 'cpp') {
        // ganze Zeile lesen: Text mit Leerzeichen
        this.needs.add('readline');
        // Zahlen streng wie im Interpreter (stoi nähme 2.5 als 2)
        const rd = { int: '(int) read_int()', long: 'read_int()', short: '(short) read_int()', byte: '(unsigned char) read_int()',
          float: '(float) read_double()', double: 'read_double()', char: 'read_line()[0]', boolean: '(read_line() == "true")' }[ct] || 'read_line()';
        if (/read_int|read_double/.test(rd)) this.needs.add('readnum');
        out.push(ind + (decl ? this.declLine(v, t, rd) : `${tv} = ${rd};`));
      } else { // C
        // ganze Zeile lesen (fgets): Text mit Leerzeichen, kein Zeilenumbruch im Puffer
        this.needs.add('readline');
        this.needs.add('stdlib');
        if (decl) out.push(ind + this.declLine(v, t, null));
        // Zahlen streng wie im Interpreter (atoi nähme 2.5 als 2 und Text als 0)
        const rd = { int: '(int) read_int()', long: 'read_int()', short: '(short) read_int()', byte: '(unsigned char) read_int()',
          float: '(float) read_double()', double: 'read_double()', char: 'read_line()[0]', boolean: 'atoi(read_line())' }[ct];
        if (rd && /read_int|read_double/.test(rd)) this.needs.add('readnum');
        if (rd) out.push(ind + `${tv} = ${rd};`);
        else { this.needs.add('string'); out.push(ind + `strcpy(${tv}, read_line());`); }
      }
    });
    return out;
  }

  outputStmt(items) {
    const L = this.lang;
    const parts = this.outParts(items);
    if (L === 'javascript') {
      if (!parts.length) return 'console.log();';
      // Kommazahlen wie im Interpreter mit Nachkommastelle (JavaScript schreibt 80.0 als 80)
      const js = (e) => (this.isDouble(e) ? (this.needs.add('fmtnum'), `fmtNum(${this.x(e)})`) : this.x(e));
      if (parts.length === 1) return `console.log(${parts[0].lit != null ? '"' + parts[0].lit + '"' : js(parts[0].expr)});`;
      const s = parts.map((p) => (p.lit != null ? p.lit.replace(/`/g, '\\`').replace(/\$\{/g, '\\${') : '${' + js(p.expr) + '}')).join('');
      return 'console.log(`' + s + '`);';
    }
    if (L === 'cpp') {
      const s = parts.map((p) => {
        if (p.lit != null) return '"' + p.lit + '"';
        // byte (unsigned char) als Zahl ausgeben, nicht als Zeichen
        if (SIMPLE_IDENT.test(p.expr.trim()) && P.canonType(this.declType(p.expr.trim())) === 'byte') return `(int) ${this.x(p.expr)}`;
        // Kommazahlen vollständig und mit Nachkommastelle (cout schreibt nur 6 Stellen und 80.0 als 80)
        if (this.isDouble(p.expr)) { this.needs.add('fmtdouble'); return `fmt_double(${this.x(p.expr)})`; }
        if (this.isBool(p.expr)) return `(${W(this.x(p.expr))} ? "true" : "false")`;
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
          // Kommazahlen vollständig und mit Nachkommastelle (%g schreibt nur 6 Stellen und 80.0 als 80)
          if (t === 'double') { this.needs.add('fmtdouble'); fmt += '%s'; args.push(`fmt_double(${this.x(p.expr)})`); continue; }
          if (t === 'boolean') { fmt += '%s'; args.push(`${W(this.x(p.expr))} ? "true" : "false"`); continue; }
          const spec = ct === 'long' ? '%lld' : { string: '%s', char: '%c' }[t] || '%d';
          fmt += spec;
          args.push(this.x(p.expr));
        }
      }
      return `printf("${fmt}\\n"${args.map((a) => ', ' + a).join('')});`;
    }
    const fn = L === 'java' ? 'System.out.println' : 'Console.WriteLine';
    if (!parts.length) return `${fn}();`;
    const s = parts.map((p) => {
      if (p.lit != null) return '"' + p.lit + '"';
      // Kommazahlen wie im Interpreter (C# schreibt 80.0 als 80, Java 1.0E-7 und 1.23E7)
      if ((L === 'csharp' || L === 'java') && this.isDouble(p.expr)) { this.needs.add('fmtnum'); return `${L === 'java' ? 'fmt' : 'Fmt'}(${this.x(p.expr)})`; }
      if (L === 'csharp' && this.isBool(p.expr)) return `(${W(this.x(p.expr))} ? "true" : "false")`;
      return parts.length > 1 && this.needsParens(p.expr) ? '(' + this.x(p.expr) + ')' : this.x(p.expr);
    });
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
    const out = this.inSwitch(() => this.seq(body, I2));
    const last = body[body.length - 1];
    const ends = last && last.type === 'jump' && /^(return|exit|throw|leave|break|continue)\b/i.test(linesOf(last).join(' ').trim() || 'leave');
    if (!ends) out.push(I2 + 'break;');
    return out;
  }

  /**
   * C und C++ kennen kein switch über Zeichenketten: Fallauswahl über einen Text als if/else-if-Kette mit
   * Textvergleichen (C: strcmp, siehe stringCompare in pseudo.js)
   */
  condCaseBranches(el) {
    const cb = super.condCaseBranches(el);
    if (cb || (this.lang !== 'c' && this.lang !== 'cpp')) return cb;
    const disc = String(el.text[0] || '').trim();
    if (!disc || P.normType(this.exprType(disc)) !== 'string') return null;
    const par = (v) => (this.needsParens(v) ? `(${v})` : v);
    return this.caseInfo(el).map((b) => ({
      cond: b.isDefault ? null : b.values.length ? b.values.map((v) => `${par(disc)} = ${par(v)}`).map((c, i, a) => (a.length > 1 ? `(${c})` : c)).join(' or ') : 'false',
      body: b.body,
      isDefault: b.isDefault,
    }));
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
    // Zählvariable der Routine (nach der Schleife benutzt): mit Hilfsvariable zählen, im Rumpf zuweisen
    const hv = this.loopHidden(f.var);
    if (hv) body.unshift(ind + this.I + `${this.x(f.var)} = ${hv};`);
    if (f.kind === 'count') {
      const v = hv || this.x(f.var);
      const tn = decl || hv ? (L === 'javascript' ? 'let ' : this.typeName(this.typeOf(f.var) || 'int') + ' ') : '';
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
      const v = hv || f.var;
      let coll = this.x(f.coll);
      const t = this.typeOf(f.var);
      // Feld-Literal im Schleifenkopf (foreach k in {1, 2, 3}) je Sprache als gültiges Feld
      const lit = isArrayLit(f.coll);
      const items = lit ? arrayItems(f.coll) : [];
      const et = lit ? (P.normType(this.exprType(items[0] || '0')) || 'int') : null;
      const vals = items.map((i) => this.x(i)).join(', ');
      if (lit) coll = { java: `new ${this.typeName(et)}[] {${vals}}`, csharp: `new ${this.typeName(et)}[] { ${vals} }`, javascript: `[${vals}]`, cpp: `{${vals}}` }[L] || coll;
      // foreach über einen Text: Zeichen für Zeichen
      const isText = !lit && P.normType(this.exprType(f.coll)) === 'string';
      const tn = t ? this.typeName(t) : (L === 'java' || L === 'csharp' ? 'var' : 'int');
      switch (L) {
        case 'java': out.push(ind + `for (${tn} ${v} : ${isText ? `${/^[\w.]+$/.test(coll) ? coll : `(${coll})`}.toCharArray()` : coll}) {`); break;
        case 'csharp': out.push(ind + `foreach (${tn} ${v} in ${coll}) {`); break;
        case 'cpp': out.push(ind + `for (auto ${v} : ${coll}) {`); break;
        case 'javascript': out.push(ind + `for (const ${v} of ${coll}) {`); break;
        default:
          if (isText) {
            // C: bis zum Textende ('\0'), nicht sizeof (das wäre die Puffergröße)
            out.push(ind + `for (int _i = 0; ${coll}[_i] != '\\0'; _i++) {`, ind + this.I + `char ${v} = ${coll}[_i];`);
            break;
          }
          if (lit) {
            // C kennt kein Feld-Literal im Schleifenkopf: Hilfsfeld davor
            const tmp = `_feld${(this.tmpCount = (this.tmpCount || 0) + 1)}`;
            out.push(ind + `${this.typeName(et)} ${tmp}[] = {${vals}};`);
            coll = tmp;
          }
          out.push(ind + this.comment(tr('gen.foreachC', v, f.coll)));
          out.push(ind + `for (int _i = 0; _i < (int)(sizeof(${coll}) / sizeof(${coll}[0])); _i++) {`);
          out.push(ind + this.I + `${tn} ${v} = ${coll}[_i];`);
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
    if (L === 'c') return this.cTryEl(el, ind, v);
    if (L === 'cpp') this.needs.add('stdexcept');
    // C++ kennt kein finally: ein Wächter-Objekt führt den finally-Teil beim Verlassen des Blocks aus – auch bei return,
    // break/continue und weitergeworfenem Fehler
    if (L === 'cpp' && this.activeEls(el.qFinally).length) {
      this.needs.add('cppfinally');
      const id = (this.tryCount = (this.tryCount || 0) + 1);
      const inner = this.tryEl({ ...el, qFinally: [] }, ind + I);
      return [ind + '{', ind + I + this.comment(tr('gen.cppFinally')),
        ind + I + `_Finally _fin${id}([&] {`, ...this.seq(el.qFinally, ind + I + I), ind + I + '});', ...inner, ind + '}'];
    }
    const head = { java: '} catch (Exception _e) {', csharp: '} catch (Exception _e) {', javascript: '} catch (_e) {', cpp: '} catch (const exception& _e) {' }[L];
    const decl = { java: `String ${v} = _e.getMessage();`, csharp: `string ${v} = _e.Message;`, javascript: `const ${v} = _e instanceof Error ? _e.message : String(_e);`, cpp: `string ${v} = _e.what();` }[L];
    const wasDeclared = this.cur.declared.has(v);
    this.cur.declared.add(v);
    const out = [ind + 'try {', ...this.checked(() => this.seq(el.qTry, ind + I)), ind + head, ind + I + decl, ...this.seq(el.qCatch, ind + I)];
    if (!wasDeclared) this.cur.declared.delete(v);
    if (el.qFinally.length && L !== 'cpp') out.push(ind + '} finally {', ...this.seq(el.qFinally, ind + I));
    out.push(ind + '}');
    return out;
  }

  /**
   * C: try/catch/finally mit setjmp/longjmp nachgebildet (Hilfsfunktion _throw). Jeder try-Block merkt sich den
   * vorherigen Sprungpunkt (_prevN). Verlässt return/leave/continue den Block, stellt tryExit ihn vorher wieder her
   * und führt den finally-Teil aus. Ein Fehler im catch-Teil führt erst finally aus und wird dann weitergeworfen.
   */
  cTryEl(el, ind, v) {
    const I = this.I, I2 = I + I, I3 = I2 + I;
    this.needs.add('cthrow'); this.needs.add('stdlib');
    const id = (this.tryCount = (this.tryCount || 0) + 1);
    const prev = `_prev${id}`, env = `_env${id}`, re = `_rethrow${id}`;
    const fin = this.activeEls(el.qFinally).length ? el.qFinally : null;
    const loopDepth = (this.loopStack || []).length;
    this.cTry = this.cTry || [];
    const part = (name, seq, pind) => {
      this.cTry.push({ id, loopDepth, fin, part: name });
      try { return this.seq(seq, pind); } finally { this.cTry.pop(); }
    };
    const out = [ind + '{', ind + I + `jmp_buf* ${prev} = _try_env;`, ind + I + `jmp_buf ${env};`];
    if (fin) out.push(ind + I + `int ${re} = 0;`);
    out.push(ind + I + `_try_env = &${env};`, ind + I + `if (setjmp(${env}) == 0) {`, ...this.checked(() => part('try', el.qTry, ind + I2)),
      ind + I2 + `_try_env = ${prev};`, ind + I + '} else {', ind + I2 + `_try_env = ${prev};`, ind + I2 + `const char* ${v} = _try_msg;`);
    if (fin) {
      // Fehler im catch-Teil: erst finally, dann weiterwerfen
      out.push(ind + I2 + `_try_env = &${env};`, ind + I2 + `if (setjmp(${env}) == 0) {`, ...part('catch', el.qCatch, ind + I3),
        ind + I3 + `_try_env = ${prev};`, ind + I2 + '} else {', ind + I3 + `_try_env = ${prev};`, ind + I3 + `${re} = 1;`, ind + I2 + '}');
    } else {
      out.push(...this.seq(el.qCatch, ind + I2));
    }
    out.push(ind + I + '}');
    if (fin) out.push(...this.seq(fin, ind + I), ind + I + `if (${re}) _throw(_try_msg);`);
    out.push(ind + '}');
    return out;
  }

  /**
   * C: Sprung (return, leave, continue) aus einem oder mehreren try-Blöcken heraus. Vor dem Sprung: Sprungpunkt jedes
   * verlassenen try-Blocks zurücksetzen (sonst zeigt _try_env auf einen beendeten Block – Absturz beim nächsten throw)
   * und dessen finally-Teil ausführen. Liefert null, wenn kein try-Block verlassen wird.
   */
  tryExit(c, ind, jump) {
    const stack = this.cTry || [];
    if (this.lang !== 'c' || !stack.length) return null;
    const loops = (this.loopStack || []).length;
    const target = c.kind === 'return' ? -1 : c.kind === 'continue' ? loops - 1 : loops - (c.count || 1);
    // betroffen: try-Blöcke, die innerhalb der verlassenen Schleife (bzw. der Routine) begonnen haben
    const left = stack.map((t, k) => ({ ...t, k })).filter((t) => t.loopDepth > target);
    if (!left.length) return null;
    const out = [];
    let ret = null;
    if (c.kind === 'return' && c.expr && c.expr.trim()) {
      // Rückgabewert zuerst berechnen: Ein Fehler darin gehört noch zu diesem try-Block, und finally läuft danach (wie in Java)
      const ty = this.curIsMain ? 'int' : this.typeName(this.retType(this.curSig) || 'int');
      out.push(ind + `${ty} _ret = ${this.x(c.expr)};`);
      ret = '_ret';
    }
    for (const t of [...left].reverse()) { // von innen nach außen
      out.push(ind + `_try_env = _prev${t.id};`);
      if (t.fin) {
        const saved = this.cTry;
        this.cTry = stack.slice(0, t.k); // finally läuft außerhalb dieses try-Blocks
        try { out.push(...this.seq(t.fin, ind)); } finally { this.cTry = saved; }
      }
    }
    out.push(...(ret ? [ind + `return ${ret};`] : jump()));
    // eigener Block, damit mehrere return-Stellen je eine eigene Variable _ret haben
    return ret ? [ind + '{', ...out.map((l) => this.I + l), ind + '}'] : out;
  }

  /** C/C++: Hilfsfunktionen für Structorizer-Zeichenkettenfunktionen und throw */
  cppHelpers() {
    if (this.lang === 'c') return this.cHelpers();
    if (this.lang !== 'cpp') return [];
    const out = [];
    // Division und Rest innerhalb von try: bei 0 abfangbarer Fehler wie im Interpreter
    if (this.needs.has('checkdiv') || this.needs.has('checkmod')) this.needs.add('stdexcept');
    if (this.needs.has('checkdiv')) out.push(this.comment(tr('gen.checkDiv')), `long long _idiv(long long a, long long b) { if (b == 0) throw runtime_error(${JSON.stringify(tr('exec.divZero'))}); return a / b; }`, '');
    if (this.needs.has('checkmod')) out.push(this.comment(tr('gen.checkDiv')), `long long _imod(long long a, long long b) { if (b == 0) throw runtime_error(${JSON.stringify(tr('exec.divZeroMod'))}); return a % b; }`, '');
    if (this.needs.has('cppfinally')) {
      out.push(this.comment(tr('gen.cppFinallyGuard')), 'struct _Finally {', '    function<void()> f;', '    _Finally(function<void()> g) : f(g) {}',
        '    ~_Finally() { f(); }', '};', '');
    }
    if (this.needs.has('readline')) {
      this.needs.add('string');
      out.push(this.comment(tr('gen.readLine')), 'string read_line() {', '    string s;', '    getline(cin, s);',
        '    if (!s.empty() && s.back() == \'\\r\') s.pop_back();', '    return s;', '}', '');
    }
    // Zahlen einlesen, streng wie im Interpreter: anderer Text ist ein (abfangbarer) Fehler
    if (this.needs.has('readnum')) {
      this.needs.add('stdexcept');
      const msg = (key) => { const [a, b] = tr(key, '\u0000').split('\u0000'); return `${JSON.stringify(a)} + s + ${JSON.stringify(b)}`; };
      const body = (key, conv, extra) => ['    string s = read_line();', '    size_t a = s.find_first_not_of(" \\t"), b = s.find_last_not_of(" \\t");',
        '    string t = a == string::npos ? "" : s.substr(a, b - a + 1);', '    size_t p = 0;', `    ${conv}`,
        `    if (t.empty() || p != t.size()${extra}) throw runtime_error(${msg(key)});`, '    return v;'];
      out.push(this.comment(tr('gen.readNum')),
        'double read_double() {', ...body('exec.notNumber', 'double v = 0; try { v = stod(t, &p); } catch (...) { p = 0; }', ' || t.find_first_of("xXnNiI") != string::npos'), '}',
        // Ganzzahl: Kommazahl wird abgeschnitten wie im Interpreter (2.5 -> 2)
        'long long read_int() {', '    return (long long) read_double();', '}', '');
    }
    if (this.needs.has('fmtdouble')) {
      this.needs.add('stdlib');
      out.push(this.comment(tr('gen.fmtDouble')), ...fmtHelper('cpp'), '');
    }
    if (this.needs.has('strupper')) out.push('string str_upper(string s) { for (auto& c : s) c = toupper((unsigned char) c); return s; }');
    if (this.needs.has('strlower')) out.push('string str_lower(string s) { for (auto& c : s) c = tolower((unsigned char) c); return s; }');
    if (this.needs.has('strtrim')) out.push('string str_trim(const string& s) { size_t a = s.find_first_not_of(" \\t\\r\\n"); if (a == string::npos) return ""; size_t b = s.find_last_not_of(" \\t\\r\\n"); return s.substr(a, b - a + 1); }');
    if (out.length) { this.needs.add('string'); out.push(''); }
    return out;
  }

  cHelpers() {
    const out = [];
    const N = this.needs;
    if (N.has('readline')) {
      N.add('string');
      out.push(this.comment(tr('gen.readLine')), 'char* read_line(void) {', '    static char buf[1024];', '    if (!fgets(buf, sizeof buf, stdin)) buf[0] = 0;',
        '    buf[strcspn(buf, "\\r\\n")] = 0;', '    return buf;', '}', '');
    }
    if (N.has('strcat')) {
      N.add('stdlib');
      out.push(this.comment(tr('gen.strCat')), 'char* str_cat(const char* a, const char* b) {', '    char* r = malloc(strlen(a) + strlen(b) + 1);',
        '    strcpy(r, a);', '    strcat(r, b);', '    return r;', '}',
        // eigener Speicher je Aufruf (ein Ringpuffer würde gespeicherte Texte später überschreiben, z. B. erstes := s[0])
        'char* str_int(long long v) {', '    char* s = malloc(24);', '    snprintf(s, 24, "%lld", v);', '    return s;', '}',
        'char* str_chr(char c) {', '    char* s = malloc(2);', '    s[0] = c; s[1] = 0;', '    return s;', '}', '');
    }
    if (N.has('fmtdouble')) {
      N.add('stdlib');
      N.add('string');
      out.push(this.comment(tr('gen.fmtDouble')), ...fmtHelper('c'), '');
    }
    const range = '    size_t ls = strlen(s); size_t k = i < 1 ? 0 : (size_t) (i - 1) > ls ? ls : (size_t) (i - 1);';
    if (N.has('cthrow')) {
      out.push('static jmp_buf* _try_env = NULL;', 'static const char* _try_msg = "";',
        tr('gen.cThrow'),
        'void _throw(const char* msg) {', '    if (_try_env) { _try_msg = msg; longjmp(*_try_env, 1); }', '    fprintf(stderr, "%s\\n", msg);', '    exit(1);', '}');
    }
    // Zahlen einlesen, streng wie im Interpreter: anderer Text ist ein Fehler (abfangbar, wenn das Programm try nutzt)
    if (N.has('readnum')) {
      N.add('string');
      const fail = N.has('cthrow') ? '_throw(_in_msg);' : 'fprintf(stderr, "%s\\n", _in_msg); exit(1);';
      out.push(this.comment(tr('gen.readNum')), 'static char _in_msg[1200];',
        `void _input_fail(const char* fmt, const char* s) { snprintf(_in_msg, sizeof _in_msg, fmt, s); ${fail} }`,
        'double read_double(void) {', '    char* s = read_line();', '    char* e;', '    double v = strtod(s, &e);',
        "    while (*e == ' ' || *e == '\\t') e++;", `    if (e == s || *e || strpbrk(s, "xXnNiI")) _input_fail(${JSON.stringify(tr('exec.notNumber', '%s'))}, s);`, '    return v;', '}',
        // Ganzzahl: Kommazahl wird abgeschnitten wie im Interpreter (2.5 -> 2)
        'long long read_int(void) {', '    return (long long) read_double();', '}');
    }
    // Division und Rest innerhalb von try: bei 0 abfangbarer Fehler wie im Interpreter
    if (N.has('checkdiv')) out.push(this.comment(tr('gen.checkDiv')), `int _idiv(int a, int b) { if (b == 0) _throw(${JSON.stringify(tr('exec.divZero'))}); return a / b; }`);
    if (N.has('checkmod')) out.push(this.comment(tr('gen.checkDiv')), `int _imod(int a, int b) { if (b == 0) _throw(${JSON.stringify(tr('exec.divZeroMod'))}); return a % b; }`);
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
    // C: const int ist keine Konstante im Sinne von case-Marken – Aufzählungswerte als enum
    if (L === 'c' && this.enumConsts.length) {
      out.push(ind + `enum { ${this.enumConsts.map((e) => `${e.name} = ${this.x(e.value)}`).join(', ')} };`);
    }
    for (const e of (L === 'c' ? [] : this.enumConsts)) {
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
      // Kopien eingelesener Texte (temp := name1) brauchen eigenen Speicher, sonst zeigen beide auf dasselbe Array
      for (let more = true; more;) {
        more = false;
        walk(root.children, (el) => {
          for (const l of linesOf(el)) {
            const c = P.classifyLine(l);
            if (c.kind !== 'assign' || !SIMPLE_IDENT.test(c.target.trim()) || info.charArrays.has(c.target.trim())) continue;
            const e = c.expr.trim();
            if (SIMPLE_IDENT.test(e) && info.charArrays.has(e) && P.normType(info.types.get(c.target.trim())) === 'string') { info.charArrays.add(c.target.trim()); more = true; }
          }
        });
      }
      for (const v of info.charArrays) info.types.set(v, 'string');
    }
    this.cur = info;
    this.curIsMain = isMain;
    this.curSig = sig;
    // aus einem try-Teil aufgerufen: Division durch 0 auch hier abfangbar machen
    this.checkDiv = !isMain && this.checkedRoutines().has(sig.name) ? 1 : 0;
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
    // C: Endet eine Funktion mit try, sieht der Compiler hinter setjmp nicht, dass jeder Weg mit return endet
    // („control reaches end of non-void function“) – unerreichbares return mit Standardwert ergänzen
    const lastEl = this.activeEls(root.children).pop();
    if (L === 'c' && !isMain && ret && lastEl && lastEl.type === 'try') {
      lines.push(I + `return ${this.defaultValue(ret) || (P.normType(ret) === 'string' ? '""' : '0')}; ` + this.comment(tr('gen.cUnreachableReturn')).replace(/^\/\/ /, '/* ') + ' */');
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
      if (this.needs.has('fmtnum')) out.push(this.I + this.comment(tr('gen.fmtDouble')), ...fmtHelper('java').map((l) => this.I + l), '');
      out.push(...td);
      gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines); });
      out.push('}');
    } else if (L === 'csharp') {
      // Kommazahlen: C# schreibt und liest sie in der Ländereinstellung (deutsch: 0,15 – und double.Parse("0.5") ergibt 5).
      // Wie im Struktogramm mit Punkt: Kultur des Programms (auch der Threads) auf invariant stellen
      const main = gen.find((g) => g.isMain);
      const usesReal = /\b(?:double|float)\b|\d\.\d/.test(gen.map((g) => g.lines.join('\n')).join('\n'));
      if (main && usesReal) {
        const k = main.lines.findIndex((l) => /static void Main\(/.test(l));
        const I2 = this.I + this.I;
        main.lines.splice(k + 1, 0, I2 + this.comment(tr('gen.csCulture')),
          I2 + 'CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;',
          I2 + 'CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;');
      }
      // Umlaute und andere Sonderzeichen: Ausgabe als UTF-8 (stellt auch die Windows-Konsole um)
      if (main && /[^\x00-\x7f]/.test(main.lines.join('\n'))) {
        const k = main.lines.findIndex((l) => /static void Main\(/.test(l));
        main.lines.splice(k + 1, 0, this.I + this.I + 'Console.OutputEncoding = System.Text.Encoding.UTF8;');
      }
      const fmtNum = this.needs.has('fmtnum');
      out.push('using System;', ...((main && usesReal) || fmtNum ? ['using System.Globalization;'] : []), ...(this.needs.has('tasks') ? ['using System.Threading.Tasks;'] : []), '', title, `class ${this.opts.className || toClassName(mainName)}`, '{');
      out.push(...td);
      if (fmtNum) {
        const I = this.I;
        out.push(I + this.comment(tr('gen.fmtDouble')), ...fmtHelper('csharp').map((l) => I + l), '');
      }
      gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines.map((l) => l.replace(/^(\s*)(.*) \{$/, (m0, a, b) => (/^(static|public)/.test(b.trim()) ? `${a}${b}\n${a}{` : m0)))); });
      out.push('}');
    } else if (L === 'javascript') {
      out.push(title);
      if (this.needs.has('prompt')) out.push(tr('gen.jsPrompt'), 'const prompt = require("prompt-sync")();');
      // Zahlen einlesen, streng wie im Interpreter (Number() nähme 2.5 für eine Ganzzahl und "" als 0)
      const jsMsg = (key) => { const [a, b] = tr(key, '\u0000').split('\u0000'); return `${JSON.stringify(a)} + s + ${JSON.stringify(b)}`; };
      if (this.needs.has('readint')) out.push(this.comment(tr('gen.readNum')), `const _int = (s) => Math.trunc(_num(s));`);
      if (this.needs.has('readnum')) out.push(this.comment(tr('gen.readNum')), `const _num = (s) => { const v = String(s ?? "").trim(); if (!/^[+-]?(\\d+(\\.\\d*)?|\\.\\d+)([eE][+-]?\\d+)?$/.test(v)) throw new Error(${jsMsg('exec.notNumber')}); return parseFloat(v); };`);
      if (this.needs.has('fmtnum')) out.push(this.comment(tr('gen.fmtDouble')), 'const fmtNum = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));');
      // Division und Rest innerhalb von try: bei 0 abfangbarer Fehler wie im Interpreter (sonst Infinity bzw. NaN)
      if (this.needs.has('checkdiv')) out.push(this.comment(tr('gen.checkDiv')), `const _idiv = (a, b) => { if (b === 0) throw new Error(${JSON.stringify(tr('exec.divZero'))}); return Math.trunc(a / b); };`);
      if (this.needs.has('checkmod')) out.push(this.comment(tr('gen.checkDiv')), `const _imod = (a, b) => { if (b === 0) throw new Error(${JSON.stringify(tr('exec.divZeroMod'))}); return a % b; };`);
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
        if (this.needs.has('cppfinally')) inc.push('#include <functional>');
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
          let v = this.toFloat(c.type || this.typeOf(d.name), d.init, this.x(d.init));
          if (/^\{.*\}$/.test(v)) v = '[' + v.slice(1, -1) + ']';
          return ind + `${d.name} = ${v}`;
        });
      case 'assign': {
        let v = this.x(c.expr);
        if (SIMPLE_IDENT.test(c.target.trim())) v = this.toFloat(this.typeOf(c.target.trim()), c.expr, v);
        if (/^\{.*\}$/.test(v)) v = '[' + v.slice(1, -1) + ']';
        return [ind + `${this.x(c.target)} = ${v}`];
      }
      case 'input': {
        const out = [];
        if (!c.vars.length) return [ind + `input(${c.prompt ? this.x(c.prompt) : ''})`];
        c.vars.forEach((v, k) => {
          const t = P.normType(this.typeOf(v));
          const pr = `input(${k === 0 && c.prompt ? this.x(c.prompt) : ''})`;
          // Ganzzahl: Kommazahl wird abgeschnitten wie im Interpreter (2.5 -> 2)
          const rd = t === 'int' ? `int(float(${pr}))` : t === 'double' ? `float(${pr})` : t === 'boolean' ? `${pr} == "True"` : pr;
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
      case 'continue': {
        // repeat … until ist „while True: … if Bedingung: break“ – continue überspränge die Prüfung
        const rc = this.innerRepeatCond();
        return [...(rc ? [ind + `if ${this.x(rc)}:`, ind + this.I + 'break'] : []), ind + 'continue'];
      }
      case 'throw': return [ind + (P.isStringLiteral(c.expr) ? `raise Exception(${this.x(c.expr)})` : `raise ${this.x(c.expr)}`)];
      default: return [ind + this.x(c.expr)];
    }
  }

  /** Python: Ganzzahl-Ausdruck für eine Kommazahl-Variable als float (7 -> 7.0, a -> float(a)) */
  toFloat(type, expr, code) {
    if (P.normType(type) !== 'double') return code;
    let et = null;
    try { et = P.normType(this.exprType(expr)); } catch (e) { et = null; }
    if (et !== 'int') return code;
    return /^-?\d+$/.test(String(code).trim()) ? String(code).trim() + '.0' : `float(${code})`;
  }

  outputStmt(items) {
    const parts = this.outParts(items);
    if (!parts.length) return 'print()';
    // True -> true und Kommazahlen wie im Interpreter (Python schreibt 1e-07)
    const py = (e) => (this.isBool(e) ? `str(${this.x(e)}).lower()` : this.isDouble(e) ? (this.needs.add('fmtnum'), `fmt_num(${this.x(e)})`) : this.x(e));
    if (parts.length === 1) return `print(${parts[0].lit != null ? '"' + parts[0].lit + '"' : py(parts[0].expr)})`;
    const exprs = parts.filter((p) => p.expr).map((p) => this.x(p.expr));
    const q = exprs.some((e) => e.includes('"')) ? "'" : '"';
    const s = parts.map((p) => {
      if (p.lit != null) {
        let l = p.lit.replace(/\{/g, '{{').replace(/\}/g, '}}');
        if (q === "'") l = l.replace(/\\"/g, '"').replace(/'/g, "\\'");
        return l;
      }
      return '{' + py(p.expr) + '}';
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
        if (P.normType(tt) === 'double') { this.needs.add('fmtnum'); return `fmt_num(${r})`; }
        if (P.normType(tt) === 'boolean') return `str(${r}).lower()`;
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
    // BaseException statt Exception: Das „except Exception“ eines try-Elements darf leave n nicht abfangen
    if (leaves.length) out.push(...leaves.map((l) => `class _Leave${l}(BaseException):
${this.I}pass`), '', '');
    if (this.needs.has('fmtnum')) out.push(this.comment(tr('gen.fmtDouble')), ...fmtHelper('python'), '', '');
    out.push(...td);
    parts.forEach((p) => out.push(...p, '', ''));
    mainParts.forEach((p, i) => { if (i) out.push(''); out.push(...p); });
    if (this.needs.has('turtle')) out.push('turtle.done()');
    return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
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
      if (this.isDouble(p.expr)) { this.needs.add('fmtnum'); s += '${fmt(' + e + ')}'; return; }
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
    // Kotlin wandelt Int nicht von selbst in Double um (umfang = a + b + c mit Int-Werten)
    else if (n === 'double' && P.normType(this.exprType(expr)) === 'int') r = `${IDENT_ONLY.test(r) ? r : `(${r})`}.toDouble()`;
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
          const rd = { int: 'readln().trim().toDouble().toInt()', long: 'readln().trim().toDouble().toLong()', short: 'readln().trim().toDouble().toInt().toShort()', byte: 'readln().trim().toDouble().toInt().toByte()', float: 'readln().trim().toFloat()', double: 'readln().trim().toDouble()', boolean: 'readln().trim().toBoolean()', char: 'readln()[0]' }[ct] || 'readln()';
          const decl = this.cur.inline.get(el) && this.cur.inline.get(el).has(v) && !this.cur.declared.has(v);
          if (decl) this.cur.declared.add(v);
          out.push(ind + (decl ? `var ${v}: ${this.typeName(this.targetType(v) || t)} = ${rd}` : `${this.x(v)} = ${rd}`));
        });
        return out;
      }
      case 'output': {
        const parts = this.outParts(c.items);
        if (!parts.length) return [ind + 'println()'];
        if (parts.length === 1 && parts[0].expr != null) {
          // Kommazahlen wie im Interpreter (Kotlin schreibt 1.0E-7)
          if (this.isDouble(parts[0].expr)) { this.needs.add('fmtnum'); return [ind + `println(fmt(${this.x(parts[0].expr)}))`]; }
          return [ind + `println(${this.x(parts[0].expr)})`];
        }
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
    // Zählvariable der Routine (nach der Schleife benutzt): mit Hilfsvariable zählen, im Rumpf zuweisen
    const hv = this.loopHidden(f.var);
    if (hv) body.unshift(ind + this.I + `${f.var} = ${hv}`);
    const lv = hv || this.x(f.var);
    if (f.kind === 'each') return [ind + `for (${lv} in ${isArrayLit(f.coll) ? this.val(null, f.coll) : this.x(f.coll)}) {`, ...body, ind + '}'];
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
    return [ind + `for (${lv} in ${range}) {`, ...body, ind + '}'];
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
    if (this.needs.has('fmtnum')) out.push(this.comment(tr('gen.fmtDouble')), ...fmtHelper('kotlin'), '');
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
        // Kommazahlen wie im Interpreter über fmt_num ({:?} schreibt 1e-5 und 1e16 anders)
        if (t === 'double') { this.needs.add('fmtnum'); f += '{}'; args.push(`fmt_num(${this.x(p.expr)})`); continue; }
        f += t && (this.recordTypes.has(t) || t.endsWith('[]')) ? '{:?}' : '{}';
        args.push(this.x(p.expr)); // this.x: Verkettung im Ausgabeteil wird zu format!
      }
    }
    return { f: '"' + f + '"', args };
  }

  x(text) {
    const parts = this.cur ? concatParts(text) : null;
    if (parts) { const { f, args } = this.fmt(parts); return `format!(${[f, ...args].join(', ')})`; }
    return super.x(this.cur ? this.rustMix(text) : text);
  }

  /**
   * Rust rechnet und vergleicht nicht mit gemischten Typen (i32 * f64): ganzzahlige Operanden neben einer Kommazahl
   * werden zu float(…) (-> as f64). Klammern mit ganzzahligem Ergebnis bleiben ganz: (a / 2) * 1.5 teilt ganzzahlig.
   */
  rustMix(text) {
    const { splitTop, matchClose } = require('./tokenizer');
    const typeOf = (toks) => { try { return toks.length ? P.normType(this.exprType(joinTokens(toks))) : null; } catch (e) { return null; } };
    const LOGIC = new Set(['and', 'or', 'xor']);
    const ARITH = new Set(['+', '-', '*', '/']);
    const isArith = (t) => t && ((t.t === 'op' && ARITH.has(t.v)) || (t.t === 'id' && ['div', 'mod'].includes(t.v.toLowerCase())) || (t.t === 'op' && t.v === '%'));
    const wrapF = (toks) => [{ t: 'id', v: 'float', ws: toks[0] ? toks[0].ws : false }, { t: 'op', v: '(', ws: false },
      ...toks.map((t, k) => (k === 0 ? { ...t, ws: false } : t)), { t: 'op', v: ')', ws: false }];
    let changed = false;
    // Summe/Produkt mit Kommazahl: ganzzahlige Operanden umwandeln; Klammern mit Kommazahl-Ergebnis innen bearbeiten
    const arith = (toks) => {
      if (typeOf(toks) !== 'double') return toks;
      const ops = [];
      let depth = 0, start = 0;
      const operands = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.t === 'op' && (t.v === '(' || t.v === '[')) depth++;
        else if (t.t === 'op' && (t.v === ')' || t.v === ']')) depth--;
        else if (depth === 0 && isArith(t) && i > start) { operands.push(toks.slice(start, i)); ops.push(t); start = i + 1; }
      }
      operands.push(toks.slice(start));
      if (operands.length < 2) {
        // einzelner Operand: Klammer mit Kommazahl-Ergebnis -> innen weiter
        if (toks.length > 2 && toks[0].v === '(' && matchClose(toks, 0) === toks.length - 1) return [toks[0], ...arith(toks.slice(1, -1)), toks[toks.length - 1]];
        return toks;
      }
      const out = [];
      operands.forEach((o, k) => {
        if (k > 0) out.push(ops[k - 1]);
        const ot = typeOf(o);
        if (ot === 'int' && !(o.length === 1 && o[0].t === 'num')) { out.push(...wrapF(o)); changed = true; }
        else if (ot === 'int') { out.push({ ...o[0], v: o[0].v + '.0' }); changed = true; }
        else if (ot === 'double' && o.length > 2 && o[0].v === '(' && matchClose(o, 0) === o.length - 1) out.push(o[0], ...arith(o.slice(1, -1)), o[o.length - 1]);
        else out.push(...o);
      });
      return out;
    };
    // Vergleich: eine Seite Ganzzahl, die andere Kommazahl
    const rel = (toks) => {
      const k = findTop(toks, (t) => P.REL_OPS.has(t.v));
      if (k <= 0) return arith(toks);
      let L = toks.slice(0, k), R = toks.slice(k + 1);
      const lt = typeOf(L), rt = typeOf(R);
      const conv = (o) => (o.length === 1 && o[0].t === 'num' ? [{ ...o[0], v: o[0].v + '.0' }] : wrapF(o));
      if (lt === 'int' && rt === 'double') { L = conv(L); changed = true; }
      else if (lt === 'double' && rt === 'int') { R = conv(R); changed = true; }
      return [...arith(L), toks[k], ...arith(R)];
    };
    const toks = P.ptoks(String(text));
    const parts = [];
    let cur = [];
    let depth = 0;
    for (const t of toks) {
      if (t.t === 'op' && (t.v === '(' || t.v === '[')) depth++;
      else if (t.t === 'op' && (t.v === ')' || t.v === ']')) depth--;
      if (depth === 0 && t.t === 'id' && (LOGIC.has(t.v.toLowerCase()) || t.v.toLowerCase() === 'not')) { parts.push(cur, [t]); cur = []; continue; }
      cur.push(t);
    }
    parts.push(cur);
    const out = parts.flatMap((p) => (p.length === 1 && p[0].t === 'id' && (LOGIC.has(p[0].v.toLowerCase()) || p[0].v.toLowerCase() === 'not') ? p : rel(p)));
    return changed ? joinTokens(out) : text;
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
          const rd = ct === 'char' ? 'read_line().chars().next().unwrap()' : ct === 'string' || !num ? 'read_line()'
            : /^[iu]/.test(num) ? `read_line().parse::<f64>().unwrap() as ${num}` // Ganzzahl: Kommazahl abschneiden (2.5 -> 2)
              : `read_line().parse::<${num}>().unwrap()`;
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
      case 'continue': {
        // repeat … until ist „loop { … if Bedingung { break; } }“ – continue überspränge die Prüfung
        const rc = this.innerRepeatCond();
        return [...(rc ? [ind + `if ${this.bare(rc)} {`, ind + this.I + 'break;', ind + '}'] : []), ind + 'continue;'];
      }
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
    // Zählvariable der Routine (nach der Schleife benutzt): mit Hilfsvariable zählen, im Rumpf zuweisen
    const hv = this.loopHidden(f.var);
    if (hv) body.unshift(ind + this.I + `${f.var} = ${hv};`);
    const lv = hv || this.x(f.var);
    if (f.kind === 'each') {
      const ct = P.normType(this.exprType(f.coll));
      const c = isArrayLit(f.coll) ? this.val(null, f.coll) : this.x(f.coll);
      return [ind + `for ${lv} in ${ct === 'string' ? `${c}.chars()` : isArrayLit(f.coll) ? c : `${c}.clone()`} {`, ...body, ind + '}'];
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
    return [ind + `for ${lv} in ${range} {`, ...body, ind + '}'];
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
    const I = this.I, I2 = I + I, v = this.catchVar(el);
    this.needs.add('try');
    const fin = this.activeEls(el.qFinally).length ? el.qFinally : null;
    // try-Teil (und bei finally auch catch-Teil) läuft in einer Closure: Sprünge hinaus meldet sie als Flow-Wert (tryExit)
    const frame = { loopDepth: (this.loopStack || []).length, flows: new Set() };
    this.rsTry = this.rsTry || [];
    const inClosure = (seq, pind) => { this.rsTry.push(frame); try { return this.seq(seq, pind); } finally { this.rsTry.pop(); } };
    const tryBody = inClosure(el.qTry, ind + I);
    if (!fin && !frame.flows.size) {
      // einfache Form: kein Sprung aus dem try-Teil, kein finally
      return [ind + `if let Err(${v}) = try_block(|| {`, ...tryBody, ind + '}) {', ...this.seq(el.qCatch, ind + I), ind + '}'];
    }
    this.needs.add('flow');
    const T = this.curIsMain || !this.retType(this.curSig) ? '()' : this.typeName(this.retType(this.curSig));
    const open = `try_block(|| -> Flow<${T}> {`;
    const out = [];
    if (!fin) {
      out.push(ind + `match ${open}`, ...tryBody, ind + I + 'Flow::Normal', ind + '}) {');
      out.push(...this.rsFlowArms(frame, ind + I));
      out.push(ind + I + `Err(${v}) => {`, ...this.seq(el.qCatch, ind + I2), ind + I + '}', ind + '}');
      return out;
    }
    // mit finally: auch der catch-Teil in einer Closure, damit finally bei jedem Ausgang läuft (auch bei throw in catch)
    const id = (this.tryCount = (this.tryCount || 0) + 1);
    const catchBody = inClosure(el.qCatch, ind + I2);
    out.push(ind + `let _o${id} = match ${open}`, ...tryBody, ind + I + 'Flow::Normal', ind + '}) {',
      ind + I + 'Ok(f) => Ok(f),', ind + I + `Err(${v}) => ${open}`, ...catchBody, ind + I2 + 'Flow::Normal', ind + I + '}),', ind + '};');
    out.push(...this.seq(fin, ind));
    out.push(ind + `match _o${id} {`, ...this.rsFlowArms(frame, ind + I, true), ind + I + 'Err(_m) => panic!("{}", _m),', ind + '}');
    return out;
  }

  /** Auswertung des Flow-Werts nach einem try-Block: Sprünge, die die Closure gemeldet hat, hier ausführen */
  rsFlowArms(frame, ind, wrapped) {
    const arms = [];
    // Sprung im umgebenden Kontext – der kann selbst wieder in einer try-Closure liegen
    const jump = (c) => {
      let lines = this.tryExit(c, '');
      if (!lines && c.kind === 'return') {
        const T = this.curIsMain || !this.retType(this.curSig) ? '()' : 'v';
        lines = [T === '()' ? 'return;' : 'return _v;'];
      }
      if (!lines && c.kind === 'leave' && c.count > 1) lines = this.leaveN(c.count, '');
      if (!lines) lines = this.stmt(c, '', null);
      return `{ ${lines.map((l) => l.trim()).join(' ')} }`;
    };
    for (const f of [...frame.flows].sort()) {
      if (f.startsWith('leave:')) { const n = Number(f.slice(6)); arms.push(`Ok(Flow::Leave(${n})) => ${jump({ kind: 'leave', count: n })}`); }
      else if (f === 'continue') arms.push(`Ok(Flow::Continue) => ${jump({ kind: 'continue' })}`);
      else if (f === 'return') arms.push(`Ok(Flow::Return(_v)) => ${jump({ kind: 'return', value: '_v' })}`);
    }
    arms.push('Ok(_) => {}');
    return arms.map((a) => ind + a + ',');
  }

  /**
   * Sprung (return, leave, continue) aus der Closure eines try-Blocks heraus: als Flow-Wert zurückgeben, den die
   * Auswertung nach dem try-Block (rsFlowArms) ausführt. Null, wenn der Sprung innerhalb der Closure bleibt.
   */
  tryExit(c, ind = '') {
    const f = this.rsTry && this.rsTry[this.rsTry.length - 1];
    if (!f) return null;
    const loops = (this.loopStack || []).length;
    if (c.kind === 'return') {
      if (this.curIsMain && c.expr && c.expr.trim() && c.expr.trim() !== '0') return null; // exit: geht auch aus der Closure
      f.flows.add('return');
      const ret = this.retType(this.curSig);
      const val = c.value || (this.curIsMain || !c.expr || !c.expr.trim() || !ret ? '()' : this.val(ret, c.expr));
      return [ind + `return Flow::Return(${val});`];
    }
    if (c.kind === 'continue') {
      if (loops - 1 >= f.loopDepth) return null;
      f.flows.add('continue');
      return [ind + 'return Flow::Continue;'];
    }
    if (c.kind === 'leave') {
      const n = c.count || 1;
      if (loops - n >= f.loopDepth) return null;
      const rem = f.loopDepth - (loops - n); // so viele Schleifen außerhalb des try-Blocks sind zu verlassen
      f.flows.add('leave:' + rem);
      return [ind + `return Flow::Leave(${rem});`];
    }
    return null;
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
    // Endet die Funktion mit try, sieht der Compiler nicht, dass jeder Weg mit return endet: Standardwert als Abschluss
    const lastEl = this.activeEls(root.children).pop();
    if (ret && lastEl && lastEl.type === 'try') body.push(I + 'Default::default() ' + this.comment(tr('gen.cUnreachableReturn')));
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
      '#![allow(unused_mut, unused_variables, unused_assignments, unused_parens, non_snake_case, dead_code, unreachable_code)]',
      '',
    ];
    for (const e of this.enumConsts) out.push(`const ${e.name}: i32 = ${this.x(e.value)};`);
    for (const [name, fields] of this.recordTypes) {
      out.push('#[derive(Clone, Debug, Default, PartialEq)]', `struct ${name} {`, ...fields.map((f) => `    ${f.name}: ${this.typeName(f.type)},`), '}');
    }
    if (this.enumConsts.length || this.recordTypes.size) out.push('');
    gen.forEach((g, i) => { if (i) out.push(''); out.push(...g.lines); });
    if (this.needs.has('fmtnum')) out.push('', this.comment(tr('gen.fmtDouble')), ...fmtHelper('rust'));
    if (this.needs.has('input')) {
      out.push('', tr('gen.rsReadLine'), 'fn read_line() -> String {',
        '    use std::io::Write;', '    std::io::stdout().flush().unwrap();', '    let mut s = String::new();',
        '    std::io::stdin().read_line(&mut s).unwrap();', '    s.trim().to_string()', '}');
    }
    if (this.needs.has('try')) {
      out.push('', tr('gen.rsTry'),
        'fn try_block<R, F: FnOnce() -> R>(f: F) -> Result<R, String> {',
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
    if (this.needs.has('flow')) {
      out.push('', tr('gen.rsFlow'), 'enum Flow<T> {', '    Normal,', '    Leave(u32),', '    Continue,', '    Return(T),', '}');
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
  const G = { python: PyGen, kotlin: KtGen, rust: RsGen }[lang] || CGen;
  const g = new G(doc, lang, opts);
  const code = g.run();
  if (Array.isArray(opts.warnings)) opts.warnings.push(...g.warnings);
  return code;
}

/**
 * Typen der Variablen je Routine, wie der Generator sie ableitet (für Hinweise wie „Variable ohne Typ – var x: int“).
 * Liefert je Wurzel { types: Map Name -> vereinheitlichter Typ (int, double, string, boolean, char, int[] …), returnType }.
 */
function inferTypes(doc) {
  try {
    const g = new CGen(doc, 'java', {});
    return doc.roots.map((r) => {
      const sig = g.sigs.get(r);
      let types = new Map();
      try { types = g.analyze(r, r.rootType === 'program' ? { ...sig, params: [] } : sig).types; } catch (e) { /* ohne Vorschlag */ }
      return { types, returnType: (sig && (sig.inferredReturn || null)) || null };
    });
  } catch (e) { return doc.roots.map(() => ({ types: new Map(), returnType: null })); }
}

module.exports = { generateCode, TARGETS, toClassName, inferTypes };
