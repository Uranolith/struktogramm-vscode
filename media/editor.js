// Webview-Skript für Struktogramm-Editor und Live-Vorschau
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const READONLY = document.body.dataset.readonly === '1';
  const $ = (id) => document.getElementById(id);
  const toolbar = $('toolbar'), canvas = $('canvas'), scroller = $('scroller'), statusbar = $('statusbar');
  const menu = $('menu'), dialog = $('dialog'), message = $('message'), dropmark = $('dropmark');

  const saved = vscode.getState() || {};
  let doc = null;
  let svgText = '';
  let sel = saved.sel || null;
  let zoom = saved.zoom || 1;
  let where = saved.where || 'after';
  let hasClipboard = false;
  let settings = {};
  let speed = saved.speed != null ? saved.speed : 250;
  let breakpoints = new Set(saved.bps || []);
  let execState = 'idle';
  let runPath = null;
  let errPath = null;
  let symbols = { funcs: [], roots: [] };

  const save = () => vscode.setState({ sel, zoom, where, speed, bps: [...breakpoints] });
  const post = (m) => vscode.postMessage(m);
  const op = (cmd) => post({ type: 'op', cmd });

  /* ------------------------------------------------------------------ */
  const ICONS = {
    instruction: '<rect x="1.5" y="4.5" width="13" height="7"/>',
    alternative: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M1.5 2.5 L8 8 L14.5 2.5 M1.5 8 H14.5 M8 8 V13.5"/>',
    case: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M1.5 2.5 L11 8 L14.5 2.5 M1.5 8 H14.5 M5 8 V13.5 M8.2 8 V13.5 M11 8 V13.5"/>',
    for: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M5 6 H14.5 M5 6 V13.5"/><circle cx="3.3" cy="10.5" r=".9"/>',
    while: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M5 6 H14.5 M5 6 V13.5"/>',
    repeat: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M5 10 H14.5 M5 2.5 V10"/>',
    forever: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M5 5.5 H14.5 M5 5.5 V11 H14.5"/>',
    call: '<rect x="1.5" y="4.5" width="13" height="7"/><path d="M3.5 4.5 V11.5 M12.5 4.5 V11.5"/>',
    jump: '<rect x="1.5" y="4.5" width="13" height="7"/><path d="M4.5 4.5 L2 8 L4.5 11.5"/>',
    parallel: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M1.5 5 H14.5 M1.5 11 H14.5 M8 5 V11"/>',
  };
  const icon = (k) => `<svg class="ico" viewBox="0 0 16 16">${ICONS[k] || ''}</svg>`;

  const KINDS = [
    ['instruction', 'Anweisung', 'Anweisung (Zuweisung, Ein-/Ausgabe)'],
    ['alternative', 'Verzweigung', 'Verzweigung (if / else)'],
    ['case', 'Fallauswahl', 'Mehrfachauswahl (switch / case)'],
    ['for', 'Zählschleife', 'Zählschleife (for)'],
    ['while', 'Kopfschleife', 'Kopfgesteuerte Schleife (while)'],
    ['repeat', 'Fußschleife', 'Fußgesteuerte Schleife (repeat until / do while)'],
    ['forever', 'Endlos', 'Endlosschleife'],
    ['call', 'Aufruf', 'Unterprogramm-Aufruf'],
    ['jump', 'Sprung', 'Aussprung (leave, return, exit)'],
  ];

  const HINTS = {
    instruction: 'Eine Anweisung pro Zeile.\nZuweisung: x := 5     Deklaration: var x: int := 0\nEingabe: INPUT "Zahl: ", x     Ausgabe: OUTPUT "Summe: ", s\nVergleiche: =  <>  <  >  <=  >=     Logik: and  or  not',
    alternative: 'Bedingung, z.B.  x > 3 and y <> 0',
    case: '1. Zeile: Ausdruck (z.B. note)\nweitere Zeilen: je ein Fall, mehrere Werte mit Komma (z.B. 1, 2)\nletzte Zeile: default  –  oder  %  für „kein Sonst-Zweig“',
    for: 'Zählschleife:  for i := 1 to 10   oder   for i := 10 to 0 by -2\nDurchlaufschleife:  foreach x in liste',
    while: 'Kopfgesteuerte Schleife:  while x > 0',
    repeat: 'Fußgesteuerte Schleife (Abbruchbedingung):  until x = 0',
    forever: 'Endlosschleife – verlassen mit einem Sprung „leave“. Text optional.',
    call: 'Aufruf eines Unterprogramms:  ausgabe(a, b)   oder   x := summe(a, b)',
    jump: 'leave (Schleife verlassen)  ·  return x  ·  exit 0  ·  throw "Fehler"',
    parallel: 'Anzahl paralleler Zweige',
    root: 'Hauptprogramm: Name.  Unterprogramm: Signatur, z.B.  summe(a: int, b: int): int',
  };
  const TYPE_NAMES = { instruction: 'Anweisung', alternative: 'Verzweigung', case: 'Fallauswahl', for: 'Zählschleife', while: 'Kopfschleife', repeat: 'Fußschleife', forever: 'Endlosschleife', call: 'Aufruf', jump: 'Sprung', parallel: 'Parallel', root: 'Diagramm' };
  const COLORS = ['ffffff', 'ffd6d6', 'ffe8c2', 'fff3a8', 'd6f5d6', 'cfefff', 'd8e2ff', 'eadcff', 'e6e6e6'];

  function buildToolbar() {
    if (READONLY) {
      toolbar.innerHTML = `
        <span class="group"><button data-a="saveNsd" class="primary" title="Als .nsd-Datei speichern und im Editor öffnen">Als Struktogramm speichern</button>
        <button data-a="toCode" title="In eine andere Programmiersprache übersetzen">Code erzeugen …</button></span>
        <span class="group"><button data-a="export" title="Exportieren: SVG, PNG, JSON, XML oder KI-kompakt">Exportieren …</button><button data-a="aiClip" title="Token-sparenden Pseudocode für KI-Agents in die Zwischenablage kopieren">KI ⧉</button></span>
      <span class="group exec">
        <button data-x="run" class="run" title="Ausführen bzw. fortsetzen (F5). Ist ein Unterprogramm ausgewählt, wird dieses ausgeführt.">▶ <span>Ausführen</span></button>
        <button data-x="step" title="Einzelschritt (F10) – das hervorgehobene Element wird ausgeführt">⏭ <span>Schritt</span></button>
        <button data-x="pause" title="Anhalten (F6)">⏸</button>
        <button data-x="stop" title="Ausführung beenden (Umschalt+F5)">⏹</button>
        <select id="speed" title="Ausführungstempo"><option value="800">langsam</option><option value="250">mittel</option><option value="40">schnell</option><option value="0">sofort</option></select>
      </span>
        <span class="group"><button data-a="zoomOut" title="Verkleinern">−</button><span id="zoomLabel"></span><button data-a="zoomIn" title="Vergrößern">+</button></span>
        <span class="hint">Live-Vorschau – folgt dem aktiven Editor (bei Markierung nur der markierte Teil)</span>`;
      return;
    }
    toolbar.innerHTML = `
      <span class="group">${KINDS.map(([k, label, title]) => `<button data-kind="${k}" title="${title} einfügen">${icon(k)}<span>${label}</span></button>`).join('')}</span>
      <span class="group">
        <select id="where" title="Wo werden neue Elemente eingefügt?"><option value="after">danach einfügen</option><option value="before">davor einfügen</option></select>
      </span>
      <span class="group">
        <button data-a="edit" title="Bearbeiten (Enter / Doppelklick)">Bearbeiten</button>
        <button data-a="delete" title="Löschen (Entf)">Löschen</button>
        <button data-a="up" title="Nach oben (Strg+↑)">↑</button>
        <button data-a="down" title="Nach unten (Strg+↓)">↓</button>
      </span>
      <span class="group">
        <button data-a="copy" title="Kopieren (Strg+C)">Kopieren</button>
        <button data-a="cut" title="Ausschneiden (Strg+X)">Ausschneiden</button>
        <button data-a="paste" title="Einfügen (Strg+V)">Einfügen</button>
      </span>
      <span class="group">
        <button data-a="undo" title="Rückgängig">↶</button>
        <button data-a="redo" title="Wiederholen">↷</button>
      </span>
      <span class="group">
        <button data-a="addSub" title="Neues Unterprogramm (Funktion) anlegen">+ Unterprogramm</button>
      </span>
      <span class="group">
        <button data-a="toCode" class="primary" title="Code erzeugen – mit eigener Übersetzung oder dem Original-Structorizer">Code erzeugen …</button>
        <button data-a="export" title="Exportieren: SVG, PNG, JSON, XML oder KI-kompakt">Exportieren …</button>
        <button data-a="aiClip" title="Token-sparenden Pseudocode für KI-Agents in die Zwischenablage kopieren">KI ⧉</button>
        <button data-a="structorizer" title="Im Original-Structorizer öffnen (benötigt Java)">Structorizer</button>
      </span>
      <span class="group exec">
        <button data-x="run" class="run" title="Ausführen bzw. fortsetzen (F5). Ist ein Unterprogramm ausgewählt, wird dieses ausgeführt.">▶ <span>Ausführen</span></button>
        <button data-x="step" title="Einzelschritt (F10) – das hervorgehobene Element wird ausgeführt">⏭ <span>Schritt</span></button>
        <button data-x="pause" title="Anhalten (F6)">⏸</button>
        <button data-x="stop" title="Ausführung beenden (Umschalt+F5)">⏹</button>
        <select id="speed" title="Ausführungstempo"><option value="800">langsam</option><option value="250">mittel</option><option value="40">schnell</option><option value="0">sofort</option></select>
      </span>
      <span class="group"><button data-a="zoomOut" title="Verkleinern">−</button><span id="zoomLabel"></span><button data-a="zoomIn" title="Vergrößern">+</button></span>`;
    const w = $('where');
    w.value = where;
    w.addEventListener('change', () => { where = w.value; save(); });
  }

  function initSpeed() {
    const sp = $('speed');
    if (!sp) return;
    sp.value = String(speed);
    sp.addEventListener('change', () => { speed = Number(sp.value); save(); post({ type: 'exec', cmd: 'config', delay: speed }); });
  }

  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.kind) insertKind(b.dataset.kind, e.shiftKey ? 'before' : where);
    else if (b.dataset.x) execCmd(b.dataset.x);
    else action(b.dataset.a);
  });

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
    status('Kopiert: ' + (TYPE_NAMES[el.type] || el.type));
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
    const zl = $('zoomLabel');
    if (zl) zl.textContent = Math.round(zoom * 100) + ' %';
  }

  function status(t) { statusbar.textContent = t || ''; }

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
    if (!sel) status(doc && doc.roots.length ? 'Element anklicken zum Auswählen · Doppelklick zum Bearbeiten · Ziehen zum Verschieben · Rechtsklick für Menü' : '');
    else if (isEmpty) status('Leerer Zweig ausgewählt – ein neues Element wird hier eingefügt.');
    else if (el) status(`${TYPE_NAMES[el.type] || el.type} ausgewählt · Enter: bearbeiten · Entf: löschen · Strg+↑/↓: verschieben · Pfeiltasten: navigieren`);
  }

  /* ------------------------------ Nachrichten ------------------------------ */
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'update') {
      doc = m.doc;
      if (m.symbols) symbols = m.symbols;
      svgText = m.svg || '';
      settings = m.settings || settings;
      if (m.hasClipboard != null) hasClipboard = m.hasClipboard;
      if (m.select !== undefined) sel = m.select;
      if (m.error) { message.hidden = false; message.innerHTML = ''; message.textContent = m.error; if (!READONLY) { const b = document.createElement('button'); b.textContent = 'Als Text öffnen'; b.onclick = () => action('openText'); message.appendChild(b); } }
      else message.hidden = true;
      if (!READONLY && doc && !doc.roots.length) {
        message.hidden = false;
        message.innerHTML = 'Das Struktogramm ist leer. <button id="startBtn">Hauptprogramm anlegen</button>';
        $('startBtn').onclick = () => action('addMain');
      }
      render();
      if (m.editNew && sel) {
        const el = getAt(sel);
        if (el && (el.type !== 'forever')) openDialog(true);
      }
    } else if (m.type === 'clipboard') {
      hasClipboard = m.has; updateButtons();
    } else if (m.type === 'renderPng') renderPng(m.svg, m.id);
    else if (m.type === 'execCommand') execCmd(m.cmd);
    else if (m.type === 'execReset') {
      $('conout').innerHTML = '';
      $('vars').innerHTML = '';
      errPath = null;
      showExecPanel();
      conLine('▶ ' + (m.title || ''), 'info');
    } else if (m.type === 'execOut') {
      showExecPanel();
      for (const l of m.lines) conLine(l.text, l.kind);
    } else if (m.type === 'execState') {
      execState = m.state;
      runPath = m.state === 'done' ? null : m.path;
      if (m.errorPath) errPath = m.errorPath;
      showVars(m.frames || []);
      const form = $('conin');
      if (m.state === 'input') {
        form.hidden = false;
        $('conprompt').textContent = m.prompt || 'Eingabe:';
        const inp = $('coninput');
        inp.value = '';
        setTimeout(() => inp.focus(), 0);
      } else form.hidden = true;
      $('execstate').textContent = { running: 'läuft …', paused: 'angehalten', input: 'wartet auf Eingabe', done: 'beendet' }[m.state] || '';
      updateExecButtons();
      markExec(m.state === 'paused' || m.state === 'input');
    }
  });

  /* ------------------------------ Ausführung ------------------------------ */
  function execCmd(cmd) {
    if (cmd === 'run' || cmd === 'step') {
      showExecPanel();
      const fresh = execState === 'idle' || execState === 'done';
      let root;
      const mm = sel && /^roots\/(\d+)/.exec(sel);
      if (fresh && mm) root = parseInt(mm[1], 10);
      post({ type: 'exec', cmd, root, delay: speed, breakpoints: [...breakpoints] });
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
    if (rb) rb.textContent = execState === 'paused' ? 'Weiter' : 'Ausführen';
  }

  function markExec(scroll) {
    canvas.querySelectorAll('.running, .errorel, .bp').forEach((n) => n.classList.remove('running', 'errorel', 'bp'));
    for (const p of breakpoints) { const g = nodeFor(p); if (g) g.classList.add('bp'); }
    drawBreakpointFrames();
    const g = nodeFor(runPath);
    if (g) {
      g.classList.add('running');
      if (scroll) {
        const r = g.getBoundingClientRect(), s = scroller.getBoundingClientRect();
        if (r.top < s.top || r.bottom > s.bottom) g.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
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
    for (const p of breakpoints) {
      const g = nodeFor(p);
      const bg = g && g.querySelector(':scope > rect.bg');
      if (!bg) continue;
      const r = document.createElementNS(NS, 'rect');
      for (const a of ['x', 'y', 'width', 'height', 'rx', 'ry']) if (bg.hasAttribute(a)) r.setAttribute(a, bg.getAttribute(a));
      r.setAttribute('class', 'bp-frame');
      layer.appendChild(r);
    }
  }

  function toggleBreakpoint() {
    if (!sel || sel.endsWith('/#') || /^roots\/\d+$/.test(sel)) { status('Haltepunkte können nur auf Elemente gesetzt werden.'); return; }
    if (breakpoints.has(sel)) breakpoints.delete(sel); else breakpoints.add(sel);
    save();
    markExec(false);
    post({ type: 'exec', cmd: 'config', breakpoints: [...breakpoints] });
    status(breakpoints.has(sel) ? 'Haltepunkt gesetzt – die Ausführung hält vor diesem Element an.' : 'Haltepunkt entfernt.');
  }

  function showExecPanel() { $('execpanel').hidden = false; }

  function conLine(text, kind) {
    const out = $('conout');
    const d = document.createElement('div');
    d.className = 'line ' + (kind || 'out');
    d.textContent = kind === 'in' ? '› ' + text : text;
    out.appendChild(d);
    while (out.childNodes.length > 2000) out.removeChild(out.firstChild);
    out.scrollTop = out.scrollHeight;
  }

  function showVars(frames) {
    const v = $('vars');
    if (!frames.length) return;
    let html = '';
    for (let k = frames.length - 1; k >= 0; k--) {
      const f = frames[k];
      html += `<div class="frame${k === frames.length - 1 ? ' top' : ''}">${escapeHtml(f.name)}${k === frames.length - 1 ? '' : ' <span class="muted">(wartet)</span>'}</div>`;
      if (k === frames.length - 1 || frames.length <= 3) {
        html += '<table>' + (f.vars.length ? f.vars.map((x) => `<tr><td class="n">${escapeHtml(x.name)}</td><td class="v">${escapeHtml(x.value)}</td><td class="t">${escapeHtml(x.type || '')}</td></tr>`).join('') : '<tr><td class="muted">keine Variablen</td></tr>') + '</table>';
      }
    }
    v.innerHTML = html;
  }

  $('conin').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = $('coninput').value;
    $('conin').hidden = true;
    post({ type: 'execInput', value: val });
  });
  $('execClose').addEventListener('click', () => { if (execState === 'running' || execState === 'paused' || execState === 'input') post({ type: 'exec', cmd: 'stop' }); $('execpanel').hidden = true; runPath = null; errPath = null; markExec(false); });
  $('execClear').addEventListener('click', () => { $('conout').innerHTML = ''; });

  /* ------------------------------ Maus ------------------------------ */
  let drag = null;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    hideMenu();
    const g = e.target.closest('[data-path]');
    sel = g ? g.dataset.path : null;
    markSelection(false);
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
    if (el) items.push(['edit', 'Bearbeiten …', 'Enter']);
    items.push(['-']);
    items.push(['sub:after', 'Danach einfügen ▸']);
    if (el && !isRoot) items.push(['sub:before', 'Davor einfügen ▸']);
    if (el && !isRoot && ['instruction', 'call', 'jump', 'alternative', 'case', 'for', 'while', 'repeat', 'forever'].includes(el.type)) items.push(['sub:wrap', 'Umschließen mit ▸']);
    items.push(['-']);
    if (el && !isRoot) { items.push(['copy', 'Kopieren', 'Strg+C'], ['cut', 'Ausschneiden', 'Strg+X']); }
    items.push(['paste', 'Einfügen', 'Strg+V', !hasClipboard]);
    if (el && !isRoot) items.push(['toggleDisabled', el.disabled ? 'Aktivieren' : 'Deaktivieren']);
    if (el && !isRoot) items.push(['toggleBp', breakpoints.has(sel) ? 'Haltepunkt entfernen' : 'Haltepunkt setzen', 'F9']);
    if (el) items.push(['-'], ['up', 'Nach oben', 'Strg+↑'], ['down', 'Nach unten', 'Strg+↓'], ['delete', isRoot ? 'Diagramm löschen' : 'Löschen', 'Entf']);
    items.push(['-'], ['addSub', '+ Neues Unterprogramm'], ['addMain', '+ Neues Hauptprogramm']);
    menu.innerHTML = items.filter((it, i, a) => !(it[0] === '-' && (i === 0 || a[i - 1][0] === '-'))).map((it) => {
      if (it[0] === '-') return '<div class="sep"></div>';
      return `<div class="item${it[3] ? ' disabled' : ''}" data-m="${it[0]}"><span>${it[1]}</span><kbd>${it[2] || ''}</kbd></div>`;
    }).join('');
    menu.hidden = false;
    positionMenu(menu, x, y);
  }

  function positionMenu(m, x, y) {
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 4) + 'px';
    m.style.top = Math.min(y, window.innerHeight - r.height - 4) + 'px';
  }

  function hideMenu() { menu.hidden = true; const s = document.getElementById('submenu'); if (s) s.remove(); }

  menu.addEventListener('click', (e) => {
    const it = e.target.closest('.item');
    if (!it || it.classList.contains('disabled')) return;
    const a = it.dataset.m;
    if (a.startsWith('sub:')) {
      const mode = a.slice(4);
      const old = document.getElementById('submenu');
      if (old) old.remove();
      const sm = document.createElement('div');
      sm.id = 'submenu';
      sm.className = 'menu';
      const kinds = mode === 'wrap' ? KINDS.filter(([k]) => ['alternative', 'for', 'while', 'repeat', 'forever'].includes(k)) : KINDS;
      sm.innerHTML = kinds.map(([k, label]) => `<div class="item" data-k="${k}">${icon(k)}<span>${label}</span></div>`).join('');
      document.body.appendChild(sm);
      const r = it.getBoundingClientRect();
      positionMenu(sm, r.right, r.top);
      sm.addEventListener('click', (ev) => {
        const k = ev.target.closest('.item');
        if (!k) return;
        if (mode === 'wrap') op({ op: 'wrap', path: sel, kind: k.dataset.k });
        else insertKind(k.dataset.k, mode);
        hideMenu();
      });
      return;
    }
    hideMenu();
    if (a === 'toggleDisabled') { const el = getAt(sel); op({ op: 'update', path: sel, disabled: !el.disabled }); return; }
    action(a);
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu') && !e.target.closest('#submenu')) hideMenu(); });

  /* ------------------------------ Tastatur ------------------------------ */
  function siblingPath(path, d) {
    const parts = path.split('/');
    const last = parts[parts.length - 1];
    if (!/^\d+$/.test(last)) return null;
    parts[parts.length - 1] = String(parseInt(last, 10) + d);
    return parts.join('/');
  }

  function parentPath(path) {
    const parts = path.split('/');
    if (parts.length <= 2) return null;
    parts.pop(); // Index oder #
    if (/^\d+$/.test(parts[parts.length - 1]) && parts[parts.length - 2] === 'branches') parts.splice(-2, 2);
    else parts.pop();
    return parts.join('/');
  }

  function firstChildPath(path) {
    const el = getAt(path);
    if (!el) return null;
    const key = el.type === 'root' ? 'children' : el.type === 'alternative' ? 'qTrue' : el.branches ? 'branches/0' : el.body ? 'body' : null;
    if (!key) return null;
    const p = `${path}/${key}/0`;
    return nodeFor(p) ? p : `${path}/${key}/#`;
  }

  document.addEventListener('keydown', (e) => {
    if (!dialog.hidden) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === '+' || e.key === '=')) { setZoom(zoom * 1.15); e.preventDefault(); return; }
    if (ctrl && e.key === '-') { setZoom(zoom / 1.15); e.preventDefault(); return; }
    if (ctrl && e.key === '0') { setZoom(1); e.preventDefault(); return; }
    if (e.key === 'Escape') { hideMenu(); return; }
    if (e.key === 'F9') { toggleBreakpoint(); e.preventDefault(); return; }
    if (READONLY) return;
    if (ctrl && e.key.toLowerCase() === 'c') { if (copySel()) e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'x') { action('cut'); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'v') { action('paste'); e.preventDefault(); return; }
    if (!sel) {
      if (e.key.startsWith('Arrow') && doc && doc.roots.length) { sel = 'roots/0'; markSelection(true); e.preventDefault(); }
      return;
    }
    let np = null;
    if (ctrl && e.key === 'ArrowUp') { action('up'); e.preventDefault(); return; }
    if (ctrl && e.key === 'ArrowDown') { action('down'); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === 'F2') { if (sel.endsWith('/#')) insertKind('instruction', 'after'); else openDialog(); e.preventDefault(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { action('delete'); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') np = siblingPath(sel, -1);
    else if (e.key === 'ArrowDown') np = siblingPath(sel, 1);
    else if (e.key === 'ArrowLeft') np = parentPath(sel);
    else if (e.key === 'ArrowRight') np = firstChildPath(sel);
    if (np && nodeFor(np)) { sel = np; markSelection(true); e.preventDefault(); }
  });

  /* ------------------------------ Bearbeiten-Dialog ------------------------------ */
  function openDialog(isNew) {
    if (READONLY || !sel) return;
    const el = getAt(sel);
    if (!el) return;
    const type = el.type;
    const text = type === 'parallel' ? String(el.branches.length) : (el.text || []).join('\n');
    const comment = (el.comment || []).join('\n');
    const color = el.color || 'ffffff';
    dialog.innerHTML = `
      <div class="box" role="dialog" aria-label="Element bearbeiten">
        <h2>${icon(type === 'root' ? 'instruction' : type)} ${TYPE_NAMES[type] || type} ${isNew ? 'einfügen' : 'bearbeiten'}</h2>
        <label for="dText">${type === 'root' ? 'Name / Signatur' : type === 'alternative' ? 'Bedingung' : type === 'parallel' ? 'Anzahl Zweige' : 'Text'}</label>
        <textarea id="dText" rows="${Math.max(type === 'instruction' || type === 'case' ? 4 : 2, (el.text || []).length + 1)}" spellcheck="false">${escapeHtml(text)}</textarea>
        <div class="hint">${escapeHtml(HINTS[type] || '').replace(/\n/g, '<br>')}</div>
        ${type === 'root' ? `<div class="row"><label><input type="radio" name="rt" value="program" ${el.rootType === 'program' ? 'checked' : ''}> Hauptprogramm</label>
          <label><input type="radio" name="rt" value="sub" ${el.rootType === 'sub' ? 'checked' : ''}> Unterprogramm (Funktion)</label></div>` : ''}
        <label for="dComment">Kommentar</label>
        <textarea id="dComment" rows="2">${escapeHtml(comment)}</textarea>
        <div class="row colors">Farbe: ${COLORS.map((c) => `<button class="swatch${c === color ? ' on' : ''}" data-c="${c}" style="background:#${c}" title="#${c}"></button>`).join('')}</div>
        ${type !== 'root' ? `<div class="row"><label><input type="checkbox" id="dDisabled" ${el.disabled ? 'checked' : ''}> deaktiviert (wird bei der Codeerzeugung übersprungen)</label></div>` : ''}
        <div class="buttons"><button id="dCancel">Abbrechen</button><button id="dOk" class="primary">OK</button></div>
        <div class="hint small">Tab/Enter: Vorschlag übernehmen · Strg+Leertaste: Vorschläge · Strg+Enter: OK · Esc: Abbrechen</div>
      </div>`;
    dialog.hidden = false;
    let chosen = color;
    dialog.querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
      dialog.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      chosen = b.dataset.c;
    }));
    const ta = $('dText');
    const ac = type === 'root' || type === 'parallel' ? null : attachCompletion(ta, sel, type);
    ta.focus();
    if (isNew && type !== 'instruction') ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
    const path = sel;
    const close = () => { dialog.hidden = true; dialog.innerHTML = ''; };
    const ok = () => {
      // Deklarationen vereinheitlichen: "var x:int" / "var x : int" → "var x: int"
      const fixDecl = (l) => l.replace(/^(\s*(?:var|const|dim)\s+[^:="']*?)\s*:(?!=)\s*(?=\S)/i, '$1: ');
      const cmd = { op: 'update', path, text: ta.value.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => (type === 'instruction' ? fixDecl(l) : l)), comment: $('dComment').value.replace(/\r/g, ''), color: chosen };
      const rt = dialog.querySelector('input[name="rt"]:checked');
      if (rt) cmd.rootType = rt.value;
      const dis = $('dDisabled');
      if (dis) cmd.disabled = dis.checked;
      close();
      op(cmd);
    };
    $('dOk').onclick = ok;
    $('dCancel').onclick = close;
    dialog.onkeydown = (e) => {
      if (ac && e.target === ta && ac.key(e)) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Escape') { close(); e.preventDefault(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { ok(); e.preventDefault(); }
      else if (e.key === 'Enter' && type !== 'instruction' && type !== 'case' && type !== 'root' && e.target === ta && !e.shiftKey) { ok(); e.preventDefault(); }
      e.stopPropagation();
    };
  }

  /* ------------------------------ Autovervollständigung ------------------------------ */
  const BUILTINS = [
    ['sqrt', 1], ['abs', 1], ['pow', 2], ['sqr', 1], ['round', 1], ['floor', 1], ['ceil', 1], ['trunc', 1],
    ['random', 1], ['randint', 2], ['length', 1], ['len', 1], ['min', 2], ['max', 2], ['sum', 1], ['range', 2],
    ['upper', 1], ['lower', 1], ['substring', 3], ['copy', 3], ['pos', 2], ['chr', 1], ['ord', 1],
    ['str', 1], ['int', 1], ['float', 1], ['sin', 1], ['cos', 1], ['tan', 1], ['exp', 1], ['ln', 1], ['log', 1], ['odd', 1],
  ];
  // [Wort, Beschreibung, Leerzeichen anhängen, eher am Zeilenanfang]
  const KEYWORDS = [
    ['INPUT', 'Eingabe', 1, 1], ['OUTPUT', 'Ausgabe', 1, 1], ['var', 'Deklaration  var x: int', 1, 1], ['const', 'Konstante', 1, 1],
    ['for', 'Zählschleife  for i := 1 to n', 1, 1], ['foreach', 'Durchlaufschleife  foreach x in liste', 1, 1],
    ['while', 'Kopfschleife', 1, 1], ['until', 'Fußschleife (Abbruchbedingung)', 1, 1],
    ['leave', 'Schleife verlassen', 0, 1], ['return', 'Rückgabe', 1, 1], ['exit', 'Programm beenden', 1, 1],
    ['continue', 'nächster Schleifendurchlauf', 0, 1], ['throw', 'Fehler auslösen', 1, 1],
    ['to', 'for … to …', 1, 0], ['downto', 'for … downto …', 1, 0], ['by', 'Schrittweite', 1, 0], ['in', 'foreach … in …', 1, 0],
    ['and', 'logisches Und', 1, 0], ['or', 'logisches Oder', 1, 0], ['not', 'logisches Nicht', 1, 0],
    ['mod', 'Divisionsrest', 1, 0], ['true', 'wahr', 0, 0], ['false', 'falsch', 0, 0],
  ];
  const TYPE_WORDS = ['int', 'double', 'float', 'string', 'boolean', 'char'];
  const KIND_LABEL = { var: 'Variable', func: 'Unterprogramm', builtin: 'Funktion', kw: 'Schlüsselwort', type: 'Datentyp' };
  const KIND_ICON = { var: 'x', func: 'ƒ', builtin: 'ƒ', kw: 'K', type: 'T' };

  /** Kandidaten: Variablen des aktuellen Diagramms, dann Unterprogramme, Standardfunktionen, Schlüsselwörter */
  function completionItems(path) {
    const ri = parseInt((/^roots\/(\d+)/.exec(path || '') || [])[1] || '0', 10);
    const items = [], seen = new Set();
    // Name + "()" als Schlüssel: Datentyp "int" und Funktion "int()" dürfen beide vorkommen
    const push = (it) => { const k = it.name + (it.call ? '()' : ''); if (!seen.has(k)) { seen.add(k); items.push(it); } };
    for (const v of (symbols.roots && symbols.roots[ri]) || []) push({ name: v.name, kind: 'var', detail: v.type || '' });
    for (const f of symbols.funcs || []) push({ name: f.name, kind: 'func', detail: f.sig, call: true, params: f.params });
    // Datentypen vor gleichnamigen Funktionen: "in" → int, "int" → int()
    for (const t of TYPE_WORDS) push({ name: t, kind: 'type', detail: 'Datentyp', space: true });
    for (const [n, p] of BUILTINS) push({ name: n, kind: 'builtin', detail: TYPE_WORDS.includes(n) ? 'Umwandlung nach ' + n : n + '(…)', call: true, params: p });
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
          case 'instruction': return { items: uniq([...kws('INPUT', 'OUTPUT', 'var', 'const'), ...vars, ...funcs]) };
          case 'call': return { items: uniq([...funcs, ...vars]) };
          case 'jump': return { items: kws('leave', 'return', 'exit', 'continue', 'throw') };
          case 'for': return { items: kws('for', 'foreach') };
          case 'while': return { items: uniq([...kws('while'), ...expr()]) };
          case 'repeat': return { items: uniq([...kws('until'), ...expr()]) };
          case 'forever': return { items: [] };
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
        '<div class="cfoot">Tab / Enter: übernehmen · Esc: schließen</div>';
      box.hidden = false;
      const c = caretPos(ta);
      const w = box.offsetWidth, h = box.offsetHeight;
      box.style.left = Math.max(4, Math.min(c.x, window.innerWidth - w - 4)) + 'px';
      box.style.top = (c.y + h + 4 > window.innerHeight ? c.y - h - 22 : c.y + 2) + 'px';
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
        if (e.key === ' ' && e.ctrlKey) { forced = true; update(); return true; }
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
    img.onerror = () => { status('PNG-Export fehlgeschlagen.'); post({ type: 'pngData', id, error: 'Das Bild konnte nicht erzeugt werden.' }); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }
  }, { passive: false });

  buildToolbar();
  initSpeed();
  updateExecButtons();
  applyZoom();
  post({ type: 'ready' });
})();
