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
    <div id="turtle" hidden title="Turtleizer"><svg id="turtlesvg" xmlns="http://www.w3.org/2000/svg"></svg></div>
    <div id="vars"></div>
  </div>`;
  }

  /**
   * opts: { T, esc, post(msg), onShow(), onEscape() }
   * Liefert { reset(title), out(lines), state(msg), turtle(ops), clear() }
   */
  function create(opts) {
    const { T, esc, post } = opts;
    const show = () => { if (opts.onShow) opts.onShow(); };

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
        html += `<div class="frame${k === frames.length - 1 ? ' top' : ''}">${callName(f)}${k === frames.length - 1 ? '' : ` <span class="muted">(${esc(T('web.vars.waiting'))})</span>`}</div>`;
        if (k === frames.length - 1 || frames.length <= 3) html += table(f.vars);
      }
      box.innerHTML = html;
    }
    let doneCount = 0;
    function completed(items) {
      const v = varsBox();
      const sec = v.querySelector('.vdone'), list = v.querySelector('.vlist');
      for (const c of items) {
        const d = document.createElement('div');
        d.className = 'doneframe';
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
        doneCount = 0;
        turtleReset();
        show();
        line('▶ ' + (title || ''), 'info');
      },
      out(lines) { show(); for (const l of lines) line(l.text, l.kind); },
      completed(items) { completed(items); },
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
