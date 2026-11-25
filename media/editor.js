// Webview-Skript für Struktogramm-Editor und Live-Vorschau
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const READONLY = document.body.dataset.readonly === '1';
  const $ = (id) => document.getElementById(id);
  // Übersetzungen kommen von der Extension (Englisch bzw. Deutsch), Platzhalter {0}, {1} …
  const L10N = (() => { try { return JSON.parse(document.body.dataset.l10n || '{}'); } catch (e) { return {}; } })();
  const T = (k, ...a) => {
    const s = L10N[k] != null ? L10N[k] : k;
    return a.length ? s.replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? String(a[i]) : m)) : s;
  };
  const toolbar = $('toolbar'), canvas = $('canvas'), scroller = $('scroller'), statusbar = $('statusbar');
  // Diagrammfläche per Tab erreichbar; Pfeiltasten wählen Elemente
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'application');
  scroller.setAttribute('aria-label', T('web.canvasLabel'));
  const menu = $('menu'), dialog = $('dialog'), message = $('message'), dropmark = $('dropmark');

  const saved = vscode.getState() || {};
  let doc = null;
  let svgText = '';
  let sel = saved.sel || null;
  let zoom = saved.zoom || 1;
  let where = saved.where || 'after';
  let hasClipboard = false;
  let settings = {};
  // Tempo (ms je Schritt): langsam 400, mittel 200, schnell 50, sofort 0
  const SPEEDS = [400, 200, 50, 0];
  // frühere Stufen auf die gleichnamige neue Stufe abbilden
  const OLD_SPEEDS = { 800: 400, 250: 400, 100: 200, 40: 50 };
  const savedSpeed = saved.speed != null ? Number(saved.speed) : null;
  let speed = savedSpeed == null ? 200 : SPEEDS.includes(savedSpeed) ? savedSpeed : (OLD_SPEEDS[savedSpeed] ?? 200);
  // Haltepunkte: im Struktogramm-Editor verwaltet sie VS Code (Meldung 'breakpoints'), in der Live-Vorschau die Seite
  let breakpoints = new Set(READONLY ? saved.bps || [] : []);
  let bpKinds = new Map();      // Pfad -> 'bp' | 'cond' (Bedingung/Trefferzahl) | 'log' (Logpoint)
  let bpDisabled = new Set();   // deaktivierte Haltepunkte (nur Anzeige)
  let framePath = null;         // in der Aufrufliste von VS Code gewählter Aufruf (Stelle im Diagramm)
  let lintItems = [];           // Prüfungen der Erweiterung: [{ path, severity: 'error'|'hint', message, label }]
  let execState = 'idle';
  let runPath = null;
  let errPath = null;
  let symbols = { funcs: [], roots: [] };

  const save = () => vscode.setState({ sel, zoom, where, speed, bps: READONLY ? [...breakpoints] : undefined });
  const post = (m) => vscode.postMessage(m);
  const op = (cmd) => post({ type: 'op', cmd });

  /* ------------------------------------------------------------------ */
  const ICONS = window.STRUKTO_ICONS || {};
  const icon = (k) => `<svg class="ico" viewBox="0 0 16 16">${ICONS[k] || ''}</svg>`;

  // [Typ, Name, Beschreibung, Taste zum Einfügen] – Namen und Tasten je Sprache
  const KIND_IDS = ['instruction', 'alternative', 'case', 'for', 'while', 'repeat', 'forever', 'call', 'jump', 'try', 'parallel'];
  const KINDS = KIND_IDS.map((k) => [k, T(`web.kind.${k}`), T(`web.kind.${k}.title`), T(`web.kind.${k}.key`)]);
  const KIND_BY_KEY = Object.fromEntries(KINDS.map(([k, , , key]) => [key, k]));

  const HINTS = Object.fromEntries([...KIND_IDS, 'root'].map((k) => [k, T(`web.hint.${k}`)]));
  const TYPE_NAMES = Object.fromEntries([...KIND_IDS, 'root'].map((k) => [k, T(`web.type.${k}`)]));
  const COLORS = ['ffffff', 'ffd6d6', 'ffe8c2', 'fff3a8', 'd6f5d6', 'cfefff', 'd8e2ff', 'eadcff', 'e6e6e6'];

  function buildToolbar() {
    const execGroup = `
      <span class="group exec">
        <button data-x="run" class="run" title="${T('web.tb.run.title')}">▶ <span>${T('web.tb.run')}</span></button>
        <button data-x="step" title="${T('web.tb.step.title')}">⏭ <span>${T('web.tb.step')}</span></button>
        <button data-x="pause" title="${T('web.tb.pause.title')}" aria-label="${T('web.tb.pause.title')}">⏸</button>
        <button data-x="stop" title="${T('web.tb.stop.title')}" aria-label="${T('web.tb.stop.title')}">⏹</button>
        <select id="speed" title="${T('web.tb.speed')}"><option value="400">${T('web.speed.slow')}</option><option value="200">${T('web.speed.medium')}</option><option value="50">${T('web.speed.fast')}</option><option value="0">${T('web.speed.instant')}</option></select>
      </span>`;
    const zoomGroup = `<span class="group"><button data-a="zoomOut" title="${T('web.tb.zoomOut.title')}" aria-label="${T('web.tb.zoomOut')}">−</button><input id="zoomInput" class="zoomInput" type="text" inputmode="numeric" spellcheck="false" autocomplete="off" title="${T('web.tb.zoomInput.title')}" aria-label="${T('web.tb.zoomInput')}"><button data-a="zoomIn" title="${T('web.tb.zoomIn.title')}" aria-label="${T('web.tb.zoomIn')}">+</button><button data-a="help" title="${T('web.tb.help.title')}" aria-label="${T('web.tb.help')}">?</button></span>`;
    if (READONLY) {
      toolbar.innerHTML = `
        <span class="group"><button data-a="saveNsd" class="primary" title="${T('web.tb.saveNsd.title')}">${T('web.tb.saveNsd')}</button>
        <button data-a="toCode" title="${T('web.tb.toCodePreview.title')}">${T('web.tb.toCode')}</button></span>
        <span class="group"><button data-a="export" title="${T('web.tb.export.title')}">${T('web.tb.export')}</button></span>
        ${execGroup}
        ${zoomGroup}
        <span class="hint">${T('web.tb.previewHint')}</span>`;
      return;
    }
    toolbar.innerHTML = `
      <span class="group" role="group" aria-label="${T('web.tb.insertGroup')}">${KINDS.map(([k, label, title, key]) => `<button data-kind="${k}" title="${escapeHtml(T('web.tb.insertKind.title', title, key.toUpperCase()))}" aria-label="${escapeHtml(T('web.tb.insertKind', label))}">${icon(k)}<span>${label}</span></button>`).join('')}</span>
      <span class="group">
        <select id="where" title="${T('web.tb.where')}"><option value="after">${T('web.tb.where.after')}</option><option value="before">${T('web.tb.where.before')}</option></select>
      </span>
      <span class="group">
        <button data-a="edit" title="${T('web.tb.edit.title')}">${T('web.tb.edit')}</button>
        <button data-a="delete" title="${T('web.tb.delete.title')}">${T('web.tb.delete')}</button>
        <button data-a="up" title="${T('web.tb.up.title')}" aria-label="${T('web.tb.up.title')}">↑</button>
        <button data-a="down" title="${T('web.tb.down.title')}" aria-label="${T('web.tb.down.title')}">↓</button>
      </span>
      <span class="group">
        <button data-a="copy" title="${T('web.tb.copy.title')}">${T('web.tb.copy')}</button>
        <button data-a="cut" title="${T('web.tb.cut.title')}">${T('web.tb.cut')}</button>
        <button data-a="paste" title="${T('web.tb.paste.title')}">${T('web.tb.paste')}</button>
      </span>
      <span class="group">
        <button data-a="undo" title="${T('web.tb.undo')}" aria-label="${T('web.tb.undo')}">↶</button>
        <button data-a="redo" title="${T('web.tb.redo')}" aria-label="${T('web.tb.redo')}">↷</button>
      </span>
      <span class="group">
        <button data-a="addSub" title="${T('web.tb.addSub.title')}">${T('web.tb.addSub')}</button>
        <button data-a="newFile" title="${T('web.tb.newFile.title')}">${T('web.tb.newFile')}</button>
      </span>
      <span class="group">
        <button data-a="toCode" class="primary" title="${T('web.tb.toCode.title')}">${T('web.tb.toCode')}</button>
        <button data-a="export" title="${T('web.tb.export.title')}">${T('web.tb.export')}</button>
        <button data-a="structorizer" title="${T('web.tb.structorizer.title')}">Structorizer</button>
      </span>
      ${execGroup}
      ${zoomGroup}`;
    const w = $('where');
    w.value = where;
    w.addEventListener('change', () => { where = w.value; save(); reportTools(); });
  }

  /** Zoomstufe direkt eingeben (wie in anderen Programmen): 150, 150 % oder 1,5x; Enter/Verlassen übernimmt, Esc verwirft */
  function parseZoom(text) {
    const s = String(text).trim().replace(',', '.');
    const x = /^(\d+(?:\.\d+)?)\s*x$/i.exec(s);
    if (x) return parseFloat(x[1]) * 100;
    const v = parseFloat(s.replace('%', ''));
    return isNaN(v) ? null : v;
  }

  function initZoomInput() {
    const zi = $('zoomInput');
    if (!zi) return;
    const commit = () => { const v = parseZoom(zi.value); if (v != null && v > 0) setZoom(v / 100); zi.value = Math.round(zoom * 100) + ' %'; };
    zi.addEventListener('focus', () => { zi.value = String(Math.round(zoom * 100)); zi.select(); });
    zi.addEventListener('blur', commit);
    zi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); zi.select(); e.preventDefault(); }
      else if (e.key === 'Escape') { zi.value = String(Math.round(zoom * 100)); zi.blur(); focusCanvas(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const cur = parseZoom(zi.value) || Math.round(zoom * 100);
        const step = e.key === 'ArrowUp' ? 10 : -10;
        setZoom((Math.round(cur / 10) * 10 + step) / 100);
        zi.value = String(Math.round(zoom * 100)); zi.select();
        e.preventDefault();
      }
    });
    applyZoom();
  }

  function initSpeed() {
    const sp = $('speed');
    if (!sp) return;
    sp.value = String(speed);
    sp.addEventListener('change', () => { speed = Number(sp.value); save(); post({ type: 'exec', cmd: 'config', delay: speed }); reportTools(); });
  }

  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.kind) insertKind(b.dataset.kind, e.shiftKey ? 'before' : where);
    else if (b.dataset.x) execCmd(b.dataset.x);
    else action(b.dataset.a);
  });

  /** Befehl aus der Struktograf-Seitenleiste ausführen (gleiche Wirkung wie der Knopf in der Werkzeugleiste) */
  function runTool(m) {
    if (READONLY) return;
    if (m.kind) insertKind(m.kind, m.where || where);
    else if (m.x) execCmd(m.x);
    else if (m.a) action(m.a);
    else if (m.set === 'where') { where = m.value === 'before' ? 'before' : 'after'; const w = $('where'); if (w) w.value = where; save(); }
    else if (m.set === 'zoom') { const v = Number(m.value); if (v > 0) setZoom(v / 100); }
    else if (m.set === 'speed') { speed = Number(m.value); const sp = $('speed'); if (sp) sp.value = String(speed); save(); post({ type: 'exec', cmd: 'config', delay: speed }); }
    reportTools();
  }

  /** Werkzeugleiste im Editor oder in der Seitenleiste (Einstellung struktogramm.toolbarLocation) */
  function setToolbarMode(mode) {
    document.body.classList.toggle('tools-sidebar', mode === 'sidebar');
  }

  /** Zustand der Knöpfe an die Seitenleiste melden (gesperrt, Einfügeposition, Tempo, Zoom, Ausführung) */
  let reportTimer = null, lastReport = '';
  function reportTools(force) {
    if (READONLY) return;
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      const disabled = {};
      toolbar.querySelectorAll('button').forEach((b) => {
        const id = b.dataset.kind ? 'kind:' + b.dataset.kind : b.dataset.x ? 'x:' + b.dataset.x : 'a:' + b.dataset.a;
        if (b.disabled) disabled[id] = true;
      });
      const state = { disabled, where, speed, zoom: Math.round(zoom * 100), exec: execState || 'idle' };
      const json = JSON.stringify(state);
      if (!force && json === lastReport) return;
      lastReport = json;
      post({ type: 'toolState', state });
    }, 30);
  }

  function insertKind(kind, w) {
    op({ op: 'insert', path: sel, kind, where: w || where });
  }

  function action(a) {
    switch (a) {
      case 'edit': openDialog(); break;
      case 'delete': if (sel) op({ op: 'delete', path: sel }); break;
      case 'up': if (sel) op({ op: 'move', path: sel, dir: -1 }); break;
      case 'down': if (sel) op({ op: 'move', path: sel, dir: 1 }); break;
      case 'copy': copySel(); break;
      case 'cut': if (copySel()) op({ op: 'delete', path: sel }); break;
      case 'paste': op({ op: 'pasteClipboard', path: sel, where }); break;
      case 'undo': post({ type: 'undo' }); break;
      case 'redo': post({ type: 'redo' }); break;
      case 'addSub': op({ op: 'addRoot', rootType: 'sub' }); break;
      case 'addMain': op({ op: 'addRoot', rootType: 'program' }); break;
      case 'toCode': post({ type: 'toCode' }); break;
      case 'saveNsd': post({ type: 'saveNsd' }); break;
      case 'svg': post({ type: 'exportSvg' }); break;
      case 'export': post({ type: 'exportMenu' }); break;
      case 'aiClip': post({ type: 'exportMenu', format: 'aiClip' }); break;
      case 'png': exportPng(); break;
      case 'zoomIn': setZoom(zoom * 1.15); break;
      case 'zoomOut': setZoom(zoom / 1.15); break;
      case 'zoomReset': setZoom(1); break;
      case 'openText': post({ type: 'openText' }); break;
      case 'structorizer': post({ type: 'openStructorizer' }); break;
      case 'toggleBp': toggleBreakpoint(); break;
      case 'bpCond': case 'bpHit': case 'bpLog': case 'bpEnable':
        if (sel) post({ type: 'editBreakpoint', path: sel, what: { bpCond: 'cond', bpHit: 'hit', bpLog: 'log', bpEnable: 'enable' }[a] });
        break;
      case 'help': showHelp(); break;
      case 'newFile': post({ type: 'newFile' }); break;
      default: break;
    }
  }

  function copySel() {
    if (!sel || sel.endsWith('/#') || /^roots\/\d+$/.test(sel)) return false;
    const el = getAt(sel);
    if (!el) return false;
    post({ type: 'copy', element: el });
    hasClipboard = true;
    updateButtons();
    status(T('web.copied', TYPE_NAMES[el.type] || el.type));
    return true;
  }

  /* ------------------------------------------------------------------ */
  function getAt(path) {
    if (!doc || !path) return null;
    let cur = doc;
    for (const s of path.split('/')) {
      if (s === '#') return null;
      if (cur == null) return null;
      cur = cur[/^\d+$/.test(s) ? parseInt(s, 10) : s];
    }
    return cur;
  }

  function setZoom(z) {
    zoom = Math.min(4, Math.max(0.3, z));
    applyZoom();
    save();
  }

  function applyZoom() {
    const svg = canvas.querySelector('svg');
    if (svg) {
      const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
      svg.style.width = w * zoom + 'px';
      svg.style.height = h * zoom + 'px';
    }
    const zi = $('zoomInput');
    if (zi && document.activeElement !== zi) zi.value = Math.round(zoom * 100) + ' %';
    reportTools();
  }

  function status(t) { statusbar.textContent = t || ''; }

  /** Kein Tooltip am Element selbst (Kommentar als <title>): Tooltips zeigen nur die Prüf-Marken */
  function noTitles(svg) { return String(svg).replace(/<title>[\s\S]*?<\/title>/g, ''); }

  function render() {
    canvas.innerHTML = svgText;
    applyZoom();
    markSelection(true);
    markExec(false);
  }

  function nodeFor(path) {
    if (!path) return null;
    return canvas.querySelector(`[data-path="${CSS.escape(path)}"]`);
  }

  function markSelection(scroll) {
    canvas.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
    const g = nodeFor(sel);
    if (sel && !g) sel = null;
    if (g) {
      g.classList.add('selected');
      if (scroll) {
        const r = g.getBoundingClientRect(), s = scroller.getBoundingClientRect();
        if (r.top < s.top || r.bottom > s.bottom) g.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    updateButtons();
    save();
  }

  function updateButtons() {
    if (READONLY) return;
    const el = getAt(sel);
    const isEmpty = sel && sel.endsWith('/#');
    const isRoot = sel && /^roots\/\d+$/.test(sel);
    const set = (a, on) => { const b = toolbar.querySelector(`[data-a="${a}"]`); if (b) b.disabled = !on; };
    set('edit', !!el);
    set('delete', !!el);
    set('up', !!el);
    set('down', !!el);
    set('copy', !!el && !isRoot);
    set('cut', !!el && !isRoot);
    set('paste', hasClipboard);
    if (!sel) status(doc && doc.roots.length ? T('web.st.idle') : '');
    else if (isEmpty) status(T('web.st.emptyBranch'));
    else if (el) status(T('web.st.selected', TYPE_NAMES[el.type] || el.type));
  }

  /* ------------------------------ Nachrichten ------------------------------ */
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'update') {
      closePicker(false); // neues Diagramm ersetzt eine offene Vorschau
      doc = m.doc;
      if (m.symbols) symbols = m.symbols;
      svgText = noTitles(m.svg || '');
      settings = m.settings || settings;
      if (m.hasClipboard != null) hasClipboard = m.hasClipboard;
      if (m.select !== undefined) sel = m.select;
      if (m.error) { message.hidden = false; message.innerHTML = ''; message.textContent = m.error; if (!READONLY) { const b = document.createElement('button'); b.textContent = T('web.openAsText'); b.onclick = () => action('openText'); message.appendChild(b); } }
      else message.hidden = true;
      if (!READONLY && doc && !doc.roots.length) {
        message.hidden = false;
        message.innerHTML = `${escapeHtml(T('web.emptyDiagram'))} <button id="startBtn">${escapeHtml(T('web.addMain'))}</button>`;
        $('startBtn').onclick = () => action('addMain');
      }
      render();
      if (m.editNew && sel) {
        const el = getAt(sel);
        if (el && (el.type !== 'forever' || reopenAsEdit)) openDialog(!reopenAsEdit);
        reopenAsEdit = false;
      }
    } else if (m.type === 'clipboard') {
      hasClipboard = m.has; updateButtons();
    } else if (m.type === 'renderPng') renderPng(m.svg, m.id);
    else if (m.type === 'execCommand') execCmd(m.cmd, m.noDebug);
    else if (m.type === 'breakpoints') {
      breakpoints = new Set(m.active.map((b) => b.path));
      bpKinds = new Map(m.active.map((b) => [b.path, b.kind]));
      bpDisabled = new Set(m.disabled || []);
      markExec(false);
    } else if (m.type === 'reveal') {
      // aus „Probleme“ (Code-Link): Element markieren, hinscrollen, Tastaturfokus ins Diagramm
      hideLintPop();
      if (m.path && nodeFor(m.path)) { sel = m.path; markSelection(true); status(describeSel()); focusCanvas(); }
    } else if (m.type === 'lint') {
      lintItems = m.items || [];
      drawLint(); // Meldungen nur als Tooltip an der Marke, nicht in der Statuszeile
    } else if (m.type === 'execFocus') {
      framePath = m.path || null;
      markExec(false);
      const g = nodeFor(framePath);
      if (g) followExec(g);
    }
    else if (m.type === 'tool') runTool(m);
    else if (m.type === 'zoomKey') setZoom(m.step === 'reset' ? 1 : m.step === 'in' ? zoom * 1.15 : zoom / 1.15);
    else if (m.type === 'toolbarMode') setToolbarMode(m.mode);
    else if (m.type === 'toolStateRequest') reportTools(true);
    else if (m.type === 'execTurtle') EX.turtle(m.ops);
    else if (m.type === 'execCompleted') EX.completed(m.items);
    else if (m.type === 'execCalls') EX.calls(m.items, m.total);
    else if (m.type === 'execMode') setExecMode(m.mode);
    else if (m.type === 'preview') { if (picker && m.token === picker.token) showPreview(m.svg && noTitles(m.svg), m.path); }
    else if (m.type === 'execReset') {
      errPath = null;
      EX.reset(m.title);
    } else if (m.type === 'execOut') {
      EX.out(m.lines);
    } else if (m.type === 'execState') {
      execState = m.state;
      runPath = m.state === 'done' ? null : m.path;
      if (!m.refresh) framePath = null; // neuer Halt oder weiter: Auswahl aus der Aufrufliste gilt nicht mehr
      if (m.errorPath) errPath = m.errorPath;
      // Ausführung im Panel unten: dort wird eingegeben, der Editor behält den Fokus nicht
      EX.state(m, !document.body.classList.contains('exec-in-panel'));
      updateExecButtons();
      markExec(m.state !== 'done'); // mitscrollen, damit der ausgeführte Bereich immer zu sehen ist
    }
  });

  /* ------------------------------ Ausführung ------------------------------ */
  /**
   * Ausführung steuern. run/step starten auch neu; over (Schritt über Aufrufe) und out (Rücksprung) kommen aus
   * der Debug-Sitzung von VS Code. noDebug: „Ausführen ohne Debuggen“ (Strg+F5) – Haltepunkte gelten nicht.
   */
  function execCmd(cmd, noDebug) {
    if (['run', 'step', 'over', 'out'].includes(cmd)) {
      const fresh = execState === 'idle' || execState === 'done';
      if (!fresh || cmd === 'run' || cmd === 'step') showExecPanel();
      let root;
      const mm = sel && /^roots\/(\d+)/.exec(sel);
      if (fresh && mm) root = parseInt(mm[1], 10);
      post({ type: 'exec', cmd, root, delay: speed, breakpoints: READONLY && !noDebug ? [...breakpoints] : undefined, noDebug: !!noDebug });
    } else post({ type: 'exec', cmd });
  }

  function updateExecButtons() {
    const busy = execState === 'running' || execState === 'paused' || execState === 'input';
    const set = (x, on) => { const b = toolbar.querySelector(`[data-x="${x}"]`); if (b) b.disabled = !on; };
    set('run', execState !== 'running' && execState !== 'input');
    set('step', execState !== 'running' && execState !== 'input');
    set('pause', execState === 'running');
    set('stop', busy);
    const rb = toolbar.querySelector('[data-x="run"] span');
    if (rb) rb.textContent = execState === 'paused' ? T('web.tb.continue') : T('web.tb.run');
  }

  /**
   * Ausgeführtes Element sichtbar halten: nur scrollen, wenn es (fast) aus dem Bild läuft, dann mittig platzieren.
   * Ist es höher als der sichtbare Bereich (z.B. eine Schleife mit Rumpf), bleibt sein Anfang oben sichtbar.
   */
  function followExec(g) {
    const bg = g.querySelector(':scope > rect.bg') || g;
    const r = bg.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    const m = 24; // Rand, ab dem nachgeführt wird
    const visH = s.height, visW = s.width;
    if (r.top < s.top + m || r.bottom > s.bottom - m) {
      const off = r.height > visH - 2 * m ? m : (visH - r.height) / 2;
      scroller.scrollTop += r.top - s.top - off;
    }
    if (r.left < s.left + m || r.right > s.right - m) {
      const off = r.width > visW - 2 * m ? m : (visW - r.width) / 2;
      scroller.scrollLeft += r.left - s.left - off;
    }
  }

  function markExec(scroll) {
    canvas.querySelectorAll('.running, .errorel, .bp').forEach((n) => n.classList.remove('running', 'errorel', 'bp'));
    for (const p of breakpoints) { const g = nodeFor(p); if (g) g.classList.add('bp'); }
    drawBreakpointFrames();
    drawLint();
    const g = nodeFor(runPath);
    if (g) {
      g.classList.add('running');
      if (scroll) followExec(g);
    }
    const e = nodeFor(errPath);
    if (e) e.classList.add('errorel');
  }

  /**
   * Haltepunkt-Rahmen in einer eigenen Ebene ganz oben im SVG zeichnen,
   * damit Nachbarelemente und Linien sie nicht überdecken.
   */
  function drawBreakpointFrames() {
    const svg = canvas.querySelector('svg');
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    let layer = svg.querySelector('#bpLayer');
    if (!layer) { layer = document.createElementNS(NS, 'g'); layer.id = 'bpLayer'; }
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    svg.appendChild(layer); // immer als letztes Kind = oberste Ebene
    const frame = (p, cls) => {
      const g = nodeFor(p);
      const bg = g && g.querySelector(':scope > rect.bg');
      if (!bg) return;
      const r = document.createElementNS(NS, 'rect');
      for (const a of ['x', 'y', 'width', 'height', 'rx', 'ry']) if (bg.hasAttribute(a)) r.setAttribute(a, bg.getAttribute(a));
      r.setAttribute('class', cls);
      layer.appendChild(r);
    };
    for (const p of bpDisabled) if (!breakpoints.has(p)) frame(p, 'bp-frame off');
    for (const p of breakpoints) frame(p, 'bp-frame ' + (bpKinds.get(p) || 'bp'));
    // in der Aufrufliste von VS Code gewählter Aufruf
    if (framePath && framePath !== runPath) frame(framePath, 'frame-focus');
  }

  /**
   * Fehler- und Hinweismarken oben rechts im Element (eigene Ebene über dem Diagramm). Die Marke trägt den Pfad ihres
   * Elements: Klick wählt es aus, Doppelklick bearbeitet es; der Tooltip nennt alle Meldungen.
   */
  function drawLint() {
    const svg = canvas.querySelector('svg');
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    let layer = svg.querySelector('#lintLayer');
    if (!layer) { layer = document.createElementNS(NS, 'g'); layer.id = 'lintLayer'; }
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    svg.appendChild(layer); // oberste Ebene, über den Haltepunkt-Rahmen
    const byPath = new Map();
    for (const it of lintItems) { if (!byPath.has(it.path)) byPath.set(it.path, []); byPath.get(it.path).push(it); }
    for (const [p, list] of byPath) {
      const g = nodeFor(p);
      const bg = g && (g.querySelector(':scope > rect.bg') || g.querySelector(':scope > rect'));
      if (!bg) continue;
      const x = +bg.getAttribute('x'), y = +bg.getAttribute('y'), w = +bg.getAttribute('width');
      ['error', 'hint'].filter((k) => list.some((i) => i.severity === k)).forEach((k, idx) => {
        const b = document.createElementNS(NS, 'g');
        b.setAttribute('class', 'lint-badge ' + k);
        b.setAttribute('data-path', p);
        const cx = x + w - 10 - idx * 17, cy = y + 10;
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '7');
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', cx); t.setAttribute('y', cy + 3.6); t.setAttribute('text-anchor', 'middle');
        t.textContent = k === 'error' ? '!' : 'i';
        b.append(c, t);
        b.addEventListener('mouseenter', () => showLintHover(b, list.filter((i) => i.severity === k)));
        b.addEventListener('mouseleave', () => hideLintHover());
        layer.appendChild(b);
      });
    }
  }

  /**
   * F8 / Umschalt+F8 wie in VS Code: zum nächsten bzw. vorherigen Element mit Fehler oder Hinweis (Reihenfolge wie im
   * Diagramm, am Ende wieder von vorn), auswählen und die Meldungen darunter einblenden (wie das Problem-Fenster).
   */
  function gotoProblem(dir) {
    hideLintPop();
    const order = [...canvas.querySelectorAll('svg [data-path]')].map((n) => n.getAttribute('data-path'));
    const pos = (p) => order.indexOf(p);
    const paths = [...new Set(lintItems.map((i) => i.path))].filter((p) => pos(p) >= 0).sort((a, b) => pos(a) - pos(b));
    if (!paths.length) { status(T('web.lint.none')); return; }
    let k = paths.indexOf(sel);
    if (k >= 0) k = (k + dir + paths.length) % paths.length;
    else {
      const cur = sel ? pos(sel) : -1;
      if (dir > 0) { k = paths.findIndex((p) => pos(p) > cur); if (k < 0) k = 0; }
      else { k = -1; paths.forEach((p, i) => { if (pos(p) < cur) k = i; }); if (k < 0) k = paths.length - 1; }
    }
    sel = paths[k];
    markSelection(true);
    status(describeSel());
    showLintPop(sel, k + 1, paths.length);
  }

  /**
   * Meldung gegliedert darstellen: Aussage (fett), „Besser: …“ mit Code-Vorschlag, „Grund: …“ zurückgenommen.
   * Die Texte kommen fertig übersetzt aus der Erweiterung; gegliedert wird an „Besser…:“/„Better…:“ und „Grund:“/„Reason:“.
   */
  function lintHtml(items) {
    // Namen und Vorschläge in „…“ / “…” als Code; ein Vorschlag ohne solche Anführungszeichen, der nach Code aussieht
    // (INPUT "n: ", n  ·  abs(a - b) < 0.000001), als Ganzes
    const code = (txt) => escapeHtml(txt).replace(/„([^“]+)“|“([^”]+)”/g, (m0, a, b) => `<code>${a || b}</code>`);
    const suggestion = (txt) => (!/[„“”]/.test(txt) && /[()"=<>\[\]]/.test(txt) ? `<code>${escapeHtml(txt)}</code>` : code(txt));
    return items.map((i) => {
      let main = String(i.message), better = '', betterLabel = '', reason = '', reasonLabel = '';
      const r = /\s(Grund|Reason):\s/.exec(main);
      if (r) { reasonLabel = r[1]; reason = main.slice(r.index + r[0].length); main = main.slice(0, r.index); }
      const b = /\s((?:Besser|Better)[^:.]*):\s/.exec(main);
      if (b) { betterLabel = b[1]; better = main.slice(b.index + b[0].length).replace(/\.\s*$/, ''); main = main.slice(0, b.index); }
      main = main.trim().replace(/\.$/, '');
      return `<div class="lp-item ${i.severity}"><span class="lp-ico">${i.severity === 'error' ? '!' : 'i'}</span><div class="lp-body">` +
        `<div class="lp-main">${code(main)}</div>` +
        (better ? `<div class="lp-better"><span class="lp-label">${escapeHtml(betterLabel)}:</span> ${suggestion(better)}</div>` : '') +
        (reason ? `<div class="lp-reason"><span class="lp-label">${escapeHtml(reasonLabel)}:</span> ${code(reason)}</div>` : '') +
        '</div></div>';
    }).join('');
  }

  /** Fenster an einem Rechteck ausrichten: darunter, sonst darüber; innerhalb des Fensters */
  function placePop(pop, r, alignRight) {
    const w = Math.min(460, window.innerWidth - 24);
    pop.style.width = w + 'px';
    const left = alignRight ? r.right - w : r.left;
    pop.style.left = Math.max(12, Math.min(left, window.innerWidth - w - 12)) + 'px';
    const below = r.bottom + 6, h = pop.offsetHeight;
    pop.style.top = (below + h < window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6)) + 'px';
  }

  /** Hover über einer Marke: Meldungen dieser Art (Fehler bzw. Hinweise) gegliedert anzeigen */
  let lintHover = null;
  function hideLintHover() { if (lintHover) { lintHover.remove(); lintHover = null; } }
  function showLintHover(badge, items) {
    hideLintHover();
    if (!items.length) return;
    lintHover = document.createElement('div');
    lintHover.className = 'lint-pop';
    lintHover.setAttribute('role', 'tooltip');
    const sev = items[0].severity;
    const head = items.length > 1 ? `${items[0].label} (${items.length})` : items[0].label;
    lintHover.innerHTML = `<div class="lp-head ${sev}">${escapeHtml(head)}</div>` + lintHtml(items);
    document.body.appendChild(lintHover);
    placePop(lintHover, badge.getBoundingClientRect(), true);
  }
  $('scroller').addEventListener('scroll', () => hideLintHover(), { passive: true });

  let lintPop = null;
  function hideLintPop() { if (lintPop) { lintPop.remove(); lintPop = null; } }
  function showLintPop(path, n, total) {
    const g = nodeFor(path);
    if (!g) return;
    const r = g.getBoundingClientRect();
    const items = lintItems.filter((i) => i.path === path).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
    hideLintHover();
    lintPop = document.createElement('div');
    lintPop.id = 'lintPop';
    lintPop.className = 'lint-pop';
    lintPop.setAttribute('role', 'status');
    lintPop.innerHTML = `<div class="lp-head">${escapeHtml(T('web.lint.count', n, total))}<span class="lp-keys">F8 / ${escapeHtml(T('web.lint.shiftF8'))}</span></div>` + lintHtml(items);
    document.body.appendChild(lintPop);
    placePop(lintPop, r, false);
  }
  // schließt bei Klick oder einer anderen Taste (wie das Problem-Fenster in VS Code)
  document.addEventListener('mousedown', () => hideLintPop(), true);
  document.addEventListener('keydown', (e) => { if (e.key !== 'F8' && e.key !== 'Shift') hideLintPop(); }, true);
  // beim Scrollen passt die Lage nicht mehr zum Element
  $('scroller').addEventListener('scroll', () => hideLintPop(), { passive: true });

  function toggleBreakpoint() {
    if (!sel || sel.endsWith('/#') || /^roots\/\d+$/.test(sel)) { status(T('web.bp.onlyElements')); return; }
    if (!READONLY) {
      // VS Code setzt/entfernt den Haltepunkt und meldet den neuen Stand zurück
      status(breakpoints.has(sel) || bpDisabled.has(sel) ? T('web.bp.removed') : T('web.bp.set'));
      post({ type: 'toggleBreakpoint', path: sel });
      return;
    }
    if (breakpoints.has(sel)) breakpoints.delete(sel); else breakpoints.add(sel);
    save();
    markExec(false);
    post({ type: 'exec', cmd: 'config', breakpoints: [...breakpoints] });
    status(breakpoints.has(sel) ? T('web.bp.set') : T('web.bp.removed'));
  }

  function showExecPanel() { if (!document.body.classList.contains('exec-in-panel')) $('execpanel').hidden = false; }

  /** Ausführungsanzeige im Editor ('editor') oder im Panel unten in VS Code ('panel') */
  function setExecMode(mode) {
    const inPanel = mode === 'panel';
    document.body.classList.toggle('exec-in-panel', inPanel);
    if (!inPanel && execState !== 'idle') $('execpanel').hidden = false;
  }

  // wartet die Ausführung auf eine Eingabe, landet der Cursor beim Fokussieren des Editors im Eingabefeld
  window.addEventListener('focus', () => {
    if (execState === 'input' && !document.body.classList.contains('exec-in-panel')) setTimeout(() => $('coninput').focus(), 0);
  });

  // Fokus melden: die Zoom-Tasten (Strg/⌘ + = / − / 0) sind VS-Code-Tastenbelegungen, die nur dann greifen –
  // sonst würde VS Code zusätzlich die ganze Oberfläche zoomen
  window.addEventListener('focus', () => post({ type: 'diagramFocus', focused: true }));
  window.addEventListener('blur', () => post({ type: 'diagramFocus', focused: false }));
  if (document.hasFocus()) post({ type: 'diagramFocus', focused: true });

  // Konsole, Eingabe, Turtleizer und Variablen (gemeinsam mit dem Panel unten, siehe execui.js)
  $('execpanel').innerHTML = window.StruktoExec.markup(T, escapeHtml, true);
  const EX = window.StruktoExec.create({ T, esc: escapeHtml, post, onShow: showExecPanel });
  setExecMode(document.body.dataset.exec);

  $('execMove').addEventListener('click', () => post({ type: 'command', command: 'struktogramm.toggleExecutionLocation' }));
  $('execClose').addEventListener('click', () => { if (execState === 'running' || execState === 'paused' || execState === 'input') post({ type: 'exec', cmd: 'stop' }); $('execpanel').hidden = true; runPath = null; errPath = null; markExec(false); });
  /* ------------------------------ Maus ------------------------------ */
  let drag = null;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    hideMenu();
    const g = e.target.closest('[data-path]');
    sel = g ? g.dataset.path : null;
    markSelection(false);
    if (sel) status(describeSel());
    if (!READONLY && g && !g.classList.contains('empty') && !/^roots\/\d+$/.test(sel)) {
      drag = { from: sel, x: e.clientX, y: e.clientY, active: false };
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (!drag.active && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.active = true;
    document.body.classList.add('dragging');
    const t = dropTarget(e);
    drag.target = t;
    if (!t) { dropmark.hidden = true; return; }
    const r = t.rect, s = scroller.getBoundingClientRect();
    dropmark.hidden = false;
    dropmark.className = t.into ? 'into' : '';
    dropmark.style.left = r.left - s.left + scroller.scrollLeft + 'px';
    dropmark.style.width = r.width + 'px';
    if (t.into) { dropmark.style.top = r.top - s.top + scroller.scrollTop + 'px'; dropmark.style.height = r.height + 'px'; }
    else { dropmark.style.top = (t.where === 'before' ? r.top : r.bottom) - s.top + scroller.scrollTop - 2 + 'px'; dropmark.style.height = '4px'; }
  });
  window.addEventListener('mouseup', () => {
    if (drag && drag.active && drag.target) {
      const t = drag.target;
      op({ op: 'moveTo', from: drag.from, to: t.path, where: t.where });
    }
    drag = null;
    dropmark.hidden = true;
    document.body.classList.remove('dragging');
  });

  function dropTarget(e) {
    const n = document.elementFromPoint(e.clientX, e.clientY);
    const g = n && n.closest && n.closest('[data-path]');
    if (!g) return null;
    const path = g.dataset.path;
    if (path === drag.from || path.startsWith(drag.from + '/') || /^roots\/\d+$/.test(path)) return null;
    const bg = g.querySelector(':scope > rect.bg') || g;
    const r = bg.getBoundingClientRect();
    if (g.classList.contains('empty')) return { path, where: 'after', into: true, rect: r };
    return { path, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after', rect: r };
  }

  canvas.addEventListener('dblclick', (e) => {
    if (READONLY) return;
    const g = e.target.closest('[data-path]');
    if (!g) return;
    sel = g.dataset.path;
    markSelection(false);
    if (g.classList.contains('empty')) insertKind('instruction', 'after');
    else openDialog();
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (READONLY) return;
    const g = e.target.closest('[data-path]');
    sel = g ? g.dataset.path : null;
    markSelection(false);
    showMenu(e.clientX, e.clientY);
  });
  scroller.addEventListener('mousedown', (e) => { if (e.target === scroller || e.target === canvas) { sel = null; markSelection(false); } });

  /* ------------------------------ Kontextmenü ------------------------------ */
  function showMenu(x, y) {
    const el = getAt(sel);
    const isRoot = sel && /^roots\/\d+$/.test(sel);
    const items = [];
    if (el) items.push(['edit', T('web.menu.edit'), 'Enter']);
    items.push(['-']);
    items.push(['sub:after', T('web.menu.insertAfter') + ' ▸']);
    if (el && !isRoot) items.push(['sub:before', T('web.menu.insertBefore') + ' ▸']);
    if (el && !isRoot && ['instruction', 'call', 'jump', 'alternative', 'case', 'for', 'while', 'repeat', 'forever', 'try', 'parallel'].includes(el.type)) items.push(['sub:wrap', T('web.menu.wrap') + ' ▸']);
    items.push(['-']);
    if (el && !isRoot) { items.push(['copy', T('web.tb.copy'), T('web.key.combo', 'C')], ['cut', T('web.tb.cut'), T('web.key.combo', 'X')]); }
    items.push(['paste', T('web.tb.paste'), T('web.key.combo', 'V'), !hasClipboard]);
    if (el && !isRoot) items.push(['toggleDisabled', el.disabled ? T('web.menu.enable') : T('web.menu.disable')]);
    const hasBp = breakpoints.has(sel) || bpDisabled.has(sel);
    if (el && !isRoot) items.push(['toggleBp', hasBp ? T('web.menu.bpRemove') : T('web.menu.bpSet'), 'F9']);
    // Bedingung, Trefferzahl, Logmeldung (VS-Code-Haltepunkte; nicht in der Live-Vorschau)
    if (el && !isRoot && !READONLY) {
      if (hasBp) items.push(['bpCond', T('web.menu.bpCond')], ['bpHit', T('web.menu.bpHit')], ['bpLog', T('web.menu.bpLog')], ['bpEnable', bpDisabled.has(sel) ? T('web.menu.bpEnable') : T('web.menu.bpDisable')]);
      else items.push(['bpLog', T('web.menu.bpLogAdd')]);
    }
    if (el) items.push(['-'], ['up', T('web.menu.up'), T('web.key.combo', '↑')], ['down', T('web.menu.down'), T('web.key.combo', '↓')], ['delete', isRoot ? T('web.menu.deleteDiagram') : T('web.tb.delete'), T('web.key.del')]);
    items.push(['-'], ['addSub', T('web.menu.addSub')], ['addMain', T('web.menu.addMain')]);
    menu.innerHTML = items.filter((it, i, a) => !(it[0] === '-' && (i === 0 || a[i - 1][0] === '-'))).map((it) => {
      if (it[0] === '-') return '<div class="sep"></div>';
      return `<div class="item${it[3] ? ' disabled' : ''}" data-m="${it[0]}"><span>${it[1]}</span><kbd>${it[2] || ''}</kbd></div>`;
    }).join('');
    menu.hidden = false;
    positionMenu(menu, x, y);
    menuActivate(menu, 0);
  }

  function positionMenu(m, x, y) {
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 4) + 'px';
    m.style.top = Math.min(y, window.innerHeight - r.height - 4) + 'px';
  }

  function hideMenu() { menu.hidden = true; const s = document.getElementById('submenu'); if (s) s.remove(); }

  /** Untermenü mit Elementarten: Einfügen danach/davor oder Umschließen */
  function openKindMenu(mode, x, y) {
    const old = document.getElementById('submenu');
    if (old) old.remove();
    const sm = document.createElement('div');
    sm.id = 'submenu';
    sm.className = 'menu';
    sm.setAttribute('role', 'menu');
    const kinds = mode === 'wrap' ? KINDS.filter(([k]) => ['alternative', 'for', 'while', 'repeat', 'forever', 'try'].includes(k)) : KINDS;
    const title = { after: T('web.menu.insertAfter'), before: T('web.menu.insertBefore'), wrap: T('web.menu.wrap') }[mode] || '';
    sm.innerHTML = `<div class="mtitle">${title}</div>` + kinds.map(([k, label, , key]) => `<div class="item" role="menuitem" data-k="${k}" data-key="${key}">${icon(k)}<span>${label}</span><kbd>${key.toUpperCase()}</kbd></div>`).join('');
    document.body.appendChild(sm);
    positionMenu(sm, x, y);
    sm.addEventListener('click', (ev) => {
      const k = ev.target.closest('.item');
      if (!k) return;
      if (mode === 'wrap') op({ op: 'wrap', path: sel, kind: k.dataset.k });
      else insertKind(k.dataset.k, mode);
      hideMenu();
    });
    menuActivate(sm, 0);
    return sm;
  }

  /* --------- Menüs per Tastatur: ↑/↓ wählen, Enter/→ ausführen, ←/Esc zurück, Buchstabe = Kürzel --------- */
  function menuItems(m) { return [...m.querySelectorAll('.item:not(.disabled)')]; }
  function menuActivate(m, idx) {
    const items = menuItems(m);
    if (!items.length) return;
    m.querySelectorAll('.item.active').forEach((x) => x.classList.remove('active'));
    const it = items[(idx + items.length) % items.length];
    it.classList.add('active');
    it.scrollIntoView({ block: 'nearest' });
  }
  function menuKeys(e) {
    const sub = document.getElementById('submenu');
    const m = sub || (!menu.hidden ? menu : null);
    if (!m) return false;
    const items = menuItems(m);
    const cur = items.findIndex((x) => x.classList.contains('active'));
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') menuActivate(m, (cur < 0 ? 0 : cur + (k === 'ArrowDown' ? 1 : -1)));
    else if (k === 'Home' || k === 'End') menuActivate(m, k === 'Home' ? 0 : items.length - 1);
    else if (k === 'Enter' || k === ' ' || (k === 'ArrowRight' && items[cur] && /^sub:/.test(items[cur].dataset.m || ''))) {
      if (items[cur]) items[cur].click();
    } else if (k === 'Escape' || k === 'ArrowLeft') {
      if (sub && !menu.hidden) sub.remove(); else hideMenu();
      if (k === 'Escape' && !sub) focusCanvas();
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const lk = k.toLowerCase();
      const hit = items.find((x) => x.dataset.key === lk) || items.find((x) => (x.textContent || '').trim().toLowerCase().startsWith(lk));
      if (hit) { if (sub) hit.click(); else menuActivate(m, items.indexOf(hit)); }
    } else if (k !== 'Tab') return true; // andere Tasten nicht an das Diagramm weitergeben
    e.preventDefault();
    return true;
  }

  /** Menü an der Position des ausgewählten Elements öffnen (für Tastatur) */
  function selRect() {
    const g = nodeFor(sel);
    const bg = g && (g.querySelector(':scope > rect.bg') || g);
    const r = bg ? bg.getBoundingClientRect() : scroller.getBoundingClientRect();
    return { x: r.left + 12, y: r.top + Math.min(r.height, 24) };
  }

  function focusCanvas() { try { scroller.focus({ preventScroll: true }); } catch (err) { /* egal */ } }

  /* ------------------------------ Einfügen per Tastatur: Inline-Auswahl mit Vorschau ------------------------------ */
  // Stichwörter für die Suche (zusätzlich zu Name und Tastenkürzel)
  const KIND_WORDS = {
    instruction: ['anweisung', 'zuweisung', 'input', 'output', 'eingabe', 'ausgabe', 'befehl', 'var', 'instruction', 'statement', 'assignment'],
    alternative: ['verzweigung', 'if', 'wenn', 'falls', 'bedingung', 'alternative', 'branch', 'condition'],
    case: ['fallauswahl', 'switch', 'case', 'auswahl', 'mehrfach', 'select', 'selection'],
    for: ['zählschleife', 'for', 'foreach', 'zähl', 'counting', 'count'],
    while: ['kopfschleife', 'while', 'solange', 'kopf', 'pre-test'],
    repeat: ['fußschleife', 'repeat', 'until', 'do', 'fuß', 'bis', 'post-test'],
    forever: ['endlosschleife', 'loop', 'endlos', 'forever', 'endless', 'infinite'],
    call: ['aufruf', 'call', 'funktion', 'unterprogramm', 'prozedur', 'subroutine', 'function', 'procedure'],
    jump: ['sprung', 'leave', 'return', 'exit', 'break', 'throw', 'continue', 'jump'],
    try: ['try', 'catch', 'finally', 'fehler', 'ausnahme', 'error', 'exception'],
    parallel: ['parallel', 'thread', 'gleichzeitig', 'concurrent'],
  };
  let picker = null; // { box, input, list, where, path, items, idx, token, saved }

  function pickerMatches(q) {
    q = q.trim().toLowerCase();
    const scored = [];
    KINDS.forEach(([k, label, title, key], order) => {
      const words = [label.toLowerCase(), ...KIND_WORDS[k]];
      let score = -1;
      if (!q) score = 0;
      else if (q === key) score = 100;
      else if (label.toLowerCase().startsWith(q)) score = 80;
      else if (words.some((w) => w.startsWith(q))) score = 60;
      else if (words.some((w) => w.includes(q)) || title.toLowerCase().includes(q)) score = 30;
      if (score >= 0) scored.push({ k, label, title, key, score, order });
    });
    return scored.sort((a, b) => b.score - a.score || a.order - b.order);
  }

  function openPicker(w, initial) {
    if (READONLY || !sel) return;
    closePicker(true);
    const box = document.createElement('div');
    box.id = 'picker';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', T('web.tb.insertGroup'));
    box.innerHTML = `<div class="ptitle">${escapeHtml(T(w === 'before' ? 'web.pick.titleBefore' : 'web.pick.titleAfter'))}</div>
      <input id="pickerInput" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(T('web.pick.placeholder'))}" aria-autocomplete="list" aria-controls="pickerList">
      <div id="pickerList" class="plist" role="listbox"></div>`;
    scroller.appendChild(box);
    picker = { box, input: box.querySelector('input'), list: box.querySelector('.plist'), where: w, path: sel, items: [], idx: 0, token: 0, saved: svgText, previewPath: null };
    picker.input.value = initial || '';
    picker.input.addEventListener('input', () => { picker.idx = 0; pickerUpdate(); });
    picker.input.addEventListener('keydown', pickerKeys);
    picker.input.addEventListener('blur', () => setTimeout(() => { if (picker && document.activeElement !== picker.input) closePicker(true); }, 150));
    picker.list.addEventListener('mousedown', (e) => {
      const it = e.target.closest('.pitem');
      if (!it) return;
      e.preventDefault();
      picker.idx = parseInt(it.dataset.i, 10);
      pickerCommit();
    });
    pickerUpdate();
    positionPicker(nodeFor(sel), w);
    picker.input.focus();
  }

  function pickerUpdate() {
    const p = picker;
    p.items = pickerMatches(p.input.value);
    if (p.idx >= p.items.length) p.idx = Math.max(0, p.items.length - 1);
    p.list.innerHTML = p.items.length
      ? p.items.map((it, i) => `<div id="pitem${i}" class="pitem${i === p.idx ? ' active' : ''}" role="option" aria-selected="${i === p.idx}" data-i="${i}">${icon(it.k)}<span>${it.label}</span><kbd>${it.key.toUpperCase()}</kbd></div>`).join('')
      : `<div class="pempty">${escapeHtml(T('web.pick.none'))}</div>`;
    const cur = p.items[p.idx];
    fitPicker();
    status(cur ? T('web.pick.status', cur.label, cur.title) : T('web.pick.noneStatus'));
    requestPreview();
  }

  let previewTimer = null;
  function requestPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (!picker) return;
      const cur = picker.items[picker.idx];
      picker.token++;
      if (!cur) { showPreview(null); return; }
      post({ type: 'previewInsert', token: picker.token, path: picker.path, kind: cur.k, where: picker.where });
    }, 40);
  }

  /** Vorschau-SVG anzeigen (null = ursprüngliches Diagramm) */
  function showPreview(svg, path) {
    if (!picker) return;
    canvas.innerHTML = svg || picker.saved;
    applyZoom();
    picker.previewPath = svg ? path : null;
    const g = svg && path ? nodeFor(path) : null;
    if (g) {
      g.classList.add('preview');
      positionPicker(g, 'after');
      const r = g.getBoundingClientRect(), s = scroller.getBoundingClientRect();
      if (r.top < s.top || r.bottom > s.bottom) g.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else {
      markSelection(false);
      positionPicker(nodeFor(picker.path), picker.where);
    }
  }

  /** gewähltes Element in der Liste sichtbar halten (nur die Liste scrollen, nicht das Diagramm) */
  function pickerReveal() {
    const p = picker;
    if (!p) return;
    const act = p.list.querySelector('.pitem.active');
    if (!act) { p.input.removeAttribute('aria-activedescendant'); return; }
    const top = act.offsetTop - p.list.offsetTop, bottom = top + act.offsetHeight;
    if (top < p.list.scrollTop) p.list.scrollTop = top;
    else if (bottom > p.list.scrollTop + p.list.clientHeight) p.list.scrollTop = bottom - p.list.clientHeight;
    p.input.setAttribute('aria-activedescendant', act.id);
  }

  /** Auswahlfeld in den sichtbaren Bereich einpassen: erst die Liste kürzen (sie scrollt dann), notfalls nach oben schieben */
  function fitPicker() {
    const p = picker;
    if (!p) return;
    p.list.style.maxHeight = '';
    const limit = Math.min(scroller.getBoundingClientRect().bottom, window.innerHeight) - 6;
    let over = p.box.getBoundingClientRect().bottom - limit;
    if (over > 0) {
      const lh = p.list.getBoundingClientRect().height, nh = Math.max(Math.min(lh, 110), lh - over);
      p.list.style.maxHeight = nh + 'px';
      over -= lh - nh;
    }
    if (over > 0) p.box.style.top = Math.max(scroller.scrollTop + 4, (parseFloat(p.box.style.top) || 0) - over) + 'px';
    // sehr niedriges Fenster: Liste weiter kürzen (mindestens zwei Zeilen)
    over = p.box.getBoundingClientRect().bottom - limit;
    if (over > 0) p.list.style.maxHeight = Math.max(48, p.list.getBoundingClientRect().height - over) + 'px';
    pickerReveal();
  }

  /** Auswahlfeld direkt unter (bzw. über) dem Element platzieren */
  function positionPicker(g, w) {
    if (!picker) return;
    placePicker(g, w);
    fitPicker();
  }

  function placePicker(g, w) {
    const s = scroller.getBoundingClientRect();
    const bg = g && (g.querySelector(':scope > rect.bg') || g);
    const r = bg ? bg.getBoundingClientRect() : { left: s.left + 16, right: s.left + 16, top: s.top + 16, bottom: s.top + 16, width: 0 };
    // bevorzugt rechts neben dem Element (Diagramm bleibt sichtbar), sonst darunter bzw. darüber
    const bw = picker.box.offsetWidth || 270;
    if (r.right + 12 + bw <= s.right - 4) {
      picker.box.style.left = r.right - s.left + scroller.scrollLeft + 12 + 'px';
      picker.box.style.top = Math.max(4, r.top - s.top + scroller.scrollTop) + 'px';
      return;
    }
    const top = (w === 'before' ? r.top - picker.box.offsetHeight - 2 : r.bottom + 2) - s.top + scroller.scrollTop;
    picker.box.style.left = Math.max(4, r.left - s.left + scroller.scrollLeft) + 'px';
    picker.box.style.top = Math.max(4, top) + 'px';
  }

  function pickerKeys(e) {
    const p = picker;
    if (!p) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (p.items.length) { p.idx = (p.idx + (e.key === 'ArrowDown' ? 1 : -1) + p.items.length) % p.items.length; pickerUpdate(); }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      pickerCommit();
    } else if (e.key === 'Escape') {
      closePicker(true);
      focusCanvas();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function pickerCommit() {
    const p = picker;
    const cur = p && p.items[p.idx];
    if (!cur) return;
    closePicker(false);
    op({ op: 'insert', path: p.path, kind: cur.k, where: p.where, noEdit: true });
    status(T('web.pick.inserted', cur.label));
    focusCanvas();
  }

  /** Auswahl schließen; restore = ursprüngliches Diagramm wieder zeigen */
  function closePicker(restore) {
    if (!picker) return;
    const p = picker;
    picker = null;
    clearTimeout(previewTimer);
    p.box.remove();
    if (restore) { canvas.innerHTML = svgText; applyZoom(); markSelection(false); markExec(false); }
  }

  menu.addEventListener('click', (e) => {
    const it = e.target.closest('.item');
    if (!it || it.classList.contains('disabled')) return;
    const a = it.dataset.m;
    if (a.startsWith('sub:')) {
      const r = it.getBoundingClientRect();
      openKindMenu(a.slice(4), r.right, r.top);
      return;
    }
    hideMenu();
    if (a === 'toggleDisabled') { const el = getAt(sel); op({ op: 'update', path: sel, disabled: !el.disabled }); return; }
    action(a);
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu') && !e.target.closest('#submenu')) hideMenu(); });

  /* ------------------------------ Tastatur ------------------------------ */
  /** Blöcke eines Elements (Pfad-Schlüssel) */
  function blockKeys(el) {
    if (!el) return [];
    switch (el.type) {
      case 'root': return ['children'];
      case 'alternative': return ['qTrue', 'qFalse'];
      case 'case': case 'parallel': return el.branches.map((_, i) => 'branches/' + i);
      case 'try': return ['qTry', 'qCatch', 'qFinally'];
      case 'for': case 'while': case 'repeat': case 'forever': return ['body'];
      default: return [];
    }
  }
  const BLOCK_NAMES = { qTrue: T('web.block.true'), qFalse: T('web.block.false'), body: T('web.block.body'), qTry: 'try', qCatch: 'catch', qFinally: 'finally', children: '' };

  /** Pfad zerlegen: {owner: Pfad des Elternelements, key: Block, index (-1 = leerer Block)} */
  function splitPath(path) {
    const m = /^(.*)\/(branches\/\d+|children|qTrue|qFalse|body|qTry|qCatch|qFinally)\/(\d+|#)$/.exec(path || '');
    return m ? { owner: m[1], key: m[2], index: m[3] === '#' ? -1 : parseInt(m[3], 10) } : null;
  }
  const isRootPath = (p) => /^roots\/\d+$/.test(p || '');
  function blockFirst(owner, key) { const p = `${owner}/${key}/0`; return nodeFor(p) ? p : `${owner}/${key}/#`; }
  function blockLast(owner, key) {
    const arr = getAt(`${owner}/${key}`);
    return arr && arr.length ? `${owner}/${key}/${arr.length - 1}` : `${owner}/${key}/#`;
  }
  /** nächstes Element nach path – am Blockende weiter hinter dem Elternelement */

  /** Ziel der Pfeil-/Navigationstasten (oder null) */
  function navTarget(key, ctrl) {
    const el = getAt(sel);
    const s = splitPath(sel);
    const roots = doc ? doc.roots.length : 0;
    if (key === 'PageUp' || key === 'PageDown') {
      const ri = parseInt((/^roots\/(\d+)/.exec(sel) || [0, 0])[1], 10) + (key === 'PageDown' ? 1 : -1);
      return ri >= 0 && ri < roots ? `roots/${ri}` : null;
    }
    if (isRootPath(sel)) {
      if (key === 'ArrowDown' || key === 'ArrowRight') return blockFirst(sel, 'children');
      if (key === 'ArrowUp') { const ri = parseInt(sel.split('/')[1], 10); return ri > 0 ? `roots/${ri - 1}` : null; }
      return null;
    }
    if (!s) return null;
    const enter = () => { const keys = blockKeys(el); return keys.length ? blockFirst(sel, keys[0]) : null; };
    // Strg/⌘ + → / ←: immer hinein (erster Block) bzw. hinaus (umgebendes Element)
    if (ctrl && key === 'ArrowRight') return enter();
    if (ctrl && key === 'ArrowLeft') return s.owner;
    switch (key) {
      case 'ArrowUp': {
        if (s.index > 0) return `${s.owner}/${s.key}/${s.index - 1}`;
        // TRY: try/catch/finally liegen untereinander – vom Anfang eines Teils ans Ende des vorherigen
        const tk = TRY_KEYS.indexOf(s.key);
        if (tk > 0 && getAt(s.owner) && getAt(s.owner).type === 'try') return blockLast(s.owner, TRY_KEYS[tk - 1]);
        return s.owner;
      }
      case 'ArrowDown': return downFrom(sel);
      // → / ←: in den Nachbarzweig (Fälle, true/false, parallel) auf gleicher Höhe;
      // ohne Nachbarn hinein bzw. hinaus
      case 'ArrowLeft': return sideways(sel, -1) || s.owner;
      case 'ArrowRight': return sideways(sel, 1) || enter();
      case 'Home': return blockFirst(s.owner, s.key);
      case 'End': return blockLast(s.owner, s.key);
      default: return null;
    }
  }

  const TRY_KEYS = ['qTry', 'qCatch', 'qFinally'];

  /** ↓: nächstes Element; am Blockende hinter das umgebende Element – bei TRY erst in den nächsten Teil */
  function downFrom(path) {
    for (let p = path; ;) {
      const s = splitPath(p);
      if (!s) return null;
      const arr = getAt(`${s.owner}/${s.key}`) || [];
      if (s.index >= 0 && s.index + 1 < arr.length) return `${s.owner}/${s.key}/${s.index + 1}`;
      const tk = TRY_KEYS.indexOf(s.key);
      if (tk >= 0 && tk < 2 && getAt(s.owner) && getAt(s.owner).type === 'try') return blockFirst(s.owner, TRY_KEYS[tk + 1]);
      if (isRootPath(s.owner)) return null;
      p = s.owner;
    }
  }

  /**
   * Nachbarzweig links (dir = -1) oder rechts (dir = 1) – bei Fallauswahl, Verzweigung und Parallelverarbeitung,
   * deren Zweige nebeneinander liegen. Steht die Auswahl tiefer verschachtelt und hat ihr Block keinen Nachbarn
   * in dieser Richtung, gilt der nächste umgebende Zweig mit Nachbarn. Gewählt wird das Element des Nachbarzweigs
   * auf gleicher Höhe (sonst das letzte darüber).
   */
  function sideways(path, dir) {
    const SIDE = ['alternative', 'case', 'parallel'];
    const here = nodeFor(path);
    const y = here ? here.getBoundingClientRect().top + 1 : 0;
    for (let p = path; ;) {
      const s = splitPath(p);
      if (!s) return null;
      const owner = getAt(s.owner);
      if (owner && SIDE.includes(owner.type)) {
        // nur sichtbare Zweige (ein Standardzweig „%“ wird nicht gezeichnet)
        const keys = blockKeys(owner).filter((k) => nodeFor(blockFirst(s.owner, k)));
        const k = keys.indexOf(s.key) + dir;
        if (k >= 0 && k < keys.length) {
          const arr = getAt(`${s.owner}/${keys[k]}`) || [];
          if (!arr.length) return `${s.owner}/${keys[k]}/#`;
          let pick = 0;
          for (let i = 0; i < arr.length; i++) {
            const n = nodeFor(`${s.owner}/${keys[k]}/${i}`);
            if (n && n.getBoundingClientRect().top <= y) pick = i;
          }
          return `${s.owner}/${keys[k]}/${pick}`;
        }
      }
      if (isRootPath(s.owner)) return null;
      p = s.owner;
    }
  }

  /** Ausgewähltes Element ansagen (Statusleiste, auch für Screenreader) */
  function describeSel() {
    if (!sel) return '';
    const s = splitPath(sel);
    let where = '';
    if (s) {
      const owner = getAt(s.owner);
      if (owner && owner.type === 'case' && /^branches\//.test(s.key)) {
        const k = parseInt(s.key.split('/')[1], 10);
        where = ' · ' + T('web.block.case', String((owner.text || [])[k + 1] || '').trim() || k + 1);
      } else if (owner && owner.type === 'parallel' && /^branches\//.test(s.key)) where = ' · ' + T('web.block.branch', parseInt(s.key.split('/')[1], 10) + 1);
      else if (BLOCK_NAMES[s.key]) where = ' · ' + BLOCK_NAMES[s.key];
    }
    if (sel.endsWith('/#')) return T('web.st.emptyBlock', where);
    const el = getAt(sel);
    if (!el) return '';
    const text = (el.text || []).filter((l) => String(l).trim()).join(' · ');
    return `${TYPE_NAMES[el.type] || el.type}${text ? ': ' + text : ''}${where}${el.disabled ? ` (${T('web.st.disabled')})` : ''}${breakpoints.has(sel) ? ` (${T('web.st.breakpoint')})` : ''}`;
  }

  /** Übersicht aller Tasten */
  function showHelp() {
    // Zeilen: [Taste, Beschreibung]; leere Beschreibung = Zwischenüberschrift
    const rows = [];
    for (let i = 1; L10N[`web.help.k${i}`] != null; i++) rows.push([T(`web.help.k${i}`), T(`web.help.d${i}`)]);
    dialog.innerHTML = `<div class="box help" role="dialog" aria-label="${escapeHtml(T('web.help.title'))}"><h2>${escapeHtml(T('web.help.title'))}</h2><div class="hscroll" tabindex="0" aria-label="${escapeHtml(T('web.help.list'))}"><table>${rows.map(([k, d]) => (d ? `<tr><td><kbd>${escapeHtml(k)}</kbd></td><td>${escapeHtml(d)}</td></tr>` : `<tr><th colspan="2">${escapeHtml(k)}</th></tr>`)).join('')}</table></div><div class="buttons"><button id="hClose" class="primary">${escapeHtml(T('web.close'))}</button></div></div>`;
    dialog.hidden = false;
    const close = () => { dialog.hidden = true; dialog.innerHTML = ''; focusCanvas(); };
    $('hClose').onclick = close;
    $('hClose').focus();
    const list = dialog.querySelector('.hscroll');
    dialog.onkeydown = (e) => {
      if (e.key === 'Escape' || e.key === '?') { close(); e.preventDefault(); }
      else if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key) && e.target !== list) {
        const step = e.key.startsWith('Page') ? list.clientHeight * 0.9 : 40;
        if (e.key === 'Home') list.scrollTop = 0;
        else if (e.key === 'End') list.scrollTop = list.scrollHeight;
        else list.scrollTop += e.key === 'ArrowDown' || e.key === 'PageDown' ? step : -step;
        e.preventDefault();
      }
      if (isClipboardKey(e)) return; // markierten Text kopieren (auf dem Mac über VS Code)
      e.stopPropagation();
    };
  }

  document.addEventListener('keydown', (e) => {
    if (!dialog.hidden) return;
    if (menuKeys(e)) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) {
      // Esc in der Konsoleneingabe: zurück zum Diagramm
      if (e.key === 'Escape' && e.target.id === 'coninput') { focusCanvas(); e.preventDefault(); }
      return;
    }
    // Werkzeugleiste: normale Tastaturbedienung der Knöpfe
    if (e.target.closest && e.target.closest('#toolbar, #execpanel') && (e.key === 'Enter' || e.key === ' ')) return;
    // Strg oder ⌘ (Mac); Zoom-Tasten kommen als Tastenbelegung über die Extension (zoomKey)
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === '?') { showHelp(); e.preventDefault(); return; }
    if (e.key === 'Escape') { hideMenu(); return; }
    if (e.key === 'F9') { toggleBreakpoint(); e.preventDefault(); return; }
    // wie in VS Code: F8 / Umschalt+F8 = nächstes / vorheriges Problem
    if (e.key === 'F8') { gotoProblem(e.shiftKey ? -1 : 1); e.preventDefault(); return; }
    if (READONLY) {
      if (sel && (e.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key))) {
        const np = navTarget(e.key, ctrl);
        if (np && nodeFor(np)) { sel = np; markSelection(true); status(describeSel()); e.preventDefault(); }
      }
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'c') { if (copySel()) e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'x') { action('cut'); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'v') { action('paste'); e.preventDefault(); return; }
    if (!sel) {
      if ((e.key.startsWith('Arrow') || e.key === 'Home') && doc && doc.roots.length) { sel = 'roots/0'; markSelection(true); status(describeSel()); e.preventDefault(); }
      return;
    }
    // Kontextmenü / Einfügemenü per Tastatur
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { const r = selRect(); showMenu(r.x, r.y); e.preventDefault(); return; }
    // Einfg / Buchstabe: Inline-Auswahl mit Vorschau (Umschalt: davor)
    if (e.key === 'Insert') { openPicker(e.shiftKey && !isRootPath(sel) && !sel.endsWith('/#') ? 'before' : where, ''); e.preventDefault(); return; }
    if (ctrl && e.key === 'ArrowUp') { action('up'); e.preventDefault(); return; }
    if (ctrl && e.key === 'ArrowDown') { action('down'); e.preventDefault(); return; }
    // Strg+Enter: Einfügen-Auswahl mit Vorschau (Strg+Umschalt+Enter: davor)
    if (ctrl && e.key === 'Enter') { openPicker(e.shiftKey && !isRootPath(sel) && !sel.endsWith('/#') ? 'before' : where, ''); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === 'F2') { if (sel.endsWith('/#')) insertKind('instruction', 'after'); else openDialog(); e.preventDefault(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { action('delete'); e.preventDefault(); return; }
    if (e.key === ' ' && !sel.endsWith('/#') && !isRootPath(sel)) {
      const el = getAt(sel);
      if (el) { op({ op: 'update', path: sel, disabled: !el.disabled }); e.preventDefault(); }
      return;
    }
    if (e.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      const np = navTarget(e.key, ctrl);
      if (np && nodeFor(np)) { sel = np; markSelection(true); status(describeSel()); }
      e.preventDefault();
    }
  });

  /* ------------------------------ Bearbeiten-Dialog ------------------------------ */
  let reopenAsEdit = false; // nach einem Typwechsel „bearbeiten“ statt „einfügen“
  function openDialog(isNew) {
    if (READONLY || !sel) return;
    const el = getAt(sel);
    if (!el) return;
    const type = el.type;
    const text = type === 'parallel' ? String(el.branches.length) : (el.text || []).join('\n');
    const comment = (el.comment || []).join('\n');
    const color = el.color || 'ffffff';
    dialog.innerHTML = `
      <div class="box" role="dialog" aria-label="${escapeHtml(T('web.dlg.aria'))}">
        <h2>${icon(type === 'root' ? 'instruction' : type)} ${escapeHtml(T(isNew ? 'web.dlg.insertTitle' : 'web.dlg.editTitle', TYPE_NAMES[type] || type))}</h2>
        ${type !== 'root' ? `<label for="dType">${escapeHtml(T('web.dlg.type'))}</label>
        <select id="dType" title="${escapeHtml(T('web.dlg.type.title'))}">${KINDS.map(([k, label]) => `<option value="${k}"${k === type ? ' selected' : ''}>${label}</option>`).join('')}</select>` : ''}
        <label for="dText">${escapeHtml(T(type === 'root' ? 'web.dlg.signature' : type === 'alternative' ? 'web.dlg.condition' : type === 'parallel' ? 'web.dlg.branches' : type === 'try' ? 'web.dlg.catchVar' : 'web.dlg.text'))}</label>
        <textarea id="dText" rows="${Math.max(type === 'instruction' || type === 'case' ? 4 : 2, (el.text || []).length + 1)}" spellcheck="false">${escapeHtml(text)}</textarea>
        <div class="hint">${escapeHtml(HINTS[type] || '').replace(/\n/g, '<br>')}</div>
        ${type === 'root' ? `<div class="row"><label><input type="radio" name="rt" value="program" ${el.rootType === 'program' ? 'checked' : ''}> ${escapeHtml(T('web.dlg.main'))}</label>
          <label><input type="radio" name="rt" value="sub" ${el.rootType === 'sub' ? 'checked' : ''}> ${escapeHtml(T('web.dlg.sub'))}</label></div>` : ''}
        <label for="dComment">${escapeHtml(T('web.dlg.comment'))}</label>
        <textarea id="dComment" rows="2">${escapeHtml(comment)}</textarea>
        <div class="row colors">${escapeHtml(T('web.dlg.color'))} ${COLORS.map((c) => `<button class="swatch${c === color ? ' on' : ''}" data-c="${c}" style="background:#${c}" title="#${c}"></button>`).join('')}</div>
        ${type !== 'root' ? `<div class="row"><label><input type="checkbox" id="dDisabled" ${el.disabled ? 'checked' : ''}> ${escapeHtml(T('web.dlg.disabled'))}</label></div>` : ''}
        <div class="buttons"><button id="dCancel">${escapeHtml(T('web.dlg.cancel'))}</button><button id="dOk" class="primary">${escapeHtml(T('web.dlg.ok'))}</button></div>
        <div class="hint small">${escapeHtml(T('web.dlg.keys'))}</div>
      </div>`;
    dialog.hidden = false;
    let chosen = color;
    dialog.querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
      dialog.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      chosen = b.dataset.c;
    }));
    const ta = $('dText');
    const ac = type === 'root' || type === 'parallel' || type === 'try' ? null : attachCompletion(ta, sel, type);
    ta.focus();
    if (isNew && type !== 'instruction') ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
    const path = sel;
    const close = () => { dialog.hidden = true; dialog.innerHTML = ''; focusCanvas(); };
    const props = () => {
      // Deklarationen vereinheitlichen: "var x:int" / "var x : int" → "var x: int"
      const fixDecl = (l) => l.replace(/^(\s*(?:var|const|dim)\s+[^:="']*?)\s*:(?!=)\s*(?=\S)/i, '$1: ');
      const cmd = { text: ta.value.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => (type === 'instruction' ? fixDecl(l) : l)), comment: $('dComment').value.replace(/\r/g, ''), color: chosen };
      const rt = dialog.querySelector('input[name="rt"]:checked');
      if (rt) cmd.rootType = rt.value;
      const dis = $('dDisabled');
      if (dis) cmd.disabled = dis.checked;
      return cmd;
    };
    const ok = () => {
      const cmd = { op: 'update', path, ...props() };
      close();
      op(cmd);
    };
    const typeSel = $('dType');
    if (typeSel) typeSel.onchange = () => {
      // Typ wechseln: bisherige Eingaben übernehmen, danach öffnet sich der Dialog für das neue Element
      const p = props();
      close();
      reopenAsEdit = true;
      op({ op: 'changeType', path, kind: typeSel.value, props: p });
    };
    $('dOk').onclick = ok;
    $('dCancel').onclick = close;
    dialog.onkeydown = (e) => {
      if (ac && e.target === ta && ac.key(e)) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Escape') { close(); e.preventDefault(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { ok(); e.preventDefault(); }
      else if (e.key === 'Enter' && type !== 'instruction' && type !== 'case' && type !== 'root' && e.target === ta && !e.shiftKey) { ok(); e.preventDefault(); }
      // Kopieren, Ausschneiden, Einfügen, Alles markieren an VS Code weiterreichen: auf dem Mac führt VS Code sie
      // in Webviews selbst aus (⌘C/⌘V gehen sonst ins Leere); die Diagramm-Tasten reagieren bei offenem Dialog nicht
      if (isClipboardKey(e)) return;
      e.stopPropagation();
    };
  }

  /** Strg/⌘ + C, X, V, A (ohne Alt): Zwischenablage und Alles markieren */
  function isClipboardKey(e) {
    return (e.ctrlKey || e.metaKey) && !e.altKey && ['c', 'x', 'v', 'a'].includes(String(e.key).toLowerCase());
  }

  /* ------------------------------ Autovervollständigung ------------------------------ */
  // Befehlssatz des Structorizer-Executors (Funktionen) plus Umwandlungen
  const BUILTINS = [
    ['abs', 1], ['min', 2], ['max', 2], ['round', 1], ['ceil', 1], ['floor', 1], ['sgn', 1], ['signum', 1], ['sqr', 1], ['sqrt', 1],
    ['exp', 1], ['log', 1], ['pow', 2], ['sin', 1], ['cos', 1], ['tan', 1], ['asin', 1], ['acos', 1], ['atan', 1],
    ['toRadians', 1], ['toDegrees', 1], ['random', 1],
    ['length', 1], ['pos', 2], ['copy', 3], ['lowercase', 1], ['uppercase', 1], ['trim', 1], ['split', 2], ['strcmp', 2],
    ['ord', 1], ['chr', 1], ['isArray', 1], ['isString', 1], ['isChar', 1], ['isBool', 1], ['isNumber', 1],
    ['copyArray', 1], ['copyRecord', 1],
    ['getX', 0], ['getY', 0], ['getOrientation', 0],
    ['fileOpen', 1], ['fileCreate', 1], ['fileAppend', 1], ['fileEOF', 1], ['fileRead', 1], ['fileReadChar', 1],
    ['fileReadInt', 1], ['fileReadDouble', 1], ['fileReadLine', 1],
    ['str', 1], ['int', 1], ['float', 1],
  ];
  // Structorizer-Prozeduren: stehen allein in einer Zeile
  const PROCEDURES = [['inc', 1], ['dec', 1], ['insert', 3], ['delete', 3], ['randomize', 0], ['fileWrite', 2], ['fileWriteLine', 2], ['fileClose', 1],
    // Turtleizer
    ['forward', 1], ['backward', 1], ['left', 1], ['right', 1], ['gotoXY', 2], ['gotoX', 1], ['gotoY', 1], ['penUp', 0], ['penDown', 0],
    ['hideTurtle', 0], ['showTurtle', 0], ['setPenColor', 3], ['setBackground', 3], ['clear', 0]];
  // [Wort, Leerzeichen anhängen, eher am Zeilenanfang] – Beschreibung aus den Übersetzungen
  const KEYWORDS = [
    ['INPUT', 1, 1], ['OUTPUT', 1, 1], ['var', 1, 1], ['const', 1, 1], ['for', 1, 1], ['foreach', 1, 1], ['while', 1, 1], ['until', 1, 1],
    ['leave', 0, 1], ['return', 1, 1], ['exit', 1, 1], ['continue', 0, 1], ['throw', 1, 1],
    ['to', 1, 0], ['downto', 1, 0], ['by', 1, 0], ['in', 1, 0], ['and', 1, 0], ['or', 1, 0], ['not', 1, 0],
    ['mod', 1, 0], ['true', 0, 0], ['false', 0, 0], ['type', 1, 1], ['record', 0, 0], ['enum', 0, 0],
  ].map(([w, space, lead]) => [w, T(`web.kw.${w}`), space, lead]);
  const TYPE_WORDS = ['int', 'double', 'float', 'string', 'boolean', 'char'];
  const KIND_LABEL = Object.fromEntries(['var', 'func', 'builtin', 'proc', 'kw', 'type'].map((k) => [k, T(`web.ck.${k}`)]));
  const KIND_ICON = { var: 'x', func: 'ƒ', builtin: 'ƒ', proc: 'ƒ', kw: 'K', type: 'T' };

  /** Kandidaten: Variablen des aktuellen Diagramms, dann Unterprogramme, Standardfunktionen, Schlüsselwörter */
  function completionItems(path) {
    const ri = parseInt((/^roots\/(\d+)/.exec(path || '') || [])[1] || '0', 10);
    const items = [], seen = new Set();
    // Name + "()" als Schlüssel: Datentyp "int" und Funktion "int()" dürfen beide vorkommen
    const push = (it) => { const k = it.name + (it.call ? '()' : ''); if (!seen.has(k)) { seen.add(k); items.push(it); } };
    for (const v of (symbols.roots && symbols.roots[ri]) || []) push({ name: v.name, kind: 'var', detail: v.type || '' });
    for (const f of symbols.funcs || []) push({ name: f.name, kind: 'func', detail: f.sig, call: true, params: f.params });
    // Datentypen vor gleichnamigen Funktionen: "in" → int, "int" → int()
    for (const t of TYPE_WORDS) push({ name: t, kind: 'type', detail: T('web.ck.type'), space: true });
    for (const [n, p] of BUILTINS) push({ name: n, kind: 'builtin', detail: TYPE_WORDS.includes(n) ? T('web.ck.convert', n) : n + '(…)', call: true, params: p });
    for (const [n, p] of PROCEDURES) push({ name: n, kind: 'proc', detail: T('web.ck.proc') + ' ' + n + '(…)', call: true, params: p });
    for (const [k, d, space, lead] of KEYWORDS) push({ name: k, kind: 'kw', detail: d, space: !!space, lead: !!lead });
    return items;
  }

  /** Pixelposition des Cursors in einer Textarea (Spiegel-Element) */
  function caretPos(ta) {
    const cs = getComputedStyle(ta);
    const m = document.createElement('div');
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight',
      'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing']) m.style[p] = cs[p];
    Object.assign(m.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '0', width: ta.offsetWidth + 'px' });
    m.textContent = ta.value.slice(0, ta.selectionStart);
    const mark = document.createElement('span');
    mark.textContent = '​';
    m.appendChild(mark);
    document.body.appendChild(m);
    const r = ta.getBoundingClientRect();
    const pos = { x: r.left + mark.offsetLeft - ta.scrollLeft, y: r.top + mark.offsetTop - ta.scrollTop + mark.offsetHeight };
    m.remove();
    return pos;
  }

  function attachCompletion(ta, path, elType) {
    const all = completionItems(path);
    const box = document.createElement('div');
    box.id = 'complete';
    box.hidden = true;
    box.setAttribute('role', 'listbox');
    dialog.appendChild(box);
    let list = [], idx = 0, start = 0, forced = false;

    /** Wortanfang vor dem Cursor (nicht in Strings) */
    function prefix() {
      const pos = ta.selectionStart;
      if (pos !== ta.selectionEnd) return null;
      const before = ta.value.slice(0, pos);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      if ((line.match(/"/g) || []).length % 2 === 1 || (line.match(/'/g) || []).length % 2 === 1) return null;
      const m = /[\p{L}_][\p{L}\p{N}_]*$/u.exec(line);
      if (/[\p{L}\p{N}_]/u.test(ta.value[pos] || '')) return null; // mitten im Wort
      return { text: m ? m[0] : '', start: pos - (m ? m[0].length : 0) };
    }

    const byKind = (k) => all.filter((it) => it.kind === k);
    const kws = (...names) => names.map((n) => all.find((it) => it.kind === 'kw' && it.name === n)).filter(Boolean);
    const uniq = (arr) => arr.filter((it, i) => arr.indexOf(it) === i);
    const NO_OPERAND = /^(and|or|not|xor|div|mod|to|downto|by|in|input|output|return|exit|throw|while|until|if|var|const|dim|for|foreach|case|of)$/i;

    /**
     * Was passt an diese Stelle? Abhängig vom Elementtyp und vom Text links vom Cursor.
     *  - Zeilenanfang: Anweisungen (INPUT zuerst, OUTPUT, var …), dann Variablen und Unterprogramme
     *  - nach "var x:"  → nur Datentypen
     *  - nach "var "    → nichts (neuer Name)
     *  - nach "INPUT"   → nur Variablen
     *  - nach einem Operanden + Leerzeichen → Operatoren (and, or, mod; bei for: to/by, foreach: in)
     *  - sonst (Ausdruck) → Variablen, Funktionen, true/false/not
     */
    function contextOf(lineBefore) {
      const vars = byKind('var').concat(localVars());
      const funcs = byKind('func');
      const builtins = byKind('builtin');
      const expr = () => uniq([...vars, ...funcs, ...builtins, ...kws('true', 'false', 'not')]);
      const t = lineBefore.trim();

      if (/^\s*(var|const|dim)\s+[^:=]*:\s*$/i.test(lineBefore)) return { items: byKind('type'), auto: true };
      if (/^\s*(var|const|dim)\s+[\p{L}\p{N}_,\s]*$/iu.test(lineBefore)) return { items: [] }; // neuer Name
      if (!t) {
        switch (elType) {
          case 'instruction': return { items: uniq([...kws('INPUT', 'OUTPUT', 'var', 'const', 'type'), ...vars, ...funcs, ...byKind('proc')]) };
          case 'call': return { items: uniq([...funcs, ...vars]) };
          case 'jump': return { items: kws('leave', 'return', 'exit', 'continue', 'throw') };
          case 'for': return { items: kws('for', 'foreach') };
          case 'while': return { items: uniq([...kws('while'), ...expr()]) };
          case 'repeat': return { items: uniq([...kws('until'), ...expr()]) };
          case 'forever': case 'try': return { items: [] };
          default: return { items: expr() }; // Bedingung, Fallauswahl
        }
      }
      if (/^INPUT\b/i.test(t)) return { items: vars };
      // Zählvariable direkt nach "for" / "foreach"
      if (/^(for|foreach)\s*$/i.test(t)) return { items: vars };
      const afterOperand = /\s$/.test(lineBefore) && /[\p{L}\p{N}_)\]"']$/u.test(t) && !NO_OPERAND.test((/[\p{L}_][\p{L}\p{N}_]*$/u.exec(t) || [''])[0]);
      if (afterOperand) {
        if (/^foreach\s+[\p{L}_][\p{L}\p{N}_]*$/iu.test(t)) return { items: kws('in') };
        if (/^for\b/i.test(t) && /(=|<-|:=)/.test(t)) {
          if (!/\b(to|downto)\b/i.test(t)) return { items: kws('to', 'downto') };
          if (!/\bby\b/i.test(t)) return { items: uniq([...kws('by'), ...kws('mod')]) };
        }
        return { items: kws('and', 'or', 'mod') };
      }
      return { items: expr() };
    }

    /** Variablen, die gerade erst im Dialog eingetippt wurden */
    function localVars() {
      const out = [];
      const known = new Set(all.map((it) => it.name));
      const add = (n) => { if (n && !known.has(n)) { known.add(n); out.push({ name: n, kind: 'var', detail: 'neu' }); } };
      for (const line of ta.value.split('\n')) {
        let m = /^\s*(?:var|dim|const)\s+([^:=]+)/i.exec(line);
        if (m) { m[1].split(',').forEach((s) => add((/^\s*([\p{L}_][\p{L}\p{N}_]*)/u.exec(s) || [])[1])); continue; }
        m = /^\s*(?:for|foreach)\s+([\p{L}_][\p{L}\p{N}_]*)/iu.exec(line);
        if (m) { add(m[1]); continue; }
        m = /^\s*INPUT\s+(?:"[^"]*"\s*,\s*)?(.+)$/i.exec(line);
        if (m) { m[1].split(',').forEach((s) => add((/^\s*([\p{L}_][\p{L}\p{N}_]*)/u.exec(s) || [])[1])); continue; }
        m = /^\s*(?:[\p{L}_][\p{L}\p{N}_]*(?:\[\])?\s+)?([\p{L}_][\p{L}\p{N}_]*)\s*(?:\[[^\]]*\]\s*)?(?:=(?!=)|<-|:=)/u.exec(line);
        if (m) add(m[1]);
      }
      return out;
    }

    function update() {
      const p = prefix();
      if (!p) return hide();
      const before = ta.value.slice(0, p.start);
      const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
      const ctx = contextOf(lineBefore);
      // Liste ohne Tippen nur bei Strg+Leertaste – oder direkt nach "var x:" (Datentyp erwartet)
      if (!p.text && !forced && !ctx.auto) return hide();
      const pool = ctx.items;
      const q = p.text.toLowerCase();
      // Reihenfolge des Kontexts bleibt erhalten: erst "beginnt mit", dann "enthält"
      const starts = pool.filter((it) => it.name.toLowerCase().startsWith(q));
      const contains = q.length >= 2 ? pool.filter((it) => !it.name.toLowerCase().startsWith(q) && it.name.toLowerCase().includes(q)) : [];
      // fertig getippte Wörter nur noch anbieten, wenn der Vorschlag etwas ergänzt (Funktion → "()")
      list = starts.concat(contains).filter((it) => it.name !== p.text || (it.call && ta.value[ta.selectionStart] !== '(')).slice(0, 12);
      if (!list.length) return hide();
      start = p.start;
      idx = 0;
      draw();
    }

    function draw() {
      box.innerHTML = list.map((it, i) => `<div class="ci${i === idx ? ' on' : ''}" data-i="${i}" role="option"><span class="ck ck-${it.kind}">${KIND_ICON[it.kind]}</span><b>${escapeHtml(it.name)}${it.call ? '()' : ''}</b><span class="cd">${escapeHtml(it.detail || KIND_LABEL[it.kind])}</span></div>`).join('') +
        `<div class="cfoot">${escapeHtml(T('web.ck.foot'))}</div>`;
      // Größe an den verfügbaren Platz anpassen: unter der Zeile oder darüber, je nachdem wo mehr Platz ist;
      // ist beides zu knapp, wird die Liste niedriger (scrollbar) statt abgeschnitten
      box.style.maxHeight = '';
      box.style.maxWidth = Math.max(160, Math.min(420, window.innerWidth - 8)) + 'px';
      box.style.minWidth = Math.min(220, window.innerWidth - 8) + 'px';
      box.hidden = false;
      const c = caretPos(ta);
      const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 18;
      const natural = Math.min(260, box.scrollHeight + 2);
      const below = window.innerHeight - c.y - 6, above = c.y - lineH - 6;
      const useBelow = below >= natural || below >= above;
      box.style.maxHeight = Math.max(48, Math.min(260, useBelow ? below : above)) + 'px';
      const w = box.offsetWidth, h = box.offsetHeight;
      box.style.left = Math.max(4, Math.min(c.x, window.innerWidth - w - 4)) + 'px';
      box.style.top = (useBelow ? c.y + 2 : Math.max(4, c.y - lineH - h - 2)) + 'px';
      const on = box.querySelector('.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    }

    function hide() { box.hidden = true; list = []; forced = false; }

    function accept(i) {
      const it = list[i];
      if (!it) return;
      const end = ta.selectionStart;
      let ins = it.name, caret = ins.length;
      const nextCh = ta.value[end] || '';
      if (it.call && nextCh !== '(') { ins += '()'; caret = it.params ? ins.length - 1 : ins.length; }
      else if (it.space && !/\s/.test(nextCh)) { ins += ' '; caret = ins.length; }
      // "var x:" + Datentyp → "var x: int" (Leerzeichen nach dem Doppelpunkt)
      if (it.kind === 'type' && ta.value[start - 1] === ':') { ins = ' ' + ins; caret += 1; }
      ta.setRangeText(ins, start, end, 'end');
      ta.setSelectionRange(start + caret, start + caret);
      hide();
    }

    ta.addEventListener('input', () => { forced = false; update(); });
    ta.addEventListener('click', hide);
    ta.addEventListener('blur', () => setTimeout(hide, 150));
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const row = e.target.closest('.ci');
      if (row) accept(+row.dataset.i);
    });

    return {
      /** true = Taste verbraucht */
      key(e) {
        // Strg+Leertaste wie in VS Code; auf dem Mac belegt das System ⌃Leertaste oft (Eingabequelle) – dort auch ⌘I
        if ((e.key === ' ' && e.ctrlKey) || (e.metaKey && e.key.toLowerCase() === 'i')) { forced = true; update(); return true; }
        if (box.hidden) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
          draw();
          return true;
        }
        if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey)) { accept(idx); return true; }
        if (e.key === 'Escape') { hide(); return true; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') hide();
        return false;
      },
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ------------------------------ PNG-Export ------------------------------ */
  /** Export anstoßen: die Extension fragt nach dem Farbschema und schickt das passende SVG (renderPng) */
  function exportPng() {
    if (!svgText) return;
    post({ type: 'exportPng' });
  }

  /** SVG -> PNG (doppelte Auflösung) und an die Extension zurückschicken */
  function renderPng(svg, id) {
    const m = /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(svg);
    const paper = (/fill="(#[0-9a-fA-F]{6})" class="paper"/.exec(svg) || [])[1] || '#ffffff';
    const w = m ? parseFloat(m[1]) : 800, h = m ? parseFloat(m[2]) : 600;
    const scale = 2;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * scale);
      c.height = Math.ceil(h * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      post({ type: 'pngData', id, dataUrl: c.toDataURL('image/png') });
    };
    img.onerror = () => { status(T('web.png.failed')); post({ type: 'pngData', id, error: T('web.png.error') }); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  scroller.addEventListener('wheel', (e) => {
    // Strg+Mausrad bzw. Pinch auf dem Trackpad (kommt als Wheel mit ctrlKey): Zoom proportional zur Bewegung –
    // eine Mausrad-Raste (100 px) ≈ 10 %, die vielen kleinen Pinch-Schritte zoomen entsprechend sanft
    if (e.ctrlKey) {
      e.preventDefault();
      const dy = Math.max(-100, Math.min(100, e.deltaY * (e.deltaMode === 1 ? 33 : 1)));
      setZoom(zoom * Math.exp(-dy * Math.log(1.1) / 100));
    }
  }, { passive: false });

  buildToolbar();
  initSpeed();
  initZoomInput();
  setToolbarMode(document.body.dataset.toolbar);
  // jede Änderung an den Knöpfen (gesperrt, Beschriftung) an die Seitenleiste melden
  new MutationObserver(() => reportTools()).observe(toolbar, { subtree: true, attributes: true, attributeFilter: ['disabled'], childList: true, characterData: true });
  updateExecButtons();
  applyZoom();
  post({ type: 'ready' });
})();
