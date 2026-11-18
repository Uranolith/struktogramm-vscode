'use strict';
/**
 * Bekannte Bezeichner eines Struktogramm-Dokuments für die Autovervollständigung im Editor.
 * Liefert { funcs: [{name, sig, params, rootType}], roots: [[{name, type}]] } – Variablen je Diagramm.
 */
const P = require('./pseudo');
const { sequencesOf } = require('./model');

const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function baseName(target) {
  const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)/u.exec(String(target || ''));
  return m ? m[1] : null;
}

function collectSymbols(doc) {
  const funcs = [];
  const roots = [];
  for (const r of (doc && doc.roots) || []) {
    let sig;
    try { sig = P.parseSignature(r.text); } catch (e) { sig = { name: '', params: [] }; }
    if (r.rootType !== 'program' && sig.name && IDENT.test(sig.name)) {
      funcs.push({
        name: sig.name,
        sig: (r.text || []).join(' ').trim(),
        params: sig.params.length,
        rootType: r.rootType,
      });
    }
    const vars = new Map();
    const add = (name, type) => {
      const n = baseName(name);
      if (!n || !IDENT.test(n)) return;
      if (!vars.has(n) || (!vars.get(n) && type)) vars.set(n, type || null);
    };
    for (const p of sig.params || []) add(p.name, p.type);
    const visit = (seq) => {
      for (const el of seq) {
        const lines = el.text || [];
        if (el.type === 'instruction' || el.type === 'call') {
          for (const line of lines) {
            let c;
            try { c = P.classifyLine(line); } catch (e) { continue; }
            if (c.kind === 'decl') for (const d of c.decls || []) add(d.name, c.type ? c.type + (d.suffix ? '[]' : '') : null);
            else if (c.kind === 'assign') for (const t of String(c.target).split(',')) add(t);
            else if (c.kind === 'input') for (const v of c.vars || []) add(v);
          }
        } else if (el.type === 'for') {
          let f = null;
          try { f = P.parseForText(lines.join(' ')); } catch (e) { /* ignorieren */ }
          if (f && f.var) add(f.var, f.kind === 'count' ? 'int' : null);
        }
        for (const s of sequencesOf(el)) visit(s.seq);
      }
    };
    visit(r.children || []);
    roots.push([...vars].map(([name, type]) => ({ name, type })));
  }
  return { funcs, roots };
}

module.exports = { collectSymbols };
