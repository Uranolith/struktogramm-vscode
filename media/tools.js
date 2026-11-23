// Struktograf-Seitenleiste: Werkzeuge des Struktogramm-Editors als Liste
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const L10N = (() => { try { return JSON.parse(document.body.dataset.l10n || '{}'); } catch (e) { return {}; } })();
  const T = (k, ...a) => { const s = L10N[k] != null ? L10N[k] : k; return a.length ? s.replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? String(a[i]) : m)) : s; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ICONS = window.STRUKTO_ICONS || {};
  const ico = (inner) => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${inner}</svg>`;
  // einfache Strich-Symbole für die übrigen Befehle (16er Raster wie die Codicons)
  const G = {
    edit: '<path d="M10.5 2.5l3 3-8 8h-3v-3z M9 4l3 3"/>',
    delete: '<path d="M3 4.5h10 M6.5 4.5v-2h3v2 M4.5 4.5l.7 9h5.6l.7-9 M7 7v4.5 M9 7v4.5"/>',
    up: '<path d="M8 13.5v-11 M4 6.5l4-4 4 4"/>',
    down: '<path d="M8 2.5v11 M4 9.5l4 4 4-4"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M3.5 10.5h-1v-8h8v1"/>',
    cut: '<circle cx="4.5" cy="11.5" r="2"/><circle cx="11.5" cy="11.5" r="2"/><path d="M6 10l6-7.5 M10 10L4 2.5"/>',
    paste: '<rect x="3.5" y="3" width="9" height="11" rx="1"/><path d="M6 3V1.8h4V3 M6 7h4 M6 9.5h4"/>',
    undo: '<path d="M4.5 6.5h6a3 3 0 0 1 0 6h-4 M7 4L4.5 6.5 7 9"/>',
    redo: '<path d="M11.5 6.5h-6a3 3 0 0 0 0 6h4 M9 4l2.5 2.5L9 9"/>',
    sub: '<rect x="2.5" y="4.5" width="11" height="7"/><path d="M4.5 4.5v7 M11.5 4.5v7"/>',
    file: '<path d="M9.5 1.5h-6v13h9v-10z M9.5 1.5v3h3 M8 7.5v5 M5.5 10h5"/>',
    code: '<path d="M5.5 4.5L2 8l3.5 3.5 M10.5 4.5L14 8l-3.5 3.5 M9 3l-2 10"/>',
    export: '<path d="M8 10V2.5 M5 5.5l3-3 3 3 M3 9.5v4h10v-4"/>',
    open: '<path d="M9.5 2.5h4v4 M13.5 2.5L8 8 M7 3.5H2.5v10h10V9"/>',
    run: '<path d="M4.5 2.5v11l9-5.5z" class="fill"/>',
    step: '<path d="M3 3v10l7-5z M12.5 3v10" class="fill"/>',
    pause: '<path d="M5 3v10 M11 3v10"/>',
    stop: '<rect x="3.5" y="3.5" width="9" height="9" class="fill"/>',
    zoom: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3 M5 7h4 M7 5v4"/>',
    keys: '<rect x="1.5" y="4.5" width="13" height="7" rx="1"/><path d="M4 7h1 M7 7h2 M11 7h1 M5 9.5h6"/>',
    plus: '<path d="M8 3v10 M3 8h10"/>',
    minus: '<path d="M3 8h10"/>',
    reset: '<path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2 M3 2.5v2.8h2.8"/>',
  };
  const KINDS = ['instruction', 'alternative', 'case', 'for', 'while', 'repeat', 'forever', 'call', 'jump', 'try', 'parallel'];
  const combo = (k) => T('web.key.combo', k); // Strg+… bzw. auf dem Mac ⌘…
  // Pfeile der Abschnittsköpfe: Codicons chevron-down / chevron-right
  const TWISTY_DOWN = '<svg class="twisty" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/></svg>';
  const TWISTY_RIGHT = '<svg class="twisty" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"/></svg>';

  // Anordnung der Kategorien: Reihenfolge und eingeklappte (dauerhaft gespeichert von der Erweiterung)
  const saved = vscode.getState() || {};
  let order = Array.isArray(saved.order) ? saved.order : [];
  const collapsed = new Set(saved.collapsed || []);
  let layoutFromExtension = false;
  let current = { hasEditor: false, state: null, file: '' };

  function saveLayout() {
    vscode.setState({ order, collapsed: [...collapsed] });
    vscode.postMessage({ type: 'layout', order, collapsed: [...collapsed] });
  }

  // Abschnitte in Standardreihenfolge: [id, Überschrift, Zeilen]; Zeile: { id, label, icon, key, msg }
  function defaultSections() {
    return [
      ['insert', T('tools.section.insert'), [{ where: true }, ...KINDS.map((k) => ({
        id: 'kind:' + k, label: T(`web.kind.${k}`), icon: ICONS[k], title: T('web.tb.insertKind.title', T(`web.kind.${k}.title`), T(`web.kind.${k}.key`).toUpperCase()), msg: { kind: k },
      }))]],
      ['edit', T('tools.section.edit'), [
        { id: 'a:edit', label: T('web.tb.edit'), icon: G.edit, key: 'Enter', msg: { a: 'edit' } },
        { id: 'a:delete', label: T('web.tb.delete'), icon: G.delete, key: T('web.key.del'), msg: { a: 'delete' } },
        { id: 'a:up', label: T('web.menu.up'), icon: G.up, key: combo('↑'), msg: { a: 'up' } },
        { id: 'a:down', label: T('web.menu.down'), icon: G.down, key: combo('↓'), msg: { a: 'down' } },
        { id: 'a:undo', label: T('web.tb.undo'), icon: G.undo, key: combo('Z'), msg: { a: 'undo' } },
        { id: 'a:redo', label: T('web.tb.redo'), icon: G.redo, key: T('web.key.redo'), msg: { a: 'redo' } },
      ]],
      ['clipboard', T('tools.section.clipboard'), [
        { id: 'a:copy', label: T('web.tb.copy'), icon: G.copy, key: combo('C'), msg: { a: 'copy' } },
        { id: 'a:cut', label: T('web.tb.cut'), icon: G.cut, key: combo('X'), msg: { a: 'cut' } },
        { id: 'a:paste', label: T('web.tb.paste'), icon: G.paste, key: combo('V'), msg: { a: 'paste' } },
      ]],
      ['diagram', T('tools.section.diagram'), [
        { id: 'a:addSub', label: T('tools.addSub'), icon: G.sub, title: T('web.tb.addSub.title'), msg: { a: 'addSub' } },
        { id: 'a:newFile', label: T('tools.newFile'), icon: G.file, title: T('web.tb.newFile.title'), msg: { a: 'newFile' } },
      ]],
      ['code', T('tools.section.code'), [
        { id: 'a:toCode', label: T('web.tb.toCode'), icon: G.code, title: T('web.tb.toCode.title'), msg: { a: 'toCode' } },
        { id: 'a:export', label: T('web.tb.export'), icon: G.export, title: T('web.tb.export.title'), msg: { a: 'export' } },
        { id: 'a:structorizer', label: T('tools.structorizer'), icon: G.open, title: T('web.tb.structorizer.title'), msg: { a: 'structorizer' } },
      ]],
      ['run', T('tools.section.run'), [
        { id: 'x:run', label: (current.state && current.state.exec === 'paused') ? T('web.tb.continue') : T('web.tb.run'), icon: G.run, key: 'F5', cls: 'run', msg: { x: 'run' } },
        { id: 'x:step', label: T('web.tb.step'), icon: G.step, key: 'F10', msg: { x: 'step' } },
        { id: 'x:pause', label: T('tools.pause'), icon: G.pause, key: 'F6', msg: { x: 'pause' } },
        { id: 'x:stop', label: T('tools.stop'), icon: G.stop, key: T('tools.shift') + '+F5', msg: { x: 'stop' } },
        { speed: true },
      ]],
      ['view', T('tools.section.view'), [
        { zoom: true },
        { id: 'a:help', label: T('tools.shortcuts'), icon: G.keys, key: '?', msg: { a: 'help' } },
      ]],
    ];
  }

  /** Abschnitte in der vom Nutzer gewählten Reihenfolge (neue Abschnitte an ihrer Standardstelle) */
  function sections() {
    const def = defaultSections();
    const ids = def.map((s) => s[0]);
    const known = order.filter((id) => ids.includes(id));
    for (const id of ids) {
      if (known.includes(id)) continue;
      const before = ids.slice(ids.indexOf(id) + 1).find((x) => known.includes(x));
      known.splice(before ? known.indexOf(before) : known.length, 0, id);
    }
    return known.map((id) => def.find((s) => s[0] === id));
  }

  const zbtn = (a, svg, title) => `<button class="icon" data-a="${a}" title="${esc(title)}" aria-label="${esc(title)}">${ico(svg)}</button>`;

  const root = document.getElementById('root');

  function render() {
    const st = current.state || {};
    const dis = st.disabled || {};
    const off = !current.hasEditor;
    let h = '';
    if (off) {
      h += `<div class="empty"><p>${esc(T('tools.empty'))}</p><button class="primary" data-command="struktogramm.newFile">${esc(T('tools.newFile'))}</button></div>`;
    }
    for (const [id, head, rows] of sections()) {
      if (off) continue;
      const closed = collapsed.has(id);
      h += `<section class="${closed ? 'closed' : ''}" data-section="${id}"><button class="head" data-sec="${id}" draggable="true" aria-expanded="${!closed}" title="${esc(T('tools.dragHint'))}">${closed ? TWISTY_RIGHT : TWISTY_DOWN}<span class="title">${esc(head)}</span></button><div class="rows">`;
      for (const r of rows) {
        if (r.where) {
          const w = st.where === 'before' ? 'before' : 'after';
          h += `<div class="where" role="radiogroup" aria-label="${esc(T('web.tb.where'))}" title="${esc(T('web.tb.where'))}">${['after', 'before'].map((v) => `<button role="radio" aria-checked="${v === w}" class="${v === w ? 'on' : ''}" data-where="${v}" data-id="where-${v}">${esc(T(v === 'after' ? 'web.menu.insertAfter' : 'web.menu.insertBefore'))}</button>`).join('')}</div>`;
          continue;
        }
        if (r.speed) {
          const sp = String(st.speed != null ? st.speed : 200);
          // Tempo als Umschaltknöpfe (wie die Einfügeposition)
          h += `<div class="seg" role="radiogroup" aria-label="${esc(T('web.tb.speed'))}" title="${esc(T('web.tb.speed'))}">${[['400', 'slow'], ['200', 'medium'], ['50', 'fast'], ['0', 'instant']].map(([v, k]) => `<button role="radio" aria-checked="${v === sp}" class="${v === sp ? 'on' : ''}" data-speed="${v}" data-id="speed-${v}">${esc(T('tools.speed.' + k))}</button>`).join('')}</div>`;
          continue;
        }
        if (r.zoom) {
          // Zoom: Zeile mit kompaktem Zähler − [Eingabe] + und Zurücksetzen auf 100 %
          const z = st.zoom != null ? st.zoom : 100;
          h += `<div class="row ctl">${ico(G.zoom)}<span class="lbl">${esc(T('tools.zoom'))}</span><span class="stepper" role="group" aria-label="${esc(T('tools.zoom'))}">`
            + zbtn('zoomOut', G.minus, T('tools.zoomOut'))
            + `<input data-id="zoom" class="zoomInput bare" type="text" inputmode="numeric" spellcheck="false" autocomplete="off" value="${z} %" title="${esc(T('web.tb.zoomInput.title'))}" aria-label="${esc(T('web.tb.zoomInput'))}">`
            + zbtn('zoomIn', G.plus, T('tools.zoomIn'))
            + zbtn('zoomReset', G.reset, T('tools.zoomReset.title'))
            + '</span></div>';
          continue;
        }
        const disabled = !off && dis[r.id];
        h += `<button class="row${r.cls ? ' ' + r.cls : ''}" data-id="${r.id}"${disabled ? ' disabled' : ''} title="${esc(r.title || r.label)}">${ico(r.icon || '')}<span class="lbl">${esc(r.label)}</span>${r.key ? `<span class="desc">${esc(r.key)}</span>` : ''}</button>`;
      }
      h += '</div></section>';
    }
    const ae = document.activeElement;
    const focusId = ae && (ae.dataset.id || ae.dataset.sec);
    const typing = ae && ae.classList && ae.classList.contains('zoomInput') ? { value: ae.value, a: ae.selectionStart, b: ae.selectionEnd } : null;
    root.innerHTML = h;
    if (focusId) {
      const f = root.querySelector(`[data-id="${focusId}"], [data-sec="${focusId}"]`);
      if (f) { f.focus(); if (typing) { f.value = typing.value; f.setSelectionRange(typing.a, typing.b); } }
    }
  }

  const byId = () => Object.fromEntries(defaultSections().flatMap(([, , rows]) => rows).filter((r) => r.id).map((r) => [r.id, r]));

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.sec) {
      const id = b.dataset.sec;
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      saveLayout();
      render();
      return;
    }
    if (b.dataset.command) { vscode.postMessage({ type: 'command', command: b.dataset.command }); return; }
    if (b.dataset.speed != null && b.dataset.speed !== '') { vscode.postMessage({ type: 'tool', set: 'speed', value: Number(b.dataset.speed) }); return; }
    if (b.dataset.where) { vscode.postMessage({ type: 'tool', set: 'where', value: b.dataset.where }); return; }
    if (b.dataset.a) { vscode.postMessage({ type: 'tool', a: b.dataset.a }); return; }
    const r = byId()[b.dataset.id];
    if (!r) return;
    vscode.postMessage({ type: 'tool', ...r.msg });
  });

  /* ---------------- Kategorien verschieben: Drag & Drop am Kopf, Alt+↑/↓ per Tastatur ---------------- */
  function moveSection(id, targetId, after) {
    const ids = sections().map((s) => s[0]).filter((x) => x !== id);
    let i = ids.indexOf(targetId);
    if (i < 0) return;
    if (after) i++;
    ids.splice(i, 0, id);
    order = ids;
    saveLayout();
    render();
  }

  let dragId = null;
  const clearMarks = () => root.querySelectorAll('.drop-before, .drop-after, .dragging').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'dragging'));
  root.addEventListener('dragstart', (e) => {
    const head = e.target.closest && e.target.closest('.head');
    if (!head) return;
    dragId = head.dataset.sec;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    head.closest('section').classList.add('dragging');
  });
  root.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const sec = e.target.closest && e.target.closest('section');
    if (!sec) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = sec.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    root.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    if (sec.dataset.section !== dragId) sec.classList.add(after ? 'drop-after' : 'drop-before');
  });
  root.addEventListener('drop', (e) => {
    const sec = e.target.closest && e.target.closest('section');
    const id = dragId;
    dragId = null;
    if (!sec || !id) { clearMarks(); return; }
    e.preventDefault();
    const r = sec.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearMarks();
    if (sec.dataset.section !== id) moveSection(id, sec.dataset.section, after);
  });
  root.addEventListener('dragend', () => { dragId = null; clearMarks(); });
  root.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const head = e.target.closest && e.target.closest('.head');
    if (!head) return;
    const ids = sections().map((s) => s[0]);
    const i = ids.indexOf(head.dataset.sec);
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    e.preventDefault(); e.stopPropagation();
    moveSection(head.dataset.sec, ids[j], e.key === 'ArrowDown');
  }, true);

  /* ---------------- Zoomstufe direkt eingeben: 150, 150 % oder 1,5x; Enter/Verlassen übernimmt, Esc verwirft, ↑/↓ ±10 % ---------------- */
  const zoomOf = () => (current.state && current.state.zoom) || 100;
  function parseZoom(text) {
    const s = String(text).trim().replace(',', '.');
    const x = /^(\d+(?:\.\d+)?)\s*x$/i.exec(s);
    if (x) return parseFloat(x[1]) * 100;
    const v = parseFloat(s.replace('%', ''));
    return isNaN(v) ? null : v;
  }
  const sendZoom = (v) => { const z = Math.min(400, Math.max(30, Math.round(v))); current.state = { ...(current.state || {}), zoom: z }; vscode.postMessage({ type: 'tool', set: 'zoom', value: z }); return z; };
  const isZoomInput = (el) => el && el.classList && el.classList.contains('zoomInput');
  root.addEventListener('focusin', (e) => { if (isZoomInput(e.target)) { e.target.value = String(zoomOf()); e.target.select(); } });
  root.addEventListener('focusout', (e) => {
    if (!isZoomInput(e.target)) return;
    const v = parseZoom(e.target.value);
    e.target.value = (v != null && v > 0 ? sendZoom(v) : zoomOf()) + ' %';
  });
  root.addEventListener('keydown', (e) => {
    if (!isZoomInput(e.target)) return;
    const zi = e.target;
    if (e.key === 'Enter') { const v = parseZoom(zi.value); zi.value = String(v != null && v > 0 ? sendZoom(v) : zoomOf()); zi.select(); e.preventDefault(); }
    else if (e.key === 'Escape') { zi.value = String(zoomOf()); zi.select(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const cur = parseZoom(zi.value) || zoomOf();
      zi.value = String(sendZoom(Math.round(cur / 10) * 10 + (e.key === 'ArrowUp' ? 10 : -10)));
      zi.select();
      e.preventDefault(); e.stopPropagation();
    }
  }, true);
  // Pfeiltasten bewegen den Fokus durch die Liste (wie im Explorer)
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    const items = [...root.querySelectorAll('button:not([disabled]), select')].filter((x) => x.offsetParent !== null);
    const i = items.indexOf(document.activeElement);
    const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    if (n) { n.focus(); e.preventDefault(); }
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') {
      // gespeicherte Anordnung der Erweiterung einmalig übernehmen (überlebt auch einen Neustart von VS Code)
      if (m.layout && !layoutFromExtension) {
        layoutFromExtension = true;
        if (Array.isArray(m.layout.order)) order = m.layout.order;
        if (Array.isArray(m.layout.collapsed)) { collapsed.clear(); m.layout.collapsed.forEach((x) => collapsed.add(x)); }
        vscode.setState({ order, collapsed: [...collapsed] });
      }
      current = m;
      render();
    } else if (m.type === 'resetLayout') {
      order = []; collapsed.clear();
      vscode.setState({ order, collapsed: [] });
      render();
    }
  });
  render();
  vscode.postMessage({ type: 'ready' });
})();
