'use strict';
/**
 * Autoformatierung beim Übernehmen eines Blocks (Bearbeiten-Dialog) – Schreibweise wie die Vorlage im Dialog:
 *
 *   var summe: int := 0        INPUT "Zahl: ", x        OUTPUT "Summe: ", s        for i := 1 to n by 2
 *
 *  - Schlüsselwörter: INPUT und OUTPUT groß, alle anderen klein (var, const, return, for, to, and, true …).
 *    Erkannt wird wie bei der Hervorhebung am Zusammenhang – eine Variable namens Output oder by bleibt, wie sie ist.
 *  - Deklarationen: „var a , b : Int := 0“ -> „var a, b: int := 0“ (eingebaute Typen klein)
 *  - Zuweisungen: „x:=5“ -> „x := 5“
 *  - Signatur eines Unterprogramms: „fib(n : Int) : Int“ -> „fib(n: int): int“
 * Texte in Anführungszeichen bleiben unverändert.
 */
const { tokenize } = require('./tokenizer');
const { isKeyword } = require('./render');

const UPPER = new Set(['input', 'output']);
const LOWER_ALWAYS = new Set(['div', 'mod']); // Rechenwörter (überall Operator)
const TYPE_WORDS = new Set(['int', 'integer', 'long', 'short', 'byte', 'double', 'float', 'real', 'string', 'char', 'bool', 'boolean',
  'void', 'array', 'of']);

function toks(s) { try { return tokenize(s, 'pseudo'); } catch (e) { return null; } }
const isOp = (t, v) => t && t.t === 'op' && t.v === v;
const OPEN = new Set(['(', '[', '{']), CLOSE = new Set([')', ']', '}']);

/** Wörter im Text ersetzen (Strings und Leerraum dazwischen bleiben) */
function mapWords(s, fn) {
  const ts = toks(s);
  if (!ts) return s;
  let out = '', pos = 0;
  for (const t of ts) {
    if (t.t !== 'id') continue;
    const r = fn(t, s);
    if (r == null || r === t.v) continue;
    out += s.slice(pos, t.start) + r;
    pos = t.end;
  }
  return out + s.slice(pos);
}

/** Schlüsselwörter in die Schreibweise der Vorlage bringen */
function keywordCase(s) {
  return mapWords(s, (t, str) => {
    const lw = t.v.toLowerCase();
    if (/^\s*(:=|<-)/.test(str.slice(t.end))) return null; // Zuweisungsziel: Variable
    if (LOWER_ALWAYS.has(lw)) return lw;
    if (!isKeyword(str, t.v, t.start)) return null;
    return UPPER.has(lw) ? lw.toUpperCase() : lw;
  });
}

/** eingebaute Typnamen klein (Int -> int, String -> string); eigene Typen (Punkt) bleiben */
const typeCase = (s) => mapWords(s, (t) => (TYPE_WORDS.has(t.v.toLowerCase()) ? t.v.toLowerCase() : null));

/** Teile auf oberster Ebene an Kommas trennen (Originaltext, getrimmt) */
function splitTopRaw(s, ts, from, to) {
  const parts = [];
  let depth = 0, start = ts[from] ? ts[from].start : s.length;
  for (let i = from; i < to; i++) {
    const t = ts[i];
    if (t.t === 'op' && OPEN.has(t.v)) depth++;
    else if (t.t === 'op' && CLOSE.has(t.v)) depth--;
    else if (depth === 0 && isOp(t, ',')) { parts.push(s.slice(start, t.start).trim()); start = t.end; }
  }
  parts.push(s.slice(start, to < ts.length ? ts[to].start : s.length).trim());
  return parts.filter(Boolean);
}

/** var|dim|const name(n): typ [:= wert] -> einheitliche Form; sonst null */
function formatDecl(s) {
  const ts = toks(s);
  if (!ts || !ts.length || ts[0].t !== 'id') return null;
  const kw = ts[0].v.toLowerCase();
  if (!['var', 'dim', 'const'].includes(kw)) return null;
  let depth = 0, colon = -1, asg = -1;
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i];
    if (t.t === 'op' && OPEN.has(t.v)) depth++;
    else if (t.t === 'op' && CLOSE.has(t.v)) depth--;
    else if (depth === 0 && colon < 0 && isOp(t, ':')) colon = i;
    else if (depth === 0 && asg < 0 && (isOp(t, ':=') || isOp(t, '<-') || isOp(t, '='))) { asg = i; break; }
  }
  if (colon < 0 && asg < 0) {
    // var a , b  ->  var a, b
    return `${kw} ${splitTopRaw(s, ts, 1, ts.length).join(', ')}`;
  }
  const namesEnd = colon >= 0 ? colon : asg;
  const names = splitTopRaw(s, ts, 1, namesEnd).join(', ');
  if (!names) return null;
  let out = `${kw} ${names}`;
  if (colon >= 0) {
    const typeText = s.slice(ts[colon].end, asg >= 0 ? ts[asg].start : s.length).trim().replace(/\s+/g, ' ');
    if (!typeText) return null;
    out += `: ${typeCase(typeText)}`;
  }
  if (asg >= 0) {
    const init = s.slice(ts[asg].end).trim();
    // = bleibt stehen (die Prüfung meldet es als Fehler – := schreibt man selbst)
    out += ` ${ts[asg].v} ${init}`;
  }
  return out;
}

/** einheitliche Leerzeichen um die erste Zuweisung auf oberster Ebene */
function assignSpacing(s) {
  const ts = toks(s);
  if (!ts) return s;
  let depth = 0;
  for (const t of ts) {
    if (t.t === 'op' && OPEN.has(t.v)) depth++;
    else if (t.t === 'op' && CLOSE.has(t.v)) depth--;
    else if (depth === 0 && isOp(t, ':=')) return `${s.slice(0, t.start).trimEnd()} := ${s.slice(t.end).trimStart()}`;
  }
  return s;
}

/** INPUT/OUTPUT-Liste: „OUTPUT a , b“ -> „OUTPUT a, b“ (Form mit Klammern bleibt) */
function formatIo(s) {
  const ts = toks(s);
  if (!ts || ts.length < 2 || ts[0].t !== 'id' || !UPPER.has(ts[0].v.toLowerCase()) || isOp(ts[1], '(') || isOp(ts[1], ':=') || isOp(ts[1], '<-')) return null;
  return `${ts[0].v} ${splitTopRaw(s, ts, 1, ts.length).join(', ')}`;
}

/** Signatur „fib(n : Int, m:int) : Int“ -> „fib(n: int, m: int): int“ */
function formatSignature(s) {
  const ts = toks(s);
  if (!ts || !ts.some((t) => isOp(t, '('))) return s;
  let out = '', pos = 0;
  for (const t of ts) {
    if (isOp(t, ':')) { out += s.slice(pos, t.start).trimEnd() + ': '; pos = t.end; while (s[pos] === ' ') pos++; }
    else if (isOp(t, ',')) { out += s.slice(pos, t.start).trimEnd() + ', '; pos = t.end; while (s[pos] === ' ') pos++; }
  }
  return typeCase(out + s.slice(pos));
}

/**
 * Andere Deklarationsformen in die Form der Vorlage „var name: typ [:= wert]“:
 *   int x = 5  ->  var x: int := 5      String s  ->  var s: string      int[] feld  ->  var feld: int[]
 *   x: int     ->  var x: int           var x as int  ->  var x: int     dim y as Integer  ->  dim y: integer
 * Mehrere Namen mit verschiedenen Anfangswerten (int a = 1, b = 2) bleiben, wie sie sind (nicht in einer Zeile darstellbar).
 */
function toVarForm(s) {
  const ts = toks(s);
  if (!ts || ts.length < 2) return null;
  const first = ts[0].t === 'id' ? ts[0].v.toLowerCase() : '';
  // var/dim x as typ
  if (['var', 'dim'].includes(first)) {
    const as = ts.findIndex((t, i) => i > 1 && t.t === 'id' && t.v.toLowerCase() === 'as');
    if (as > 1 && !ts.some((t) => isOp(t, ':'))) return `${s.slice(0, ts[as].start).trimEnd()}: ${s.slice(ts[as].end).trim()}`;
    return null;
  }
  if (['const'].includes(first)) return null;
  // name: typ (ohne var) – nur wenn rechts ein Typ steht (Wörter und [])
  if (ts[0].t === 'id' && isOp(ts[1], ':') && ts.length > 2 && ts.slice(2).every((t) => t.t === 'id' || isOp(t, '[') || isOp(t, ']')) && !isKeyword(s, ts[0].v, 0)) {
    return `var ${s}`;
  }
  // C-Stil: typ name [= wert]
  const P = require('./pseudo');
  const c = P.classifyLine(s);
  if (c.kind !== 'decl' || !c.type || !c.decls.every((d) => 'suffix' in d)) return null;
  const inits = c.decls.filter((d) => d.init != null && d.init !== '');
  if (inits.length && c.decls.length > 1) return null;
  const names = c.decls.map((d) => d.name + (d.suffix || '')).join(', ');
  // Zuweisungszeichen wie geschrieben (int x <- 5 -> var x: int <- 5; ein = meldet die Prüfung als Fehler)
  const opTok = ts.find((t) => t.t === 'op' && (t.v === '=' || t.v === ':=' || t.v === '<-'));
  const op = opTok ? opTok.v : ':=';
  return `var ${names}: ${c.type}` + (inits.length ? ` ${op} ${inits[0].init}` : '');
}

/**
 * Leerzeichen: um zweistellige Operatoren (Rechnung, Vergleich, Zuweisung, && ||) genau eines, nach einem Komma eines,
 * davor keines; ein Vorzeichen (-1, a * -b, step -3, return -1) bleibt am Wert. Alles andere bleibt, wie es ist.
 */
const BINARY = new Set(['+', '-', '*', '/', '%', '=', '==', '===', '<>', '!=', '!==', '<', '>', '<=', '>=', ':=', '<-', '&&', '||']);
function spaceOps(s) {
  const ts = toks(s);
  if (!ts || !ts.length) return s;
  const unary = (i) => {
    const t = ts[i];
    if (!(t.t === 'op' && (t.v === '-' || t.v === '+'))) return false;
    const p = ts[i - 1];
    if (!p) return true;
    if (p.t === 'op') return !CLOSE.has(p.v);
    if (p.t === 'id') return /^(and|or|not|xor|div|mod)$/i.test(p.v) || isKeyword(s, p.v, p.start);
    return false;
  };
  const binary = (i) => ts[i].t === 'op' && BINARY.has(ts[i].v) && !unary(i);
  let out = s.slice(0, ts[0].start);
  for (let i = 0; i < ts.length; i++) {
    if (i > 0) {
      let gap = s.slice(ts[i - 1].end, ts[i].start);
      if (binary(i) || binary(i - 1)) gap = ' ';
      else if (isOp(ts[i], ',')) gap = '';
      else if (isOp(ts[i - 1], ',')) gap = ' ';
      else if (unary(i - 1)) gap = '';
      out += gap;
    }
    out += s.slice(ts[i].start, ts[i].end);
  }
  return out + s.slice(ts[ts.length - 1].end);
}

/** eine Zeile eines Elements formatieren */
function formatLine(line, type) {
  const s = String(line == null ? '' : line);
  if (!s.trim()) return s;
  if (type === 'root') return formatSignature(s.trim());
  let r = s.trim();
  if (type === 'instruction' || type === 'call' || type === 'jump') {
    r = toVarForm(r) || r;
    r = formatDecl(r) || formatIo(r) || r;
  }
  return keywordCase(spaceOps(r));
}

/** alle Zeilen eines Elements (Fallauswahl: Ausdruck und Marken) */
function formatLines(lines, type) {
  return lines.map((l) => formatLine(l, type));
}

module.exports = { formatLine, formatLines, formatDecl, keywordCase };
