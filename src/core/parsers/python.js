'use strict';
/** Python -> Struktogramm-Modell */
const { tokenize, joinTokens, matchClose, splitTop, findTop, isWrapped } = require('../tokenizer');
const { t } = require('../../i18n');
const { mk } = require('../model');
const { addConst } = require('../pseudo');
const { outputLine, inputLine, stripTrailingNewline, refine, addComment } = require('./common');

const COMPOUND = /^(async\s+)?(if|elif|else|while|for|def|class|try|except|finally|with|match|case)\b/;
const AUG = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=']);
const MATHF = new Set(['sqrt', 'floor', 'ceil', 'pow']);

/** Quelltext in logische Zeilen zerlegen: {indent, text, line} */
function logicalLines(src) {
  const res = [];
  const n = src.length;
  let i = 0, line = 1;
  while (i < n) {
    let indent = 0, j = i;
    while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\f')) { indent += src[j] === '\t' ? 8 - (indent % 8) : 1; j++; }
    if (j >= n) break;
    if (src[j] === '\r' || src[j] === '\n') { i = j + (src[j] === '\r' && src[j + 1] === '\n' ? 2 : 1); line++; continue; }
    if (src[j] === '#') { while (j < n && src[j] !== '\n') j++; i = j + 1; line++; continue; }
    let buf = '', depth = 0;
    const startLine = line;
    i = j;
    while (i < n) {
      const c = src[i];
      if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { i += src[i + 1] === '\r' ? 3 : 2; line++; buf += ' '; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { line++; i++; if (depth > 0) { buf += ' '; continue; } break; }
      // Strings
      let pre = 0;
      if (/[rRbBfFuU]/.test(c) && (i === 0 || !/[\w]/.test(src[i - 1]))) {
        const m = /^[rRbBfFuU]{1,2}(?=['"])/.exec(src.slice(i, i + 3));
        if (m) pre = m[0].length;
      }
      const q = src[i + pre];
      if ((q === '"' || q === "'") && (pre > 0 || c === q)) {
        let k = i + pre;
        if (src.startsWith(q + q + q, k)) {
          const e = src.indexOf(q + q + q, k + 3);
          k = e < 0 ? n : e + 3;
        } else {
          k++;
          while (k < n && src[k] !== q && src[k] !== '\n') { if (src[k] === '\\') k++; k++; }
          k++;
        }
        const s = src.slice(i, Math.min(k, n));
        for (const ch of s) if (ch === '\n') line++;
        buf += s;
        i = k;
        continue;
      }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
      buf += c;
      i++;
    }
    const text = buf.trim();
    if (text) res.push({ indent, text, line: startLine });
  }
  return res;
}

/** Erster Doppelpunkt auf oberster Ebene (ohne :=) */
function topColon(text) {
  const toks = tokenize(text, 'python');
  const k = findTop(toks, (t) => t.v === ':');
  return k < 0 ? -1 : toks[k].start;
}

function splitHeader(text) {
  const m = COMPOUND.exec(text);
  if (!m) return null;
  const kw = m[2];
  if ((kw === 'match' || kw === 'case') && /^(match|case)\s*[=.([]/.test(text) && !/:\s*$/.test(text)) return null;
  const c = topColon(text);
  if (c < 0) return null;
  const head = text.slice(0, c).trim();
  return { kw, head, rest: head.slice(m[0].length).trim(), inline: text.slice(c + 1).trim() };
}

function parseSuite(lines, pos, parentIndent) {
  const nodes = [];
  if (pos.i >= lines.length || lines[pos.i].indent <= parentIndent) return nodes;
  const ind = lines[pos.i].indent;
  while (pos.i < lines.length && lines[pos.i].indent >= ind) {
    const L = lines[pos.i];
    if (L.indent > ind) { // unerwartete Einrückung: als Teil der Folge behandeln
      nodes.push(...parseSuite(lines, pos, ind));
      continue;
    }
    pos.i++;
    const node = { text: L.text, line: L.line };
    const h = splitHeader(L.text);
    if (h) {
      Object.assign(node, h);
      node.children = h.inline ? splitSemis(h.inline).map((t) => ({ text: t, line: L.line })) : parseSuite(lines, pos, ind);
    }
    nodes.push(node);
  }
  return nodes;
}

function splitSemis(text) {
  const toks = tokenize(text, 'python');
  return splitTop(toks, ';').map((p) => (p.length ? text.slice(p[0].start, p[p.length - 1].end) : '')).filter((s) => s.trim());
}

class PyParser {
  constructor(src, opts = {}) {
    this.src = src;
    this.opts = opts;
    this.roots = [];
    this.userFuncs = new Set();
    const re = /^[ \t]*(?:async\s+)?def\s+([\wÀ-￿]+)/gm;
    let m;
    while ((m = re.exec(src))) this.userFuncs.add(m[1]);
    this.typed = new Set();
  }

  parse() {
    const lines = logicalLines(this.src);
    const pos = { i: 0 };
    const tree = [];
    while (pos.i < lines.length) {
      const before = pos.i;
      tree.push(...parseSuite(lines, pos, -1));
      if (pos.i === before) pos.i++;
    }
    this.typed = new Set();
    const top = refine(this.suite(tree, { top: true }));
    const onlyMain = top.length === 1 && /^main\s*\(\s*\)$/.test(top[0].text.join(''));
    const mainRoot = this.roots.find((r) => /^main\b/.test(r.text[0]));
    if (onlyMain && mainRoot) {
      mainRoot.rootType = 'program';
      mainRoot.text = ['main'];
    } else if (top.length || !this.roots.length) {
      this.roots.unshift(mk.root(this.opts.name || t('core.mainProgram'), 'program', top));
    }
    this.roots.sort((a, b) => (a.rootType === 'program' ? 0 : 1) - (b.rootType === 'program' ? 0 : 1));
    return { roots: this.roots };
  }

  suite(nodes, ctx = {}) {
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.kw) {
        switch (n.kw) {
          case 'def': this.def(n, ctx.cls); continue;
          case 'class': this.cls(n); continue;
          case 'if': {
            if (ctx.top && /^__name__\s*==\s*['"]__main__['"]$/.test(n.rest)) { out.push(...this.suite(n.children, ctx)); continue; }
            const [el, ni] = this.ifChain(nodes, i);
            out.push(el); i = ni; continue;
          }
          case 'elif': case 'else': case 'finally': case 'with':
            out.push(...this.suite(n.children)); continue;
          case 'except': continue;
          case 'while': {
            const cond = this.expr(n.rest);
            const body = this.suite(n.children);
            out.push(/^(true|1)$/.test(cond) ? mk.forever(body) : mk.while('while ' + cond, body));
            if (nodes[i + 1] && nodes[i + 1].kw === 'else') { out.push(...this.suite(nodes[i + 1].children)); i++; }
            continue;
          }
          case 'for': {
            out.push(this.forLoop(n));
            if (nodes[i + 1] && nodes[i + 1].kw === 'else') { out.push(...this.suite(nodes[i + 1].children)); i++; }
            continue;
          }
          case 'try': {
            // try / except / else / finally -> TRY-Element (erster except-Zweig wird der catch-Teil)
            const body = this.suite(n.children);
            let catchVar = null, catchBody = null, fin = [], extraExcept = 0;
            while (nodes[i + 1] && ['except', 'else', 'finally'].includes(nodes[i + 1].kw)) {
              i++;
              const nd = nodes[i];
              if (nd.kw === 'except') {
                if (catchBody) { extraExcept++; continue; }
                const m = /\bas\s+([\p{L}_][\p{L}\p{N}_]*)/u.exec(nd.text || '');
                catchVar = m ? m[1] : t('core.defErrorVar');
                catchBody = this.suite(nd.children);
              } else if (nd.kw === 'else') body.push(...this.suite(nd.children));
              else fin = this.suite(nd.children);
            }
            const el = mk.try(catchVar || t('core.defErrorVar'), body, catchBody || [], fin);
            if (extraExcept) addComment(el, t('parse.moreExcept', extraExcept));
            out.push(el);
            continue;
          }
          case 'match': out.push(this.match(n)); continue;
          default: out.push(...this.suite(n.children || [])); continue;
        }
      }
      out.push(...this.simple(n.text));
    }
    return out;
  }

  ifChain(nodes, i) {
    const n = nodes[i];
    const cond = this.expr(n.rest);
    const thenB = this.suite(n.children);
    const nx = nodes[i + 1];
    if (nx && nx.kw === 'elif') {
      const [el, ni] = this.ifChain(nodes, i + 1);
      return [mk.alternative(cond, thenB, [el]), ni];
    }
    if (nx && nx.kw === 'else') return [mk.alternative(cond, thenB, this.suite(nx.children)), i + 1];
    return [mk.alternative(cond, thenB, []), i];
  }

  forLoop(n) {
    const toks = tokenize(n.rest, 'python');
    const k = findTop(toks, (t) => t.v === 'in');
    const body = this.suite(n.children);
    if (k < 0) return mk.for('foreach ' + this.expr(n.rest), body);
    const target = joinTokens(toks.slice(0, k));
    const it = toks.slice(k + 1);
    if (it[0] && it[0].v === 'range' && it[1] && it[1].v === '(' && matchClose(it, 1) === it.length - 1) {
      const args = splitTop(it.slice(2, -1), ',').map((a) => this.exprToks(a));
      let start = '0', end, step = '1';
      if (args.length === 1) end = addConst(args[0], -1);
      else if (args.length >= 2) {
        start = args[0];
        step = args[2] || '1';
        end = /^-/.test(step) ? addConst(args[1], 1) : addConst(args[1], -1);
      }
      if (end != null) return mk.for(`for ${target} <- ${start} to ${end}` + (step !== '1' ? ` by ${step}` : ''), body);
    }
    return mk.for(`foreach ${target} in ${this.exprToks(it)}`, body);
  }

  match(n) {
    const disc = this.expr(n.rest);
    const labels = [], branches = [];
    let def = null;
    for (const c of n.children || []) {
      if (c.kw !== 'case') continue;
      let toks = tokenize(c.rest, 'python');
      const g = findTop(toks, (t) => t.v === 'if');
      if (g >= 0) toks = toks.slice(0, g);
      const alts = splitTop(toks, '|').map((p) => this.exprToks(p));
      if (alts.length === 1 && alts[0] === '_') { def = this.suite(c.children); continue; }
      labels.push(alts.join(', '));
      branches.push(this.suite(c.children));
    }
    if (def) { labels.push('default'); branches.push(def); } else { labels.push('%'); branches.push([]); }
    return mk.case(disc, labels, branches);
  }

  def(n, inClass) {
    const toks = tokenize(n.rest, 'python');
    const name = toks[0] ? toks[0].v : 'unbenannt';
    const open = toks.findIndex((t) => t.v === '(');
    const close = open >= 0 ? matchClose(toks, open) : -1;
    const params = [];
    if (open >= 0) {
      splitTop(toks.slice(open + 1, close), ',').forEach((p, idx) => {
        p = p.filter((t) => t.v !== '*' && t.v !== '**');
        if (!p.length || p[0].v === '/') return;
        if (inClass && idx === 0 && (p[0].v === 'self' || p[0].v === 'cls')) return;
        const eq = findTop(p, (t) => t.v === '=');
        if (eq >= 0) p = p.slice(0, eq);
        const c = findTop(p, (t) => t.v === ':');
        params.push({ name: p[0].v, type: c >= 0 ? joinTokens(p.slice(c + 1)) : null });
      });
    }
    const arrow = toks.findIndex((t, k) => k > close && t.v === '->');
    let ret = arrow >= 0 ? joinTokens(toks.slice(arrow + 1)) : null;
    if (ret === 'None') ret = null;
    const children = (n.children || []).slice();
    let comment = [];
    if (children[0] && !children[0].kw && /^[rRuU]?("""|'''|"|')/.test(children[0].text)) {
      comment = children[0].text.replace(/^[rRuU]?("""|'''|"|')/, '').replace(/("""|'''|"|')$/, '').trim().split('\n').map((s) => s.trim());
      children.shift();
    }
    const savedTyped = this.typed;
    this.typed = new Set(params.filter((p) => p.type).map((p) => p.name));
    const body = refine(this.suite(children, { cls: false }));
    this.typed = savedTyped;
    const isMain = name === 'main' && !params.length;
    const sig = `${name}(${params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(params.some((p) => p.type) ? '; ' : ', ')})` + (ret ? `: ${ret}` : '');
    this.roots.push(mk.root(isMain ? 'main' : sig, 'sub', body, comment));
  }

  cls(n) {
    for (const c of n.children || []) {
      if (c.kw === 'def') this.def(c, true);
      else if (c.kw === 'class') this.cls(c);
    }
  }

  /* -------------------------------------------------------------- */
  simple(text) {
    const out = [];
    for (const part of splitSemis(text)) out.push(...this.simpleOne(part));
    return out;
  }

  simpleOne(text) {
    const toks = tokenize(text, 'python');
    if (!toks.length) return [];
    const v0 = toks[0].v;
    if (toks.length === 1 && toks[0].t === 'str') return [];
    switch (v0) {
      case 'pass': case 'import': case 'from': case 'global': case 'nonlocal': return [];
      case 'return': return [mk.jump(toks.length > 1 ? 'return ' + this.exprToks(toks.slice(1)) : 'return')];
      case 'break': return [mk.jump('leave')];
      case 'continue': return [mk.jump('continue')];
      case 'raise': return [mk.jump('throw' + (toks.length > 1 ? ' ' + this.exprToks(toks.slice(1)) : ''))];
      default: break;
    }
    // Zuweisung
    const eqs = [];
    { let depth = 0; toks.forEach((t, k) => { if ('([{'.includes(t.v) && t.t === 'op') depth++; else if (')]}'.includes(t.v) && t.t === 'op') depth--; else if (depth === 0 && t.v === '=') eqs.push(k); }); }
    if (eqs.length) {
      const rhs = toks.slice(eqs[eqs.length - 1] + 1);
      const out = [];
      let prev = null;
      for (let e = eqs.length - 1; e >= 0; e--) {
        const lhsToks = toks.slice(e === 0 ? 0 : eqs[e - 1] + 1, eqs[e]);
        const c = findTop(lhsToks, (t) => t.v === ':');
        let type = null, target;
        if (c > 0) { type = joinTokens(lhsToks.slice(c + 1)); target = this.exprToks(lhsToks.slice(0, c)); }
        else target = this.exprToks(isWrapped(lhsToks) ? lhsToks.slice(1, -1) : lhsToks);
        if (prev == null) out.push(...this.assign(type, target, rhs));
        else out.push(mk.instruction((type ? type + ' ' : '') + `${target} <- ${prev}`));
        prev = target;
      }
      return out;
    }
    const aug = findTop(toks, (t) => AUG.has(t.v));
    if (aug > 0) {
      const target = this.exprToks(toks.slice(0, aug));
      let op = toks[aug].v.slice(0, -1);
      if (op === '//') op = '/';
      const rhs = toks.slice(aug + 1);
      const r = this.exprToks(rhs);
      return [mk.instruction(`${target} <- ${target} ${op} ${rhs.length > 1 && op !== '+' ? '(' + r + ')' : r}`)];
    }
    // Annotation ohne Wert
    const colon = findTop(toks, (t) => t.v === ':');
    if (colon > 0 && toks[0].t === 'id') {
      this.typed.add(toks[0].v);
      return [mk.instruction(`var ${joinTokens(toks.slice(0, colon))}: ${joinTokens(toks.slice(colon + 1))}`)];
    }
    // Aufrufe
    if (toks[toks.length - 1].v === ')') {
      const open = toks.findIndex((t) => t.v === '(');
      if (open > 0 && matchClose(toks, open) === toks.length - 1) {
        const callee = joinTokens(toks.slice(0, open)).replace(/\s+/g, '');
        const args = toks.length - open > 2 ? splitTop(toks.slice(open + 1, -1), ',') : [];
        if (callee === 'print') return this.print(args);
        if (/^(sys\.)?exit$|^quit$|^os\._exit$/.test(callee)) return [mk.jump('exit' + (args.length ? ' ' + this.exprToks(args[0]) : ''))];
        if (this.userFuncs.has(callee) || /^self\./.test(callee) && this.userFuncs.has(callee.slice(5))) {
          return [mk.call(this.exprToks(/^self\./.test(callee) ? toks.slice(2) : toks))];
        }
      }
    }
    return [mk.instruction(this.exprToks(toks))];
  }

  assign(type, target, rhs) {
    const inp = this.inputInfo(rhs);
    if (inp) {
      const lines = [];
      const t = type || inp.type;
      if (t && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(target) && !this.typed.has(target)) { lines.push(`var ${target}: ${t}`); this.typed.add(target); }
      lines.push(inputLine(inp.prompt, [target]));
      return [mk.instruction(lines)];
    }
    const r = this.exprToks(rhs);
    const line = (type ? `${type} ` : '') + `${target} <- ${r}`;
    if (type) this.typed.add(target);
    const open = rhs.findIndex((t) => t.v === '(');
    const isUserCall = open > 0 && rhs[rhs.length - 1].v === ')' && matchClose(rhs, open) === rhs.length - 1 && this.userFuncs.has(joinTokens(rhs.slice(0, open)).replace(/^self\./, ''));
    return [isUserCall ? mk.call(line) : mk.instruction(line)];
  }

  inputInfo(toks) {
    if (!toks.length || toks[toks.length - 1].v !== ')') return null;
    const open = toks.findIndex((t) => t.v === '(');
    if (open <= 0 || matchClose(toks, open) !== toks.length - 1) return null;
    const callee = joinTokens(toks.slice(0, open)).replace(/\s+/g, '');
    const inner = toks.slice(open + 1, -1);
    if (callee === 'input') {
      const prompt = inner.length === 1 && inner[0].t === 'str' && !/^[fF]/.test(inner[0].v) ? '"' + this.litOf(inner[0]) + '"' : (inner.length ? null : null);
      return { prompt, type: null };
    }
    if (['int', 'float', 'eval', 'bool', 'str'].includes(callee)) {
      const r = this.inputInfo(inner);
      if (r) return { prompt: r.prompt, type: { int: 'int', float: 'double', eval: null, bool: 'boolean', str: null }[callee] };
    }
    return null;
  }

  print(args) {
    const parts = [];
    let sep = ' ', end = '\\n';
    const pos = [];
    for (const a of args) {
      if (a[0] && a[0].t === 'id' && a[1] && a[1].v === '=') {
        const val = a.length === 3 && a[2].t === 'str' ? this.litOf(a[2]) : null;
        if (a[0].v === 'sep' && val != null) sep = val;
        if (a[0].v === 'end' && val != null) end = val;
        continue;
      }
      pos.push(a);
    }
    pos.forEach((a, k) => {
      if (k && sep) parts.push({ lit: sep });
      parts.push(...this.argParts(a));
    });
    const newline = /\\n$/.test(end);
    if (end && !newline) parts.push({ lit: end });
    stripTrailingNewline(parts);
    const el = mk.instruction(outputLine(parts));
    if (!newline && parts.length === 1 && parts[0].lit != null) el._prompt = parts[0].lit;
    return [el];
  }

  argParts(toks) {
    if (toks.length === 1 && toks[0].t === 'str') return this.strParts(toks[0]);
    const terms = splitTop(toks, '+');
    if (terms.length > 1 && terms.some((t) => t.length === 1 && t[0].t === 'str')) {
      const parts = [];
      for (const t of terms) {
        if (t.length === 1 && t[0].t === 'str') parts.push(...this.strParts(t[0]));
        else parts.push({ expr: this.exprToks(this.unStr(t)) });
      }
      return parts;
    }
    return [{ expr: this.exprToks(toks) }];
  }

  unStr(t) {
    if (t[0] && t[0].v === 'str' && t[1] && t[1].v === '(' && matchClose(t, 1) === t.length - 1) return t.slice(2, -1);
    return t;
  }

  /** Inhalt eines Python-Strings in Doppelquote-Form */
  litOf(tok) {
    let v = tok.v;
    const m = /^([rRbBfFuU]*)/.exec(v);
    const pre = m[1].toLowerCase();
    v = v.slice(m[1].length);
    let inner;
    if (v.startsWith('"""') || v.startsWith("'''")) inner = v.slice(3, -3).replace(/\n/g, '\\n');
    else inner = v.slice(1, -1);
    if (pre.includes('r')) inner = inner.replace(/\\/g, '\\\\');
    if (v[0] === "'") inner = inner.replace(/\\'/g, "'");
    return inner.replace(/(^|[^\\])"/g, '$1\\"').replace(/(^|[^\\])"/g, '$1\\"');
  }

  strParts(tok) {
    const m = /^([rRbBfFuU]*)/.exec(tok.v);
    if (!/f/i.test(m[1])) return [{ lit: this.litOf(tok) }];
    // f-String
    let v = tok.v.slice(m[1].length);
    const triple = v.startsWith('"""') || v.startsWith("'''");
    const inner = triple ? v.slice(3, -3) : v.slice(1, -1);
    const parts = [];
    let lit = '';
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '{' && inner[i + 1] === '{') { lit += '{'; i++; continue; }
      if (c === '}' && inner[i + 1] === '}') { lit += '}'; i++; continue; }
      if (c === '{') {
        let depth = 0, j = i + 1;
        for (; j < inner.length; j++) {
          if ('([{'.includes(inner[j])) depth++;
          else if (')]}'.includes(inner[j])) { if (depth === 0) break; depth--; }
        }
        let hole = inner.slice(i + 1, j);
        const ht = tokenize(hole, 'python');
        let cut = findTop(ht, (t) => t.v === ':' || (t.v === '!' && ht[ht.indexOf(t) + 1] && /^[rsa]$/.test(ht[ht.indexOf(t) + 1].v)));
        if (cut < 0) cut = ht.length;
        let ht2 = ht.slice(0, cut);
        if (ht2.length && ht2[ht2.length - 1].v === '=') ht2 = ht2.slice(0, -1);
        if (lit) { parts.push({ lit: lit.replace(/(^|[^\\])"/g, '$1\\"') }); lit = ''; }
        parts.push({ expr: this.exprToks(ht2) });
        hole = null;
        i = j;
        continue;
      }
      lit += c;
    }
    if (lit) parts.push({ lit: lit.replace(/(^|[^\\])"/g, '$1\\"') });
    return parts;
  }

  expr(text) { return this.exprToks(tokenize(text, 'python')); }

  /** Python-Ausdruck -> Pseudocode */
  exprToks(toks) {
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const nt = { ...t };
      if (t.t === 'op') {
        if (t.v === '==') nt.v = '=';
        else if (t.v === '!=') nt.v = '<>';
        else if (t.v === '//') { nt.v = '/'; nt.t = 'op'; nt.ws = true; }
      } else if (t.t === 'id') {
        if (t.v === 'True') nt.v = 'true';
        else if (t.v === 'False') nt.v = 'false';
        else if (t.v === 'None') nt.v = 'null';
        else if (t.v === 'is' && toks[i + 1] && toks[i + 1].v === 'not') { nt.v = '<>'; nt.t = 'op'; i++; }
        else if (t.v === 'is') { nt.v = '='; nt.t = 'op'; }
        else if (t.v === 'math' && toks[i + 1] && toks[i + 1].v === '.' && toks[i + 2] && MATHF.has(toks[i + 2].v)) { nt.v = toks[i + 2].v; i += 2; }
      } else if (t.t === 'str' && /^[a-zA-Z]*[fF]/.test(t.v)) {
        const parts = this.strParts(t);
        nt.v = parts.map((p) => (p.lit != null ? '"' + p.lit + '"' : (/[^\w.()[\]]/.test(p.expr) ? '(' + p.expr + ')' : p.expr))).join(' + ') || '""';
      } else if (t.t === 'str' && /^'/.test(t.v) && !t.v.startsWith("'''") && !t.v.includes('"')) {
        nt.v = '"' + t.v.slice(1, -1).replace(/\\'/g, "'") + '"';
      }
      out.push(nt);
    }
    return joinTokens(out);
  }
}

function parsePython(src, opts) {
  return new PyParser(src, opts).parse();
}

module.exports = { parsePython, logicalLines };
