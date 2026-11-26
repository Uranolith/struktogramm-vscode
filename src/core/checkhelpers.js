// Laufzeitprüfungen innerhalb von try mit den Fehlertexten des Interpreters (Plan 1.4, 2.8, 2.9): Ganzzahldivision
// und Rest durch 0 (_idiv, _imod), Index außerhalb eines Arrays (_idx) und Zahlen bei der Eingabe (_num). Ohne sie
// stünde im catch der Text der Sprache („/ by zero“, „Attempted to divide by zero.“ …) statt „Division durch 0“.
//
// C, C++ und JavaScript haben _idiv/_imod schon im Generator (generators.js), Python und JavaScript prüfen den Index
// mit _ix; dieses Modul ergänzt die übrigen Sprachen. Die Zahlenprüfung für C/C++ (_is_num, _is_int) nutzen auch die
// Dateifunktionen (filehelpers.js).
'use strict';
const { t: tr } = require('../i18n');

const q = (s) => JSON.stringify(s);
/** Fehlertext mit Platzhaltern {0}, {1}: Teile dazwischen */
const parts = (key, n) => tr(key, ...Array.from({ length: n }, (_, k) => `\u0000${k}\u0000`)).split(/\u0000\d\u0000/);

/** Zahl wie im Interpreter (NUM_RE in executor.js), ohne \d (Unicode-Ziffern in manchen Sprachen) */
const NUM_RE = '[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+)?';

/** C und C++: Zahl bzw. Ganzzahl im Format des Interpreters? */
const C_NUMCHECK = [
  'static int _is_int(const char* s) {',
  '    if (*s == \'+\' || *s == \'-\') s++;',
  '    if (!*s) return 0;',
  '    for (; *s; s++) if (*s < \'0\' || *s > \'9\') return 0;',
  '    return 1;',
  '}',
  'static int _is_num(const char* s) {',
  '    int d = 0;',
  '    if (*s == \'+\' || *s == \'-\') s++;',
  '    while (*s >= \'0\' && *s <= \'9\') { s++; d = 1; }',
  '    if (*s == \'.\') { s++; while (*s >= \'0\' && *s <= \'9\') { s++; d = 1; } }',
  '    if (!d) return 0;',
  '    if (*s == \'e\' || *s == \'E\') {',
  '        s++;',
  '        if (*s == \'+\' || *s == \'-\') s++;',
  '        if (*s < \'0\' || *s > \'9\') return 0;',
  '        while (*s >= \'0\' && *s <= \'9\') s++;',
  '    }',
  '    return !*s;',
  '}',
];

/** Hilfsfunktionen einer Sprache für die gesetzten needs (checkdiv, checkmod, checkidx, checknum) */
function checkHelpers(lang, needs, I = '    ') {
  const has = (n) => needs.has(n);
  const div = tr('exec.divZero'), mod = tr('exec.divZeroMod');
  const [x0, x1, x2] = parts('exec.indexArray', 2);
  const [n0, n1] = parts('exec.notNumber', 1);
  const [c0, c1, c2] = parts('exec.commaNumber', 2);
  const head = '// ' + tr('gen.checkRuntime');
  const out = [];
  switch (lang) {
    case 'python':
      // Kommazahlen wie in den anderen Sprachen (Gleitkommanorm): x / 0 = ±Infinity, 0 / 0 = NaN, sqrt(-1) = NaN,
      // log(0) = -Infinity – Python bräche jeweils ab
      if (has('fdiv') || has('fsqrt') || has('flog')) out.push('# ' + tr('gen.ieee'));
      if (has('fdiv')) out.push('def _fdiv(a, b):', '    if b != 0:', '        return a / b', '    if a != a or a == 0:', '        return math.nan',
        '    return math.copysign(math.inf, a) * math.copysign(1.0, b)', '', '');
      if (has('fsqrt')) out.push('def _sqrt(x):', '    return math.sqrt(x) if x >= 0 else math.nan', '', '');
      if (has('flog')) out.push('def _log(x):', '    return math.log(x) if x > 0 else (-math.inf if x == 0 else math.nan)', '', '');
      if (has('checkdiv') || has('checkmod')) {
        out.push('# ' + tr('gen.checkRuntime'), 'def _idiv(a, b):', '    if b == 0:', `        raise ZeroDivisionError(${q(div)})`,
          '    q = abs(a) // abs(b)', '    return q if (a >= 0) == (b >= 0) else -q', '', '');
        if (has('checkmod')) out.push('def _imod(a, b):', '    if b == 0:', `        raise ZeroDivisionError(${q(mod)})`, '    return a - b * _idiv(a, b)', '', '');
      }
      if (has('checknum')) {
        out.push('# ' + tr('gen.readNum'), 'def _num(s):', '    import re', '    v = s.strip()', `    if re.fullmatch(r"${NUM_RE}", v):`, '        return float(v)',
          '    d = v.replace(",", ".", 1)', `    if "," in v and re.fullmatch(r"${NUM_RE}", d):`, `        raise ValueError(${q(c0)} + s + ${q(c1)} + d + ${q(c2)})`,
          `    raise ValueError(${q(n0)} + s + ${q(n1)})`, '', '');
      }
      return out;
    case 'java': case 'csharp': {
      const J = lang === 'java';
      const ex = J ? 'RuntimeException' : 'Exception';
      const L = [];
      for (const t of ['int', 'long']) {
        if (has('checkdiv')) L.push(`static ${t} _idiv(${t} a, ${t} b) { if (b == 0) throw new ${ex}(${q(div)}); return a / b; }`);
        if (has('checkmod')) L.push(`static ${t} _imod(${t} a, ${t} b) { if (b == 0) throw new ${ex}(${q(mod)}); return a % b; }`);
      }
      if (has('checkidx')) L.push(`static int _idx(int i, int n) { if (i < 0 || i >= n) throw new ${ex}(${q(x0)} + i + ${q(x1)} + n + ${q(x2)}); return i; }`);
      if (has('checknum')) {
        const match = J ? (v) => `${v}.matches(${q(NUM_RE)})` : (v) => `System.Text.RegularExpressions.Regex.IsMatch(${v}, ${q('^' + NUM_RE + '$')})`;
        const parse = J ? 'Double.parseDouble(v)' : 'double.Parse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture)';
        L.push(`static double _num(${J ? 'String' : 'string'} s) {`, `    ${J ? 'String' : 'string'} v = s.trim();`.replace('s.trim()', J ? 's.trim()' : 's.Trim()'),
          `    if (${match('v')}) return ${parse};`, `    ${J ? 'String' : 'string'} d = ${J ? 'v.replaceFirst(",", ".")' : 'new System.Text.RegularExpressions.Regex(",").Replace(v, ".", 1)'};`,
          `    if (v.${J ? 'contains' : 'Contains'}(",") && ${match('d')}) throw new ${ex}(${q(c0)} + s + ${q(c1)} + d + ${q(c2)});`,
          `    throw new ${ex}(${q(n0)} + s + ${q(n1)});`, '}');
      }
      return L.length ? [head, ...L].map((l) => I + l) : [];
    }
    case 'kotlin':
      if (has('checkdiv') || has('checkmod') || has('checkidx') || has('checknum')) out.push(head);
      if (has('checkdiv')) out.push(`fun _idiv(a: Int, b: Int): Int { if (b == 0) throw ArithmeticException(${q(div)}); return a / b }`,
        `fun _idiv(a: Long, b: Long): Long { if (b == 0L) throw ArithmeticException(${q(div)}); return a / b }`);
      if (has('checkmod')) out.push(`fun _imod(a: Int, b: Int): Int { if (b == 0) throw ArithmeticException(${q(mod)}); return a % b }`,
        `fun _imod(a: Long, b: Long): Long { if (b == 0L) throw ArithmeticException(${q(mod)}); return a % b }`);
      if (has('checkidx')) out.push(`fun _idx(i: Int, n: Int): Int { if (i < 0 || i >= n) throw IndexOutOfBoundsException(${q(x0)} + i + ${q(x1)} + n + ${q(x2)}); return i }`);
      if (has('checknum')) {
        out.push('fun _num(s: String): Double {', '    val v = s.trim()', `    if (Regex(${q(NUM_RE).replace(/\$/g, '\\$')}).matches(v)) return v.toDouble()`, '    val d = v.replaceFirst(",", ".")',
          `    if ("," in v && Regex(${q(NUM_RE).replace(/\$/g, '\\$')}).matches(d)) throw NumberFormatException(${q(c0)} + s + ${q(c1)} + d + ${q(c2)})`,
          `    throw NumberFormatException(${q(n0)} + s + ${q(n1)})`, '}');
      }
      return out.length ? [...out, ''] : [];
    case 'rust': {
      const esc = (s) => q(s).slice(1, -1).replace(/\{/g, '{{').replace(/\}/g, '}}');
      if (has('checkdiv') || has('checkmod') || has('checkidx') || has('checknum')) out.push('', head);
      if (has('checkdiv')) out.push('fn _idiv<T: Copy + PartialEq + Default + std::ops::Div<Output = T>>(a: T, b: T) -> T {',
        `    if b == T::default() { panic!("{}", ${q(div)}); }`, '    a / b', '}');
      if (has('checkmod')) out.push('fn _imod<T: Copy + PartialEq + Default + std::ops::Rem<Output = T>>(a: T, b: T) -> T {',
        `    if b == T::default() { panic!("{}", ${q(mod)}); }`, '    a % b', '}');
      if (has('checkidx')) out.push('fn _idx(i: i64, n: usize) -> usize {', `    if i < 0 || i >= n as i64 { panic!("${esc(x0)}{}${esc(x1)}{}${esc(x2)}", i, n); }`, '    i as usize', '}');
      if (has('checknum')) {
        out.push('fn _is_num(s: &str) -> bool {', '    let b = s.strip_prefix(|c: char| c == \'+\' || c == \'-\').unwrap_or(s);',
          '    let (m, e) = match b.find(|c: char| c == \'e\' || c == \'E\') { Some(k) => (&b[..k], Some(&b[k + 1..])), None => (b, None) };',
          '    let mut ps = m.splitn(2, \'.\');', '    let (a, f) = (ps.next().unwrap_or(""), ps.next());', '    let digits = |x: &str| x.bytes().all(|c| c.is_ascii_digit());',
          '    let ok_m = digits(a) && f.map_or(true, |f| digits(f)) && !(a.is_empty() && f.map_or(true, |f| f.is_empty()));',
          '    let ok_e = e.map_or(true, |e| { let e = e.strip_prefix(|c: char| c == \'+\' || c == \'-\').unwrap_or(e); !e.is_empty() && digits(e) });',
          '    ok_m && ok_e', '}',
          'fn _num(s: &str) -> f64 {', '    let v = s.trim();', '    if _is_num(v) { return v.parse::<f64>().unwrap(); }', '    let d = v.replacen(",", ".", 1);',
          `    if v.contains(',') && _is_num(&d) { panic!("${esc(c0)}{}${esc(c1)}{}${esc(c2)}", s, d); }`, `    panic!("${esc(n0)}{}${esc(n1)}", s);`, '}');
      }
      return out;
    }
    case 'cpp':
      if (has('checkidx')) out.push(head, `long long _idx(long long i, long long n) { if (i < 0 || i >= n) throw runtime_error(${q(x0)} + to_string(i) + ${q(x1)} + to_string(n) + ${q(x2)}); return i; }`, '');
      return out;
    default: return [];
  }
}

/** Meldung „keine Zahl“ bzw. „Komma statt Punkt“ für C/C++ (read_double): Ausdrücke für s (Eingabe) und t (getrimmt) */
function cNumFail(lang) {
  const [n0, n1] = parts('exec.notNumber', 1);
  const [c0, c1, c2] = parts('exec.commaNumber', 2);
  if (lang === 'cpp') {
    return ['[[noreturn]] void _num_fail(const string& s, string t) {', '    size_t c = t.find(\',\');',
      `    if (c != string::npos) { t[c] = '.'; if (_is_num(t.c_str())) throw runtime_error(${q(c0)} + s + ${q(c1)} + t + ${q(c2)}); }`,
      `    throw runtime_error(${q(n0)} + s + ${q(n1)});`, '}'];
  }
  return null;
}

module.exports = { checkHelpers, C_NUMCHECK, NUM_RE, cNumFail, parts };
