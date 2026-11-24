// Ausführungsanzeige (Konsole, Eingabe, Turtleizer, Variablen) – gemeinsam für den Struktogramm-Editor
// und das Panel „Struktogramm-Ausführung“ unten in VS Code. Erwartet die Elemente aus StruktoExec.markup().
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  /** HTML der Anzeige; T: Übersetzung, esc: HTML-Maskierung, closable: Schließen-Knopf (nur im Editor) */
  function markup(T, esc, closable) {
    return `<div class="exechead"><b>${esc(T('web.exec.title'))}</b> <span id="execstate"></span><span class="spacer"></span>`
      + `<button id="execClear" title="${esc(T('web.exec.clear.title'))}">${esc(T('web.exec.clear'))}</button>`
      + (closable ? `<button id="execMove" title="${esc(T('web.exec.toPanel.title'))}" aria-label="${esc(T('web.exec.toPanel.title'))}">⇲</button>` : '')
      + (closable ? `<button id="execClose" title="${esc(T('web.exec.close.title'))}" aria-label="${esc(T('web.exec.close.title'))}">✕</button>` : '')
      + `</div>
  <div class="execbody">
    <div id="console"><div id="conout" role="log" aria-live="polite"></div><form id="conin" hidden><label id="conprompt" for="coninput"></label><input id="coninput" autocomplete="off" spellcheck="false"><button type="submit">OK</button></form></div>
    <div class="sash" id="sashTurtle" role="separator" aria-orientation="vertical" tabindex="0" title="${esc(T('web.exec.resize'))}" aria-label="${esc(T('web.exec.resize'))}"></div>
    <div id="turtle" hidden title="Turtleizer"><svg id="turtlesvg" xmlns="http://www.w3.org/2000/svg"></svg></div>
    <div class="sash" id="sashSide" role="separator" aria-orientation="vertical" tabindex="0" title="${esc(T('web.exec.resize'))}" aria-label="${esc(T('web.exec.resize'))}"></div>
    <div id="side">
      <div class="stabs" role="tablist">
        <button role="tab" id="tabVars" data-tab="vars" class="on" aria-selected="true" aria-controls="vars">${esc(T('web.tab.vars'))}</button>
        <button role="tab" id="tabCalls" data-tab="calls" aria-selected="false" aria-controls="calls">${esc(T('web.tab.calls'))}</button>
      </div>
      <div id="vars" role="tabpanel" aria-labelledby="tabVars"></div>
      <div id="calls" role="tabpanel" aria-labelledby="tabCalls" hidden></div>
    </div>
  </div>`;
  }

  /**
   * Breite der Bereiche per Trennbalken ziehen (wie die Sashes in VS Code): Konsole | Turtleizer | Variablen/Aufrufe.
   * Turtleizer und rechter Bereich haben einen Anteil an der Breite, die Konsole bekommt den Rest.
   * Doppelklick setzt zurück, ←/→ verstellen per Tastatur. Die Aufteilung speichert die Extension (execSplit).
   */
  const SPLIT_DEFAULT = { side: 0.4, turtle: 0.3 };
  const MIN_PANE = 110, MIN_CONSOLE = 150;
  function initSplit(post) {
    let saved = {};
    try { saved = JSON.parse(document.body.dataset.split || '{}') || {}; } catch (e) { saved = {}; }
    const split = { side: saved.side || SPLIT_DEFAULT.side, turtle: saved.turtle || SPLIT_DEFAULT.turtle };
    const body = document.querySelector('.execbody');
    const apply = () => {
      $('side').style.flex = `0 0 ${(split.side * 100).toFixed(2)}%`;
      $('turtle').style.flex = `0 0 ${(split.turtle * 100).toFixed(2)}%`;
    };
    // neue Breite in Pixeln für einen Bereich, begrenzt: jeder Bereich min. MIN_PANE, Konsole min. MIN_CONSOLE
    const setWidth = (which, px) => {
      const W = body.getBoundingClientRect().width;
      if (!W) return;
      const other = which === 'side' ? ($('turtle').hidden ? 0 : $('turtle').getBoundingClientRect().width) : $('side').getBoundingClientRect().width;
      const max = Math.max(MIN_PANE, W - MIN_CONSOLE - other);
      split[which] = Math.min(max, Math.max(MIN_PANE, px)) / W;
      apply();
    };
    const save = () => post({ type: 'execSplit', split: { ...split } });
    for (const [id, which] of [['sashSide', 'side'], ['sashTurtle', 'turtle']]) {
      const sash = $(id);
      // Breite des Bereichs rechts vom Balken = rechter Rand des Bereichs − Mausposition
      const widthAt = (x) => $(which).getBoundingClientRect().right - x;
      sash.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try { sash.setPointerCapture(e.pointerId); } catch (err) { /* Zeiger schon weg */ }
        sash.classList.add('active');
        const move = (ev) => setWidth(which, widthAt(ev.clientX));
        const end = () => {
          sash.removeEventListener('pointermove', move);
          sash.removeEventListener('pointerup', end);
          sash.removeEventListener('lostpointercapture', end);
          if (sash.classList.contains('active')) { sash.classList.remove('active'); save(); }
        };
        sash.addEventListener('pointermove', move);
        sash.addEventListener('pointerup', end);
        sash.addEventListener('lostpointercapture', end);
      });
      sash.addEventListener('dblclick', () => { split[which] = SPLIT_DEFAULT[which]; apply(); save(); });
      sash.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        // ← macht den Bereich rechts vom Balken breiter, → schmaler
        setWidth(which, $(which).getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 20 : -20));
        save();
        e.preventDefault();
        e.stopPropagation(); // nicht zur Diagramm-Navigation des Editors
      });
    }
    apply();
  }

  /**
   * opts: { T, esc, post(msg), onShow(), onEscape() }
   * Liefert { reset(title), out(lines), state(msg), turtle(ops), clear() }
   */
  function create(opts) {
    const { T, esc, post } = opts;
    const show = () => { if (opts.onShow) opts.onShow(); };
    initSplit(post);

    function line(text, kind) {
      const out = $('conout');
      const d = document.createElement('div');
      d.className = 'line ' + (kind || 'out');
      d.textContent = kind === 'in' ? '› ' + text : text;
      out.appendChild(d);
      while (out.childNodes.length > 2000) out.removeChild(out.firstChild);
      out.scrollTop = out.scrollHeight;
    }

    // Name eines Aufrufs; Unterprogramme mit Aufrufnummer, damit mehrfache Aufrufe unterscheidbar sind
    const callName = (f) => esc(f.name) + (f.main || !f.callNo ? '' : ` <span class="callno">#${f.callNo}</span>`);
    const table = (list) => '<table>' + (list.length ? list.map((x) => `<tr><td class="n">${esc(x.name)}</td><td class="v">${esc(x.value)}</td><td class="t">${esc(x.type || '')}</td></tr>`).join('') : `<tr><td class="muted">${esc(T('web.vars.none'))}</td></tr>`) + '</table>';

    // Variablenansicht: oben die laufenden Aufrufe, darunter die abgeschlossenen (neueste zuerst)
    function varsBox() {
      const v = $('vars');
      if (!v.querySelector('.vactive')) v.innerHTML = '<div class="vactive"></div><div class="vdone" hidden><div class="vhead"></div><div class="vlist"></div></div>';
      return v;
    }
    function vars(frames) {
      const box = varsBox().querySelector('.vactive');
      let html = '';
      for (let k = frames.length - 1; k >= 0; k--) {
        const f = frames[k];
        html += `<div class="frame${k === frames.length - 1 ? ' top' : ''}" data-call="${f.id}">${callName(f)}${k === frames.length - 1 ? '' : ` <span class="muted">(${esc(T('web.vars.waiting'))})</span>`}</div>`;
        if (k === frames.length - 1 || frames.length <= 3) html += table(f.vars);
      }
      box.innerHTML = html;
    }
    /* ---------- Reiter ---------- */
    function showTab(tab) {
      for (const b of document.querySelectorAll('.stabs [data-tab]')) {
        const on = b.dataset.tab === tab;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
        $(b.dataset.tab).hidden = !on;
      }
    }
    document.querySelector('.stabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
    document.querySelector('.stabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = $('tabVars').classList.contains('on') ? 'calls' : 'vars';
      showTab(next); $(next === 'vars' ? 'tabVars' : 'tabCalls').focus(); e.preventDefault();
    });

    /* ---------- Reiter „Aufrufe“: Aufrufstapel und Aufrufverlauf als Baum ---------- */
    const calls = { nodes: new Map(), count: 0, total: 0 };
    const argText = (args) => args.map((a) => `${a.name}=${a.value.length > 30 ? a.value.slice(0, 29) + '…' : a.value}`).join(', ');
    function callsBox() {
      const c = $('calls');
      if (!c.querySelector('.cstack')) {
        c.innerHTML = `<div class="vhead first">${esc(T('web.calls.stack'))}</div><div class="cstack"></div><div class="vhead chead"></div><div class="ctree" role="tree"></div><div class="cmore muted" hidden></div>`;
      }
      return c;
    }
    function stack(frames, state) {
      const box = callsBox().querySelector('.cstack');
      if (!frames.length) { box.innerHTML = `<div class="muted">${esc(T(state === 'done' ? 'web.calls.finished' : 'web.calls.none'))}</div>`; return; }
      let h = '';
      for (let k = frames.length - 1; k >= 0; k--) {
        const f = frames[k];
        const args = calls.nodes.get(f.id);
        h += `<div class="crow${k === frames.length - 1 ? ' top' : ''}" data-call="${f.id}"><span class="cname">${callName(f)}</span>${args && args.args.length ? ` <span class="cargs">(${esc(argText(args.args))})</span>` : ''}</div>`;
      }
      box.innerHTML = h;
      // laufende Aufrufe im Verlauf markieren
      const live = new Set(frames.map((f) => f.id));
      for (const [id, n] of calls.nodes) n.row.classList.toggle('live', live.has(id) && !n.done);
    }
    function callEvents(items, total) {
      const c = callsBox();
      const tree = c.querySelector('.ctree');
      for (const e of items) {
        if (e.ev === 'start') {
          const el = document.createElement('div');
          el.className = 'cnode';
          el.setAttribute('role', 'treeitem');
          el.innerHTML = `<div class="crow live" data-call="${e.id}"><span class="twist"></span><span class="cname">${callName(e)}</span>${e.args.length ? ` <span class="cargs">(${esc(argText(e.args))})</span>` : ''} <span class="cres muted">${esc(T('web.calls.running'))}</span></div><div class="kids" role="group"></div>`;
          const parent = calls.nodes.get(e.parent);
          (parent ? parent.kids : tree).appendChild(el);
          if (parent) parent.row.querySelector('.twist').classList.add('has');
          calls.nodes.set(e.id, { row: el.firstChild, kids: el.lastChild, el, args: e.args, done: false });
          calls.count++;
        } else if (e.ev === 'end') {
          const n = calls.nodes.get(e.id);
          if (!n) continue;
          n.done = true;
          n.row.classList.remove('live');
          const r = n.row.querySelector('.cres');
          r.className = 'cres' + (e.aborted ? ' err' : '');
          r.textContent = e.aborted ? `(${T('web.vars.aborted')})` : e.result !== undefined ? `→ ${e.result}` : '✓';
        }
      }
      calls.total = Math.max(calls.total, total || 0);
      c.querySelector('.chead').textContent = T('web.calls.history', calls.total || calls.count);
      const more = c.querySelector('.cmore');
      more.hidden = calls.total <= calls.count;
      if (!more.hidden) more.textContent = T('web.calls.truncated', calls.total - calls.count);
    }
    // Teilbäume ein-/ausklappen; Klick auf einen Aufruf zeigt seine Variablen
    $('calls').addEventListener('click', (e) => {
      const tw = e.target.closest('.twist.has');
      if (tw) { tw.closest('.cnode').classList.toggle('closed'); return; }
      const row = e.target.closest('.crow');
      if (!row) return;
      const id = row.dataset.call;
      showTab('vars');
      const target = $('vars').querySelector(`.doneframe[data-call="${id}"]`) || $('vars').querySelector(`.frame[data-call="${id}"]`);
      if (target) {
        target.scrollIntoView({ block: 'start' });
        target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
      }
    });

    let doneCount = 0;
    function completed(items) {
      const v = varsBox();
      const sec = v.querySelector('.vdone'), list = v.querySelector('.vlist');
      for (const c of items) {
        const d = document.createElement('div');
        d.className = 'doneframe';
        d.dataset.call = c.id;
        d.innerHTML = `<div class="frame">${callName(c)} <span class="muted">(${esc(T(c.aborted ? 'web.vars.aborted' : 'web.vars.complete'))})</span>${c.result !== undefined ? ` <span class="ret">→ ${esc(c.result)}</span>` : ''}</div>` + table(c.vars);
        list.insertBefore(d, list.firstChild);
        doneCount++;
      }
      while (list.childNodes.length > 500) list.removeChild(list.lastChild);
      sec.hidden = !doneCount;
      v.querySelector('.vhead').textContent = T('web.vars.doneHeader', doneCount);
    }

    // Turtleizer: Zeichenfläche für forward/left/… – erscheint, sobald das Programm die Turtle benutzt
    const tt = { lines: [], bg: '#ffffff', t: null };
    function turtleReset() {
      tt.lines = []; tt.bg = '#ffffff'; tt.t = null;
      $('turtle').hidden = true; $('turtlesvg').innerHTML = '';
    }
    function drawTurtle() {
      const box = $('turtle'), svg = $('turtlesvg');
      box.hidden = false;
      const t = tt.t || { x: 0, y: 0, dir: 0, visible: true };
      let x0 = t.x, x1 = t.x, y0 = t.y, y1 = t.y;
      for (const l of tt.lines) {
        x0 = Math.min(x0, l.x1, l.x2); x1 = Math.max(x1, l.x1, l.x2);
        y0 = Math.min(y0, l.y1, l.y2); y1 = Math.max(y1, l.y1, l.y2);
      }
      const pad = 20, w = Math.max(x1 - x0, 100) + 2 * pad, h = Math.max(y1 - y0, 100) + 2 * pad;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
      // Linien je Farbe zu einem Pfad zusammenfassen (schnell auch bei vielen Linien)
      const byColor = new Map();
      for (const l of tt.lines) {
        const d = `M${l.x1.toFixed(2)} ${l.y1.toFixed(2)}L${l.x2.toFixed(2)} ${l.y2.toFixed(2)}`;
        byColor.set(l.c, (byColor.get(l.c) || '') + d);
      }
      let s = `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="${tt.bg}"/>`;
      for (const [c, d] of byColor) s += `<path d="${d}" stroke="${c}" stroke-width="1.5" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
      if (t.visible) {
        const sz = Math.max(w, h) / 30;
        s += `<g transform="translate(${t.x} ${t.y}) rotate(${-t.dir})"><polygon points="0,${-sz} ${sz * 0.6},${sz * 0.6} ${-sz * 0.6},${sz * 0.6}" fill="#2e8b57" stroke="#14532d" vector-effect="non-scaling-stroke"/></g>`;
      }
      svg.innerHTML = s;
    }

    $('conin').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = $('coninput').value;
      $('conin').hidden = true;
      post({ type: 'execInput', value: val });
    });
    $('coninput').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && opts.onEscape) { opts.onEscape(); e.preventDefault(); }
    });
    $('execClear').addEventListener('click', () => { $('conout').innerHTML = ''; });

    return {
      reset(title) {
        $('conout').innerHTML = '';
        $('vars').innerHTML = '';
        $('calls').innerHTML = '';
        calls.nodes.clear(); calls.count = 0; calls.total = 0;
        doneCount = 0;
        turtleReset();
        show();
        line('▶ ' + (title || ''), 'info');
      },
      out(lines) { show(); for (const l of lines) line(l.text, l.kind); },
      completed(items) { completed(items); },
      calls(items, total) { callEvents(items, total); },
      turtle(ops) {
        for (const o of ops) {
          if (o.op === 'line') tt.lines.push(o);
          else if (o.op === 'clear') tt.lines = [];
          else if (o.op === 'bg') tt.bg = o.c;
          else if (o.op === 'turtle') tt.t = o;
        }
        show();
        drawTurtle();
      },
      state(m, focusInput) {
        vars(m.frames || []);
        stack(m.frames || [], m.state);
        const form = $('conin');
        if (m.state === 'input') {
          form.hidden = false;
          $('conprompt').textContent = m.prompt || T('web.inputPrompt');
          const inp = $('coninput');
          inp.value = '';
          if (focusInput !== false) setTimeout(() => inp.focus(), 0);
        } else form.hidden = true;
        $('execstate').textContent = { running: T('web.state.running'), paused: T('web.state.paused'), input: T('web.state.input'), done: T('web.state.done') }[m.state] || '';
      },
      clear() { $('conout').innerHTML = ''; },
    };
  }

  window.StruktoExec = { markup, create };
})();
