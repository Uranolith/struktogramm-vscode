// Webview-Skript für Struktogramm-Editor und Live-Vorschau
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const READONLY = document.body.dataset.readonly === '1';
  const $ = (id) => document.getElementById(id);
  const toolbar = $('toolbar'), canvas = $('canvas'), scroller = $('scroller'), statusbar = $('statusbar');
  // Diagrammfläche per Tab erreichbar; Pfeiltasten wählen Elemente
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'application');
  scroller.setAttribute('aria-label', 'Struktogramm – Pfeiltasten wählen Elemente, Enter bearbeitet, ? zeigt alle Tastenkürzel');
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
    try: '<rect x="1.5" y="1.5" width="13" height="13"/><path d="M4.5 4 H14.5 M4.5 4 V7.5 H14.5 M4.5 9.5 H14.5 M4.5 9.5 V12.5 H14.5"/>',
  };
  const icon = (k) => `<svg class="ico" viewBox="0 0 16 16">${ICONS[k] || ''}</svg>`;

  // [Typ, Name, Beschreibung, Taste zum Einfügen]
  const KINDS = [
    ['instruction', 'Anweisung', 'Anweisung (Zuweisung, Ein-/Ausgabe)', 'i'],
    ['alternative', 'Verzweigung', 'Verzweigung (if / else)', 'v'],
    ['case', 'Fallauswahl', 'Mehrfachauswahl (switch / case)', 'f'],
    ['for', 'Zählschleife', 'Zählschleife (for)', 'z'],
    ['while', 'Kopfschleife', 'Kopfgesteuerte Schleife (while)', 'k'],
    ['repeat', 'Fußschleife', 'Fußgesteuerte Schleife (repeat until / do while)', 'u'],
    ['forever', 'Endlos', 'Endlosschleife', 'e'],
    ['call', 'Aufruf', 'Unterprogramm-Aufruf', 'a'],
    ['jump', 'Sprung', 'Aussprung (leave, return, exit, throw)', 's'],
    ['try', 'Try', 'Fehlerbehandlung (try / catch / finally)', 't'],
    ['parallel', 'Parallel', 'Parallelverarbeitung', 'p'],
  ];
  const KIND_BY_KEY = Object.fromEntries(KINDS.map(([k, , , key]) => [key, k]));

  const HINTS = {
    instruction: 'Eine Anweisung pro Zeile.\nZuweisung: x := 5     Deklaration: var x: int := 0\nEingabe: INPUT "Zahl: ", x     Ausgabe: OUTPUT "Summe: ", s\nVergleiche: =  <>  <  >  <=  >=     Logik: and  or  not',
    alternative: 'Bedingung, z.B.  x > 3 and y <> 0',
    case: '1. Zeile: Ausdruck (z.B. note)\nweitere Zeilen: je ein Fall, mehrere Werte mit Komma (z.B. 1, 2)\nletzte Zeile: default  –  oder  %  für „kein Sonst-Zweig“',
    for: 'Zählschleife:  for i := 1 to 10   oder   for i := 10 to 0 by -2\nDurchlaufschleife:  foreach x in liste',
    while: 'Kopfgesteuerte Schleife:  while x > 0',
    repeat: 'Fußgesteuerte Schleife (Abbruchbedingung):  until x = 0',
    forever: 'Endlosschleife – verlassen mit einem Sprung „leave“. Text optional.',
    call: 'Aufruf eines Unterprogramms:  ausgabe(a, b)   oder   x := summe(a, b)',
    jump: 'leave (Schleife verlassen)  ·  leave 2 (zwei Schleifen)  ·  return x  ·  exit 0  ·  throw "Fehler"',
    try: 'Name der Variable, die im catch-Teil die Fehlermeldung enthält, z.B.  fehler',
    parallel: 'Anzahl paralleler Zweige',
    root: 'Hauptprogramm: Name.  Unterprogramm: Signatur, z.B.  summe(a: int, b: int): int',
  };
  const TYPE_NAMES = { instruction: 'Anweisung', alternative: 'Verzweigung', case: 'Fallauswahl', for: 'Zählschleife', while: 'Kopfschleife', repeat: 'Fußschleife', forever: 'Endlosschleife', call: 'Aufruf', jump: 'Sprung', parallel: 'Parallel', try: 'Try', root: 'Diagramm' };
  const COLORS = ['ffffff', 'ffd6d6', 'ffe8c2', 'fff3a8', 'd6f5d6', 'cfefff', 'd8e2ff', 'eadcff', 'e6e6e6'];

  function buildToolbar() {
    if (READONLY) {
      toolbar.innerHTML = `
        <span class="group"><button data-a="saveNsd" class="primary" title="Als .nsd-Datei speichern und im Editor öffnen">Als Struktogramm speichern</button>
        <button data-a="toCode" title="In eine andere Programmiersprache übersetzen">Code erzeugen …</button></span>
        <span class="group"><button data-a="export" title="Exportieren: SVG, PNG, JSON, XML oder KI-kompakt">Exportieren …</button></span>
      <span class="group exec">
        <button data-x="run" class="run" title="Ausführen bzw. fortsetzen (F5). Ist ein Unterprogramm ausgewählt, wird dieses ausgeführt.">▶ <span>Ausführen</span></button>
        <button data-x="step" title="Einzelschritt (F10) – das hervorgehobene Element wird ausgeführt">⏭ <span>Schritt</span></button>
        <button data-x="pause" title="Anhalten (F6)">⏸</button>
        <button data-x="stop" title="Ausführung beenden (Umschalt+F5)">⏹</button>
        <select id="speed" title="Ausführungstempo"><option value="800">langsam</option><option value="250">mittel</option><option value="40">schnell</option><option value="0">sofort</option></select>
      </span>
        <span class="group"><button data-a="zoomOut" title="Verkleinern (Strg+−)" aria-label="Verkleinern">−</button><span id="zoomLabel"></span><button data-a="zoomIn" title="Vergrößern (Strg++)" aria-label="Vergrößern">+</button><button data-a="help" title="Tastenkürzel (?)" aria-label="Tastenkürzel anzeigen">?</button></span>
        <span class="hint">Live-Vorschau – folgt dem aktiven Editor (bei Markierung nur der markierte Teil)</span>`;
      return;
    }
    toolbar.innerHTML = `
      <span class="group" role="group" aria-label="Element einfügen">${KINDS.map(([k, label, title, key]) => `<button data-kind="${k}" title="${title} einfügen (Tastatur: Strg+Enter, dann ${key.toUpperCase()})" aria-label="${label} einfügen">${icon(k)}<span>${label}</span></button>`).join('')}</span>
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
        
        <button data-a="structorizer" title="Im Original-Structorizer öffnen (benötigt Java)">Structorizer</button>
      </span>
      <span class="group exec">
        <button data-x="run" class="run" title="Ausführen bzw. fortsetzen (F5). Ist ein Unterprogramm ausgewählt, wird dieses ausgeführt.">▶ <span>Ausführen</span></button>
        <button data-x="step" title="Einzelschritt (F10) – das hervorgehobene Element wird ausgeführt">⏭ <span>Schritt</span></button>
        <button data-x="pause" title="Anhalten (F6)">⏸</button>
        <button data-x="stop" title="Ausführung beenden (Umschalt+F5)">⏹</button>
        <select id="speed" title="Ausführungstempo"><option value="800">langsam</option><option value="250">mittel</option><option value="40">schnell</option><option value="0">sofort</option></select>
      </span>
      <span class="group"><button data-a="zoomOut" title="Verkleinern (Strg+−)" aria-label="Verkleinern">−</button><span id="zoomLabel"></span><button data-a="zoomIn" title="Vergrößern (Strg++)" aria-label="Vergrößern">+</button><button data-a="help" title="Tastenkürzel (?)" aria-label="Tastenkürzel anzeigen">?</button></span>`;
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
      case 'help': showHelp(); break;
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
    if (!sel) status(doc && doc.roots.length ? 'Element anklicken oder Pfeiltaste zum Auswählen · Enter bearbeiten · Strg+Enter einfügen · ? alle Tastenkürzel' : '');
    else if (isEmpty) status('Leerer Zweig ausgewählt – ein neues Element wird hier eingefügt.');
    else if (el) status(`${TYPE_NAMES[el.type] || el.type} ausgewählt · Enter: bearbeiten · Entf: löschen · Strg+↑/↓: verschieben · Pfeiltasten: navigieren`);
  }

  /* ------------------------------ Nachrichten ------------------------------ */
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'update') {
      closePicker(false); // neues Diagramm ersetzt eine offene Vorschau
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
        if (el && (el.type !== 'forever' || reopenAsEdit)) openDialog(!reopenAsEdit);
        reopenAsEdit = false;
      }
    } else if (m.type === 'clipboard') {
      hasClipboard = m.has; updateButtons();
    } else if (m.type === 'renderPng') renderPng(m.svg, m.id);
    else if (m.type === 'execCommand') execCmd(m.cmd);
    else if (m.type === 'execTurtle') turtleApply(m.ops);
    else if (m.type === 'preview') { if (picker && m.token === picker.token) showPreview(m.svg, m.path); }
    else if (m.type === 'execReset') {
      $('conout').innerHTML = '';
      $('vars').innerHTML = '';
      turtleReset();
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

  /* ------------------------------ Turtleizer ------------------------------ */
  // Zeichenfläche für forward/left/… – erscheint, sobald das Programm die Turtle benutzt
  const turtle = { lines: [], bg: '#ffffff', t: null };
  function turtleReset() {
    turtle.lines = []; turtle.bg = '#ffffff'; turtle.t = null;
    const box = $('turtle');
    if (box) { box.hidden = true; $('turtlesvg').innerHTML = ''; }
  }
  function turtleApply(ops) {
    for (const o of ops) {
      if (o.op === 'line') turtle.lines.push(o);
      else if (o.op === 'clear') turtle.lines = [];
      else if (o.op === 'bg') turtle.bg = o.c;
      else if (o.op === 'turtle') turtle.t = o;
    }
    showExecPanel();
    drawTurtle();
  }
  function drawTurtle() {
    const box = $('turtle'), svg = $('turtlesvg');
    if (!box || !svg) return;
    box.hidden = false;
    const t = turtle.t || { x: 0, y: 0, dir: 0, visible: true };
    let x0 = t.x, x1 = t.x, y0 = t.y, y1 = t.y;
    for (const l of turtle.lines) {
      x0 = Math.min(x0, l.x1, l.x2); x1 = Math.max(x1, l.x1, l.x2);
      y0 = Math.min(y0, l.y1, l.y2); y1 = Math.max(y1, l.y1, l.y2);
    }
    const pad = 20, w = Math.max(x1 - x0, 100) + 2 * pad, h = Math.max(y1 - y0, 100) + 2 * pad;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
    // Linien je Farbe zu einem Pfad zusammenfassen (schnell auch bei vielen Linien)
    const byColor = new Map();
    for (const l of turtle.lines) {
      const d = `M${l.x1.toFixed(2)} ${l.y1.toFixed(2)}L${l.x2.toFixed(2)} ${l.y2.toFixed(2)}`;
      byColor.set(l.c, (byColor.get(l.c) || '') + d);
    }
    let s = `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="${turtle.bg}"/>`;
    for (const [c, d] of byColor) s += `<path d="${d}" stroke="${c}" stroke-width="1.5" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    if (t.visible) {
      const sz = Math.max(w, h) / 30;
      s += `<g transform="translate(${t.x} ${t.y}) rotate(${-t.dir})"><polygon points="0,${-sz} ${sz * 0.6},${sz * 0.6} ${-sz * 0.6},${sz * 0.6}" fill="#2e8b57" stroke="#14532d" vector-effect="non-scaling-stroke"/></g>`;
    }
    svg.innerHTML = s;
  }

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
    if (el) items.push(['edit', 'Bearbeiten …', 'Enter']);
    items.push(['-']);
    items.push(['sub:after', 'Danach einfügen ▸']);
    if (el && !isRoot) items.push(['sub:before', 'Davor einfügen ▸']);
    if (el && !isRoot && ['instruction', 'call', 'jump', 'alternative', 'case', 'for', 'while', 'repeat', 'forever', 'try', 'parallel'].includes(el.type)) items.push(['sub:wrap', 'Umschließen mit ▸']);
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
    const title = { after: 'Danach einfügen', before: 'Davor einfügen', wrap: 'Umschließen mit' }[mode] || '';
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
    instruction: ['anweisung', 'zuweisung', 'input', 'output', 'eingabe', 'ausgabe', 'befehl', 'var'],
    alternative: ['verzweigung', 'if', 'wenn', 'falls', 'bedingung'],
    case: ['fallauswahl', 'switch', 'case', 'auswahl', 'mehrfach'],
    for: ['zählschleife', 'for', 'foreach', 'zähl'],
    while: ['kopfschleife', 'while', 'solange', 'kopf'],
    repeat: ['fußschleife', 'repeat', 'until', 'do', 'fuß', 'bis'],
    forever: ['endlosschleife', 'loop', 'endlos', 'forever'],
    call: ['aufruf', 'call', 'funktion', 'unterprogramm', 'prozedur'],
    jump: ['sprung', 'leave', 'return', 'exit', 'break', 'throw', 'continue'],
    try: ['try', 'catch', 'finally', 'fehler', 'ausnahme'],
    parallel: ['parallel', 'thread', 'gleichzeitig'],
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
    box.setAttribute('aria-label', 'Element einfügen');
    box.innerHTML = `<div class="ptitle">${w === 'before' ? 'Davor' : 'Danach'} einfügen – Enter übernimmt, Esc bricht ab</div>
      <input id="pickerInput" autocomplete="off" spellcheck="false" placeholder="Element suchen: Kopfschleife, if, try …" aria-autocomplete="list" aria-controls="pickerList">
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
    positionPicker(nodeFor(sel), w);
    pickerUpdate();
    picker.input.focus();
  }

  function pickerUpdate() {
    const p = picker;
    p.items = pickerMatches(p.input.value);
    if (p.idx >= p.items.length) p.idx = Math.max(0, p.items.length - 1);
    p.list.innerHTML = p.items.length
      ? p.items.map((it, i) => `<div class="pitem${i === p.idx ? ' active' : ''}" role="option" aria-selected="${i === p.idx}" data-i="${i}">${icon(it.k)}<span>${it.label}</span><kbd>${it.key.toUpperCase()}</kbd></div>`).join('')
      : '<div class="pempty">kein passendes Element</div>';
    const cur = p.items[p.idx];
    status(cur ? `${cur.label} einfügen (${cur.title}) – Enter übernimmt` : 'Kein passendes Element');
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

  /** Auswahlfeld direkt unter (bzw. über) dem Element platzieren */
  function positionPicker(g, w) {
    if (!picker) return;
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
    status(`${cur.label} eingefügt – Enter öffnet die Bearbeitung`);
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
  const BLOCK_NAMES = { qTrue: 'Ja-Zweig', qFalse: 'Nein-Zweig', body: 'Schleifenrumpf', qTry: 'try', qCatch: 'catch', qFinally: 'finally', children: '' };

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
  function nextOut(path) {
    for (let p = path; ;) {
      const s = splitPath(p);
      if (!s) return null;
      const arr = getAt(`${s.owner}/${s.key}`) || [];
      if (s.index >= 0 && s.index + 1 < arr.length) return `${s.owner}/${s.key}/${s.index + 1}`;
      if (isRootPath(s.owner)) return null;
      p = s.owner;
    }
  }

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
    if (ctrl && (key === 'ArrowRight' || key === 'ArrowLeft')) {
      // anderer Zweig desselben Elements: Ja/Nein, Fälle, try/catch/finally, parallele Zweige
      const keys = blockKeys(getAt(s.owner));
      const k = keys.indexOf(s.key) + (key === 'ArrowRight' ? 1 : -1);
      return k >= 0 && k < keys.length ? blockFirst(s.owner, keys[k]) : null;
    }
    switch (key) {
      case 'ArrowUp': return s.index > 0 ? `${s.owner}/${s.key}/${s.index - 1}` : s.owner;
      case 'ArrowDown': return nextOut(sel) || null;
      case 'ArrowLeft': return s.owner;
      case 'ArrowRight': { const keys = blockKeys(el); return keys.length ? blockFirst(sel, keys[0]) : null; }
      case 'Home': return blockFirst(s.owner, s.key);
      case 'End': return blockLast(s.owner, s.key);
      default: return null;
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
        where = ' · Fall ' + (String((owner.text || [])[k + 1] || '').trim() || k + 1);
      } else if (owner && owner.type === 'parallel' && /^branches\//.test(s.key)) where = ' · Zweig ' + (parseInt(s.key.split('/')[1], 10) + 1);
      else if (BLOCK_NAMES[s.key]) where = ' · ' + BLOCK_NAMES[s.key];
    }
    if (sel.endsWith('/#')) return 'Leerer Block' + where + ' – Enter: Anweisung einfügen · Strg+Enter: Element auswählen';
    const el = getAt(sel);
    if (!el) return '';
    const text = (el.text || []).filter((l) => String(l).trim()).join(' · ');
    return `${TYPE_NAMES[el.type] || el.type}${text ? ': ' + text : ''}${where}${el.disabled ? ' (deaktiviert)' : ''}${breakpoints.has(sel) ? ' (Haltepunkt)' : ''}`;
  }

  /** Übersicht aller Tasten */
  function showHelp() {
    const rows = [
      ['Navigation', ''],
      ['↑ / ↓', 'vorheriges / nächstes Element (über Blockgrenzen hinweg)'],
      ['→ / ←', 'in den ersten Block hinein / zum umgebenden Element'],
      ['Strg + → / ←', 'nächster / vorheriger Zweig (Ja/Nein, Fälle, try/catch/finally)'],
      ['Pos1 / Ende', 'erstes / letztes Element im Block'],
      ['Bild ↑ / ↓', 'vorheriges / nächstes Diagramm'],
      ['Bearbeiten', ''],
      ['Enter / F2', 'bearbeiten (im leeren Block: Anweisung einfügen)'],
      ['Strg+Enter / Einfg', 'Einfügen: Auswahl mit Vorschau öffnen, tippen filtert (z.B. K → Kopfschleife, „if“, „try“), ↑/↓ wählen, Enter fügt ein, Esc bricht ab – Strg+Umschalt+Enter bzw. Umschalt+Einfg fügt davor ein'],
      ['Enter (danach)', 'Detailbearbeitung des eingefügten Elements öffnen'],
      ['Umschalt+F10 / Menütaste', 'Kontextmenü (Umschließen, Deaktivieren …)'],
      ['Entf', 'löschen'],
      ['Strg + ↑ / ↓', 'Element verschieben'],
      ['Strg + C / X / V', 'kopieren / ausschneiden / einfügen'],
      ['Leertaste', 'Element aktivieren / deaktivieren'],
      ['Ausführen', ''],
      ['F5 / F10 / F6 / Umschalt+F5', 'ausführen / Einzelschritt / anhalten / beenden'],
      ['F9', 'Haltepunkt'],
      ['Ansicht', ''],
      ['Strg + + / − / 0', 'Zoom'],
      ['Tab', 'Werkzeugleiste und Ausführungsbereich erreichen'],
      ['?', 'diese Übersicht'],
    ];
    dialog.innerHTML = `<div class="box help" role="dialog" aria-label="Tastenkürzel"><h2>Tastenkürzel</h2><div class="hscroll" tabindex="0" aria-label="Liste der Tastenkürzel"><table>${rows.map(([k, d]) => (d ? `<tr><td><kbd>${escapeHtml(k)}</kbd></td><td>${escapeHtml(d)}</td></tr>` : `<tr><th colspan="2">${escapeHtml(k)}</th></tr>`)).join('')}</table></div><div class="buttons"><button id="hClose" class="primary">Schließen</button></div></div>`;
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
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === '+' || e.key === '=')) { setZoom(zoom * 1.15); e.preventDefault(); return; }
    if (ctrl && e.key === '-') { setZoom(zoom / 1.15); e.preventDefault(); return; }
    if (ctrl && e.key === '0') { setZoom(1); e.preventDefault(); return; }
    if (e.key === '?') { showHelp(); e.preventDefault(); return; }
    if (e.key === 'Escape') { hideMenu(); return; }
    if (e.key === 'F9') { toggleBreakpoint(); e.preventDefault(); return; }
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
      <div class="box" role="dialog" aria-label="Element bearbeiten">
        <h2>${icon(type === 'root' ? 'instruction' : type)} ${TYPE_NAMES[type] || type} ${isNew ? 'einfügen' : 'bearbeiten'}</h2>
        ${type !== 'root' ? `<label for="dType">Elementtyp</label>
        <select id="dType" title="Elementtyp wechseln – enthaltene Elemente bleiben erhalten">${KINDS.map(([k, label]) => `<option value="${k}"${k === type ? ' selected' : ''}>${label}</option>`).join('')}</select>` : ''}
        <label for="dText">${type === 'root' ? 'Name / Signatur' : type === 'alternative' ? 'Bedingung' : type === 'parallel' ? 'Anzahl Zweige' : type === 'try' ? 'Fehlervariable (catch)' : 'Text'}</label>
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
      e.stopPropagation();
    };
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
    ['type', 'Typdefinition  type Punkt = record{x: int; y: int}', 1, 1], ['record', 'Record-Typ', 0, 0], ['enum', 'Aufzählungstyp', 0, 0],
  ];
  const TYPE_WORDS = ['int', 'double', 'float', 'string', 'boolean', 'char'];
  const KIND_LABEL = { var: 'Variable', func: 'Unterprogramm', builtin: 'Funktion', proc: 'Prozedur', kw: 'Schlüsselwort', type: 'Datentyp' };
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
    for (const t of TYPE_WORDS) push({ name: t, kind: 'type', detail: 'Datentyp', space: true });
    for (const [n, p] of BUILTINS) push({ name: n, kind: 'builtin', detail: TYPE_WORDS.includes(n) ? 'Umwandlung nach ' + n : n + '(…)', call: true, params: p });
    for (const [n, p] of PROCEDURES) push({ name: n, kind: 'proc', detail: 'Prozedur ' + n + '(…)', call: true, params: p });
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
