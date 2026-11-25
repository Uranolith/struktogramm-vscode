'use strict';
const { assignWithEq } = require('./style');
/**
 * Prüfungen für Struktogramme: Fehler (funktioniert nicht) und Hinweise (weicht von bewährter Praxis oder üblichen Konventionen ab).
 *
 *   lintDoc(doc) -> [{ path, severity: 'error' | 'hint', code, message }]
 *
 * Die Pfade sind dieselben wie beim Zeichnen (render.js) und bei den Haltepunkten (nsdxml.elementLines):
 * roots/0, roots/0/children/2, …/qTrue/0, …/branches/1/0, …/body/0, …/qTry/0.
 * Ausdrücke werden mit dem Parser des Interpreters gelesen – ein Syntaxfehler hier ist auch einer bei der Ausführung.
 */
const P = require('./pseudo');
const { parseExpr, Interpreter } = require('./executor');
const { t: tr } = require('../i18n');
const { inferTypes } = require('./generators');

/* eingebaute Funktionen des Interpreters (aus dessen Fallunterscheidungen gelesen, bleibt so automatisch aktuell) */
const BUILTINS = (() => {
  const p = Interpreter.prototype;
  const src = [p.builtin, p.turtleBuiltin, p.fileBuiltin].map((f) => (f ? f.toString() : '')).join('\n');
  return new Set([...src.matchAll(/case '([a-z_0-9]+)'/g)].map((m) => m[1]));
})();
/* Namen mit festem Wert */
const CONSTANTS = new Set(['true', 'false', 'wahr', 'falsch', 'pi', 'null', 'nil', 'none', 'result']);
/* Prozeduren, deren erstes Argument (bzw. bei insert das zweite) verändert wird */
const PROC_TARGET = { inc: 0, dec: 0, insert: 1, delete: 0 };
const LOOPS = new Set(['for', 'while', 'repeat', 'forever']);

/**
 * Gruppen der Hinweise (einzeln abschaltbar, Einstellungen struktogramm.hints.*):
 *  bestPractice  sauberer, verständlicher Stil
 *  conventions   übliche Konventionen für Struktogramme (die DIN 66261 legt nur die Sinnbilder fest, keine Regeln)
 *  confusion     funktioniert, verleitet aber zu Irrtümern
 *  logic         deutet auf einen Fehler im Ablauf hin
 * Fehler gehören zu keiner Gruppe und werden immer gemeldet.
 */
const CATEGORIES = ['bestPractice', 'conventions', 'confusion', 'logic'];
const CATEGORY = {
  untyped: 'bestPractice', untypedParam: 'bestPractice', untypedReturn: 'bestPractice', untypedVoid: 'bestPractice', noPrompt: 'bestPractice',
  caseBool: 'conventions', caseCond: 'conventions', multiLine: 'conventions', emptyLoop: 'conventions', emptyBlock: 'conventions', noName: 'conventions',
  caseElseCond: 'confusion', typeMix: 'confusion', floatEq: 'confusion', unused: 'confusion',
  endless: 'logic', condUnchanged: 'logic', unreachable: 'logic',
};
const lc = (s) => String(s || '').toLowerCase();
const linesOf = (el) => (el.text || []).map((l) => String(l)).filter((l) => l.trim());

/** Kinder eines Elements mit Pfad-Schlüssel (wie render.js) */
function childSeqs(el) {
  switch (el.type) {
    case 'alternative': return [['qTrue', el.qTrue || []], ['qFalse', el.qFalse || []]];
    case 'case': case 'parallel': return (el.branches || []).map((b, k) => [`branches/${k}`, b]);
    case 'for': case 'while': case 'repeat': case 'forever': return [['body', el.body || []]];
    case 'try': return [['qTry', el.qTry || []], ['qCatch', el.qCatch || []], ['qFinally', el.qFinally || []]];
    default: return [];
  }
}

/** alle Elemente einer Folge mit Pfad, Schleifentiefe und Eltern */
function walkSeq(seq, path, fn, ctx = { loops: 0 }) {
  seq.forEach((el, i) => {
    const p = `${path}/${i}`;
    if (fn(el, p, ctx, seq, i) === false) return;
    const inner = { ...ctx, loops: ctx.loops + (LOOPS.has(el.type) ? 1 : 0) };
    for (const [key, s] of childSeqs(el)) walkSeq(s, `${p}/${key}`, fn, inner);
  });
}

/** Syntaxbaum durchlaufen: gelesene Namen und Aufrufe sammeln */
function scanAst(n, out) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach((x) => scanAst(x, out)); return; }
  if (n.k === 'id') out.reads.push(n.name);
  if (n.k === 'call') {
    if (n.fn && n.fn.k === 'id') out.calls.push({ name: n.fn.name, argc: (n.args || []).length });
    else scanAst(n.fn, out);
    scanAst(n.args, out);
    return;
  }
  if ((n.op === '/' || n.op === 'div' || n.op === 'mod' || n.op === '%') && n.b && n.b.k === 'num' && Number(n.b.v) === 0) out.divZero = true;
  if (n.k === 'bin' && ['=', '==', '<>', '!='].includes(n.op)) out.cmps.push([n.a, n.b]);
  for (const k of Object.keys(n)) if (k !== 'k' && k !== 'fn' && typeof n[k] === 'object') scanAst(n[k], out);
}

/** Ausdruck lesen; liefert { reads, calls, divZero } oder { error } */
function readExpr(text) {
  const out = { reads: [], calls: [], divZero: false, cmps: [] };
  const s = String(text || '').trim();
  if (!s) return out;
  try { scanAst(parseExpr(s), out); } catch (e) { out.error = e.message; }
  return out;
}

/** Basisname eines Zuweisungsziels: a[i] -> a, p.x -> p */
function targetBase(target) {
  const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)/u.exec(String(target || ''));
  return m ? m[1] : null;
}

/** Bedingungstext eines Elements ohne Schlüsselwort (wie der Interpreter) */
function condText(el) {
  const kws = { alternative: ['if', 'wenn', 'falls'], while: ['while', 'solange', 'während'], repeat: ['until', 'bis'] }[el.type];
  const s = (el.text || []).map((l) => String(l).trim()).filter(Boolean).join(' ');
  return kws ? P.stripKeyword(s, kws).replace(/\s*\?$/, '') : s;
}

function lintDoc(doc) {
  const items = [];
  if (!doc || !Array.isArray(doc.roots)) return items;
  const seen = new Set();
  const add = (path, severity, code, message) => {
    const key = `${path}|${code}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ path, severity, code, category: severity === 'error' ? 'error' : CATEGORY[code] || 'bestPractice', message });
  };

  // Unterprogramme, Typen und gemeinsame Definitionen (includable) des ganzen Dokuments
  const subs = new Map();
  const typeNames = new Set();
  const enumConsts = new Set();
  const shared = new Set();
  doc.roots.forEach((root) => {
    const sig = P.parseSignature(root.text || []);
    if (root.rootType !== 'program' && sig && sig.name) {
      const list = subs.get(sig.name) || [];
      list.push(sig.params.length);
      subs.set(sig.name, list);
    }
    walkSeq(root.children || [], 'x', (el) => {
      for (const l of linesOf(el)) {
        const c = P.classifyLine(l);
        if (c.kind === 'typedef') { typeNames.add(c.name); (c.items || []).forEach((it) => enumConsts.add(it.name)); }
        if (root.rootType === 'includable') {
          if (c.kind === 'decl') c.decls.forEach((d) => shared.add(d.name));
          if (c.kind === 'assign') { const b = targetBase(c.target); if (b) shared.add(b); }
        }
      }
    });
  });

  // Typen, wie der Generator sie ableitet: Vorschläge für „Variable ohne Typ“
  const inferred = inferTypes(doc);
  doc.roots.forEach((root, ri) => lintRoot(root, `roots/${ri}`, inferred[ri] || { types: new Map(), returnType: null }));

  function lintRoot(root, rpath, inf) {
    const sig = P.parseSignature(root.text || []);
    const typed = new Set();   // mit Typ deklariert (var x: int, int x)
    const untypedDecls = [];   // var x := 5 – deklariert, aber ohne Typ
    const consts = new Set();  // Konstanten: Typ ergibt sich aus dem Wert
    let returnsValue = false;
    if (root.rootType === 'program' && !(root.text || []).join('').trim()) add(rpath, 'hint', 'noName', tr('lint.noName'));
    const assigned = new Map(); // Name -> Pfad der ersten Zuweisung
    const reads = new Map();    // Name -> [Pfade]
    const valueTypes = new Map(); // Name -> Set der zugewiesenen Typen (string / number)
    const known = new Set([...(sig ? sig.params.map((p) => p.name) : []), ...shared]);
    if (sig && sig.name && root.rootType !== 'program') known.add(sig.name); // Pascal-Stil: Funktionsname := Wert
    const loopVars = new Set();
    const setVar = (name, path) => { if (name && !assigned.has(name)) assigned.set(name, path); };
    const readVar = (name, path) => { if (!reads.has(name)) reads.set(name, []); reads.get(name).push(path); };
    const typeOfValue = (expr) => {
      const t = P.normType(P.inferType(expr));
      return t === 'string' ? 'string' : t === 'int' || t === 'double' ? 'number' : null;
    };
    const useExpr = (text, path) => {
      const r = readExpr(text);
      if (r.error) { add(path, 'error', 'syntax', tr('lint.syntax', r.error)); return r; }
      r.reads.forEach((n) => readVar(n, path));
      for (const c of r.calls) {
        const ln = lc(c.name);
        if (subs.has(c.name)) {
          const counts = subs.get(c.name);
          if (!counts.includes(c.argc)) add(path, 'error', 'argCount', tr('lint.argCount', c.name, counts.join(' / '), c.argc));
        } else if (!BUILTINS.has(ln) && !typeNames.has(c.name)) add(path, 'error', 'unknownFunc', tr('lint.unknownFunc', c.name));
      }
      if (r.divZero) add(path, 'error', 'divZero', tr('lint.divZero'));
      const isDouble = (n) => n && ((n.k === 'num' && n.isFloat) || (n.k === 'id' && P.normType(inf.types.get(n.name)) === 'double'));
      if (r.cmps.some(([a, b]) => isDouble(a) || isDouble(b))) {
        const fc = floatComparison(text, inf);
        if (fc) add(path, 'hint', 'floatEq', tr('lint.floatEq', fc.cmp, fc.better));
      }
      return r;
    };

    walkSeq(root.children || [], `${rpath}/children`, (el, path, ctx, seq, i) => {
      if (el.disabled) return false;
      const lines = linesOf(el);
      // nicht erreichbar: davor steht in derselben Folge exit/return/leave/throw
      const prev = seq[i - 1];
      if (prev && !prev.disabled && ['instruction', 'jump', 'call'].includes(prev.type)) {
        const last = linesOf(prev).map((l) => P.classifyLine(l)).pop();
        if (last && ['exit', 'return', 'leave', 'throw'].includes(last.kind)) add(path, 'hint', 'unreachable', tr('lint.unreachable', linesOf(prev).pop().trim()));
      }
      if (['instruction', 'call', 'jump'].includes(el.type)) {
        if (!lines.length) add(path, 'hint', 'emptyBlock', tr('lint.emptyBlock'));
        // mehrere Anweisungen in einem Block (ein reiner Deklarationsblock ist üblich und bleibt ohne Hinweis)
        if (lines.length > 1 && el.type === 'instruction' && !lines.every((l) => P.classifyLine(l).kind === 'decl')) add(path, 'hint', 'multiLine', tr('lint.multiLine', lines.length));
        for (const line of lines) {
          const c = P.classifyLine(line);
          // Zuweisung mit = (x = 5, var x: int = 5): = ist im Struktogramm der Vergleich – Fehler mit Korrektur
          const eq = assignWithEq(line);
          // = ist keine Zuweisung: nur diesen Fehler melden (keine Folgefehler wie „Syntax“ für dieselbe Zeile)
          if (eq) { add(path, 'error', 'assignEq', tr('lint.assignEq', line.trim(), eq)); continue; }
          switch (c.kind) {
            case 'assign': {
              const b = targetBase(c.target);
              setVar(b, path);
              if (sig && b === sig.name && root.rootType !== 'program') returnsValue = true;
              // Index bzw. Feld im Ziel lesen (a[i] := …)
              if (/[[.]/.test(c.target)) useExpr(c.target.replace(/^\s*[\p{L}_][\p{L}\p{N}_]*/u, '0'), path);
              useExpr(c.expr, path);
              const vt = typeOfValue(c.expr);
              if (b && vt) { if (!valueTypes.has(b)) valueTypes.set(b, new Map()); if (!valueTypes.get(b).has(vt)) valueTypes.get(b).set(vt, path); }
              break;
            }
            case 'decl':
              c.decls.forEach((d) => {
                known.add(d.name);
                if (c.type) typed.add(d.name);
                else if (!d.suffix) untypedDecls.push({ name: d.name, path, line, init: d.init, isConst: c.isConst });
                if (c.isConst) consts.add(d.name);
                if (d.init != null && d.init !== '') { setVar(d.name, path); useExpr(d.init, path); }
              });
              break;
            case 'input':
              c.vars.forEach((v) => setVar(targetBase(v), path));
              if (!c.prompt && c.vars.length) add(path, 'hint', 'noPrompt', tr('lint.noPrompt', c.vars[0]));
              break;
            case 'output': c.items.forEach((it) => useExpr(it, path)); break;
            case 'return': case 'exit': case 'throw':
              if (c.expr) { useExpr(c.expr, path); if (c.kind === 'return') returnsValue = true; }
              break;
            case 'leave':
              if (ctx.loops === 0) add(path, 'error', 'leaveOutside', tr('lint.leaveOutside'));
              else if (c.count > ctx.loops) add(path, 'error', 'leaveTooFar', tr('lint.leaveTooFar', c.count, ctx.loops));
              break;
            case 'typedef': case 'empty': case 'continue': break;
            default: {
              // Ausdruck bzw. Prozeduraufruf: inc(x), insert(w, s, i) verändern ein Argument
              const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*\((.*)\)\s*$/u.exec(line);
              if (m && PROC_TARGET[lc(m[1])] != null && !subs.has(m[1])) {
                const args = P.ptoks(m[2]);
                const parts = []; let depth = 0, cur = [];
                for (const t of args) { if (t.v === '(' || t.v === '[') depth++; if (t.v === ')' || t.v === ']') depth--; if (t.v === ',' && !depth) { parts.push(cur); cur = []; } else cur.push(t); }
                parts.push(cur);
                const tgt = parts[PROC_TARGET[lc(m[1])]];
                if (tgt && tgt.length) setVar(targetBase(tgt.map((t) => t.v).join('')), path);
                parts.forEach((p) => useExpr(p.map((t) => t.v).join(' '), path));
              } else if (!(m && ['randomize'].includes(lc(m[1])))) useExpr(line, path);
            }
          }
        }
        return;
      }
      if (el.type === 'alternative' || el.type === 'while' || el.type === 'repeat') {
        const cond = condText(el);
        if (!cond) add(path, 'error', 'emptyCond', tr('lint.emptyCond'));
        else useExpr(cond, path);
      }
      if (el.type === 'case') {
        const disc = String((el.text || [])[0] || '').trim();
        if (!disc) add(path, 'error', 'emptyCond', tr('lint.emptyCond'));
        else useExpr(disc, path);
        const labels = (el.text || []).slice(1).map((l) => String(l).trim());
        const n = (el.branches || []).length;
        const vals = [];
        labels.slice(0, Math.max(0, n - 1)).forEach((l) => {
          const r = readExpr(`[${l}]`);
          if (r.error) add(path, 'error', 'syntax', tr('lint.syntax', `${l}: ${r.error}`));
          else useExpr(`[${l}]`, path);
          vals.push(...l.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
        });
        const BOOL = ['true', 'false', 'wahr', 'falsch'];
        if (BOOL.includes(lc(disc))) {
          const conds = labels.slice(0, Math.max(0, n - 1)).filter(Boolean);
          const shown = conds.slice(0, 3).map((c) => `„${c}“`).join(', ') + (conds.length > 3 ? ', …' : '');
          add(path, 'hint', 'caseCond', tr('lint.caseCond', shown));
        } else if (vals.length && vals.every((v) => BOOL.includes(v))) add(path, 'hint', 'caseBool', tr('lint.caseBool', disc));
        const elseLabel = labels[n - 1];
        if (n > 0 && elseLabel && elseLabel !== '%' && /[<>=]|\b(and|or|not)\b/i.test(elseLabel)) add(path, 'hint', 'caseElseCond', tr('lint.caseElseCond', elseLabel));
      }
      if (el.type === 'for') {
        const f = P.parseForText(lines.join(' '));
        // for i = 1 to 10: Zuweisung mit = (wie bei Anweisungen ein Fehler, statt „Schleifenkopf nicht lesbar“)
        const eq = assignWithEq(lines.join(' '));
        if (eq) add(path, 'error', 'assignEq', tr('lint.assignEq', lines.join(' ').trim(), eq));
        else if (!f) add(path, 'error', 'badLoopHead', tr('lint.badLoopHead', lines.join(' ')));
        if (f) {
          setVar(f.var, path);
          loopVars.add(f.var);
          if (f.kind === 'count') [f.start, f.end, f.step].forEach((e) => useExpr(e, path));
          else useExpr(f.coll, path);
        }
      }
      if (el.type === 'try') {
        const v = String((el.text || [])[0] || '').trim();
        if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(v)) setVar(v, path);
      }
      if (LOOPS.has(el.type)) {
        const body = el.body || [];
        if (!body.length) add(path, 'hint', 'emptyLoop', tr('lint.emptyLoop'));
        const ex = loopExits(body);
        const condIsTrue = (el.type === 'while' && /^(true|wahr|1)$/i.test(condText(el))) || (el.type === 'repeat' && /^(false|falsch|0)$/i.test(condText(el)));
        if ((el.type === 'forever' || condIsTrue) && !ex.exits) add(path, 'hint', 'endless', tr('lint.endless'));
        else if ((el.type === 'while' || el.type === 'repeat') && !condIsTrue && !ex.exits && !ex.callsSub) {
          const r = readExpr(condText(el));
          const vars = [...new Set(r.reads)].filter((v) => !CONSTANTS.has(lc(v)) && !enumConsts.has(v) && !subs.has(v));
          if (!r.error && vars.length && !vars.some((v) => ex.changed.has(v))) add(path, 'hint', 'condUnchanged', tr('lint.condUnchanged', vars.join(', ')));
        }
      }
    });

    // Variablen ohne Wert und Werte, die nie verwendet werden
    for (const [name, paths] of reads) {
      if (assigned.has(name) || known.has(name) || loopVars.has(name)) continue;
      if (CONSTANTS.has(lc(name)) || enumConsts.has(name) || typeNames.has(name) || subs.has(name) || BUILTINS.has(lc(name))) continue;
      for (const p of paths) add(p, 'error', 'noValue', tr('lint.noValue', name));
    }
    for (const [name, path] of assigned) {
      if (reads.has(name) || loopVars.has(name) || (sig && name === sig.name) || lc(name) === 'result') continue;
      add(path, 'hint', 'unused', tr('lint.unused', name));
    }
    // Good Practice: Variablen, Parameter und Rückgabewerte mit Typ
    const typeName = (tp) => { const n = P.normType(tp); return n && n !== 'null' ? n : null; };
    for (const [name, path] of assigned) {
      if (typed.has(name) || consts.has(name) || loopVars.has(name) || known.has(name) || (sig && name === sig.name) || lc(name) === 'result') continue;
      const guess = typeName(inf.types.get(name));
      add(path, 'hint', 'untyped', guess ? tr('lint.untyped', name, guess) : tr('lint.untypedNoGuess', name));
    }
    // var s := "Hallo" bzw. const PI := 3.14 ist deklariert, der Typ aber nur aus dem Wert erschlossen: Typ angeben
    for (const u of untypedDecls) {
      let guess = typeName(inf.types.get(u.name));
      if (!guess && u.init) { try { guess = typeName(P.inferType(u.init, inf.types)); } catch (e) { guess = null; } }
      const esc = u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^(\\s*(?:var|dim|const)\\s+${esc})(?![\\p{L}\\p{N}_])`, 'iu');
      // Zuweisung im Vorschlag als := bzw. <- wie geschrieben (const MAX = 10 -> const MAX: int := 10)
      const better = guess && re.test(u.line)
        ? u.line.trim().replace(re, `$1: ${guess}`).replace(new RegExp(`^(\\s*(?:var|dim|const)\\s+${esc}: ${guess})\\s*(:=|<-|=)\\s*`, 'iu'), (m, head, op) => `${head} ${op === '<-' ? '<-' : ':='} `)
        : `${u.isConst ? 'const' : 'var'} ${u.name}: ${guess || '…'}`;
      add(u.path, 'hint', 'untyped', tr('lint.untypedDecl', u.name, better));
    }
    if (root.rootType !== 'program' && sig) {
      // Vorschläge getrennt: Parameter-Hinweis ergänzt nur die Parametertypen (Rückgabe wie geschrieben),
      // Rückgabe-Hinweis nur den Rückgabetyp (Parameter wie geschrieben)
      const ptype = (prm) => prm.type || typeName(inf.types.get(prm.name)) || 'int';
      const asWritten = (prm) => (prm.type ? `${prm.name}: ${prm.type}` : prm.name);
      const retWritten = sig.returnType ? `: ${sig.returnType}` : sig.returnVoid ? ': void' : '';
      const withParams = `${sig.name}(${sig.params.map((prm) => `${prm.name}: ${ptype(prm)}`).join(', ')})${retWritten}`;
      const withReturn = `${sig.name}(${sig.params.map(asWritten).join(', ')}): ${typeName(inf.returnType) || 'int'}`;
      for (const prm of sig.params) {
        if (prm.type) continue;
        add(rpath, 'hint', 'untypedParam', tr('lint.untypedParam', prm.name, withParams));
      }
      if (returnsValue && !sig.returnType) add(rpath, 'hint', 'untypedReturn', tr('lint.untypedReturn', sig.name, withReturn));
      // kein return: ausdrücklich „: void“ angeben, damit klar ist, dass absichtlich nichts zurückkommt
      if (!returnsValue && !sig.returnType && !sig.returnVoid) {
        add(rpath, 'hint', 'untypedVoid', tr('lint.untypedVoid', sig.name, `${sig.name}(${sig.params.map(asWritten).join(', ')}): void`));
      }
    }
    for (const [name, m] of valueTypes) {
      if (m.size > 1) add(m.get('string') === assigned.get(name) ? m.get('number') : m.get('string'), 'hint', 'typeMix', tr('lint.typeMix', name));
    }
  }

  return items;
}

/**
 * Erster Vergleich mit = bzw. <> zwischen Kommazahlen im Text – mit konkretem Vorschlag:
 *   x = 0.5   ->  abs(x - 0.5) < 0.000001        x <> 0.5  ->  abs(x - 0.5) >= 0.000001
 */
function floatComparison(text, inf) {
  const { splitTop, findTop, joinTokens } = require('./tokenizer');
  const toks = P.ptoks(text);
  const parts = splitTop(toks, (t) => t.t === 'id' && ['and', 'or', 'xor'].includes(t.v.toLowerCase()));
  const isDbl = (part) => {
    const src = joinTokens(part);
    if (part.length === 1 && part[0].t === 'num') return /[.eE]/.test(part[0].v);
    try { return P.normType(P.inferType(src, inf.types)) === 'double'; } catch (e) { return false; }
  };
  for (let part of parts) {
    while (part.length && part[0].t === 'id' && part[0].v.toLowerCase() === 'not') part = part.slice(1);
    if (part.length > 2 && part[0].v === '(' && part[part.length - 1].v === ')') part = part.slice(1, -1);
    const k = findTop(part, (t) => ['=', '==', '<>', '!='].includes(t.v));
    if (k <= 0) continue;
    const L = part.slice(0, k), R = part.slice(k + 1);
    if (!R.length || !(isDbl(L) || isDbl(R))) continue;
    const side = (p) => { const s = joinTokens(p); return p.length > 1 && !(p[0].v === '(' && p[p.length - 1].v === ')') && /[+\-]/.test(s) ? `(${s})` : s; };
    const ne = ['<>', '!='].includes(part[k].v);
    return { cmp: joinTokens(part), better: `abs(${side(L)} - ${side(R)}) ${ne ? '>=' : '<'} 0.000001` };
  }
  return null;
}

/** Wie verlässt ein Schleifenrumpf die Schleife, und welche Variablen ändert er? */
function loopExits(body) {
  const res = { exits: false, callsSub: false, changed: new Set() };
  const visit = (seq, depth) => {
    for (const el of seq) {
      if (el.disabled) continue;
      if (['instruction', 'call', 'jump'].includes(el.type)) {
        for (const l of linesOf(el)) {
          const c = P.classifyLine(l);
          if (c.kind === 'exit' || c.kind === 'return' || c.kind === 'throw') res.exits = true;
          if (c.kind === 'leave' && c.count > depth) res.exits = true;
          if (c.kind === 'assign') res.changed.add(targetBase(c.target));
          if (c.kind === 'input') c.vars.forEach((v) => res.changed.add(targetBase(v)));
          if (c.kind === 'decl') c.decls.forEach((d) => res.changed.add(d.name));
          if (c.kind === 'expr' || c.kind === 'empty') {
            const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*\((.*)\)\s*$/u.exec(l);
            if (m) {
              if (PROC_TARGET[lc(m[1])] != null) {
                const arg = m[2].split(',')[PROC_TARGET[lc(m[1])]];
                if (arg) res.changed.add(targetBase(arg));
              } else res.callsSub = true;
            }
          }
        }
        if (el.type === 'call') res.callsSub = true;
      }
      if (el.type === 'for') { const f = P.parseForText(linesOf(el).join(' ')); if (f) res.changed.add(f.var); }
      for (const [, s] of childSeqs(el)) visit(s, depth + (LOOPS.has(el.type) ? 1 : 0));
    }
  };
  visit(body, 0);
  return res;
}

module.exports = { lintDoc, BUILTINS, CATEGORY, CATEGORIES };
