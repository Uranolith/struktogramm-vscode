'use strict';
/**
 * Datenmodell eines Struktogramms (angelehnt an Structorizer).
 *
 * Dokument:   { roots: Root[] }
 * Root:       { type:'root', rootType:'program'|'sub'|'includable', text:string[], comment:string[], children:El[] }
 * Elemente:   instruction | call | jump        -> text
 *             alternative                      -> text[0]=Bedingung, qTrue, qFalse
 *             case                             -> text[0]=Ausdruck, text[1..]=Marken, branches (Array von Folgen)
 *                                                 letzte Marke "%" = kein default-Zweig
 *             for | while | repeat | forever   -> text, body
 *             parallel                         -> branches
 * Optional:   comment:string[], color:'rrggbb', disabled:boolean
 */

const toLines = (x) => (Array.isArray(x) ? x : String(x == null ? '' : x).split(/\r?\n/));

const mk = {
  root: (text, rootType = 'program', children = [], comment = []) =>
    ({ type: 'root', rootType, text: toLines(text), comment: toLines(comment).filter((l, i, a) => a.length > 1 || l), children }),
  instruction: (lines) => ({ type: 'instruction', text: toLines(lines) }),
  call: (lines) => ({ type: 'call', text: toLines(lines) }),
  jump: (lines) => ({ type: 'jump', text: toLines(lines) }),
  alternative: (cond, qTrue = [], qFalse = []) => ({ type: 'alternative', text: toLines(cond), qTrue, qFalse }),
  case: (disc, labels, branches) => ({ type: 'case', text: [disc, ...labels], branches }),
  for: (text, body = []) => ({ type: 'for', text: toLines(text), body }),
  while: (text, body = []) => ({ type: 'while', text: toLines(text), body }),
  repeat: (text, body = []) => ({ type: 'repeat', text: toLines(text), body }),
  forever: (body = []) => ({ type: 'forever', text: [], body }),
  parallel: (branches) => ({ type: 'parallel', text: [], branches }),
};

/** Alle Unterfolgen eines Elements: [{ key, seq }] mit key als Pfadfragment */
function sequencesOf(el) {
  switch (el.type) {
    case 'root': return [{ key: 'children', seq: el.children }];
    case 'alternative': return [{ key: 'qTrue', seq: el.qTrue }, { key: 'qFalse', seq: el.qFalse }];
    case 'case': case 'parallel': return el.branches.map((seq, i) => ({ key: 'branches/' + i, seq }));
    case 'for': case 'while': case 'repeat': case 'forever': return [{ key: 'body', seq: el.body }];
    default: return [];
  }
}

/** Tiefensuche über alle Elemente: cb(el, depth, parentSeq) */
function walk(seq, cb, depth = 0) {
  for (const el of seq) {
    if (cb(el, depth, seq) === false) continue;
    for (const s of sequencesOf(el)) walk(s.seq, cb, depth + 1);
  }
}

/** Neues Standard-Element für den Editor */
function defaultElement(kind) {
  switch (kind) {
    case 'instruction': return mk.instruction('');
    case 'call': return mk.call('Unterprogramm()');
    case 'jump': return mk.jump('leave');
    case 'alternative': return mk.alternative('Bedingung');
    case 'case': return mk.case('Ausdruck', ['1', '2', 'default'], [[], [], []]);
    case 'for': return mk.for('for i := 1 to 10');
    case 'foreach': return mk.for('foreach x in liste');
    case 'while': return mk.while('while Bedingung');
    case 'repeat': return mk.repeat('until Bedingung');
    case 'forever': return mk.forever();
    case 'parallel': return mk.parallel([[], []]);
    default: throw new Error('Unbekannter Elementtyp: ' + kind);
  }
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

module.exports = { mk, sequencesOf, walk, defaultElement, clone, toLines };
