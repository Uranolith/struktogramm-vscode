// Panel „Struktogramm-Ausführung“ unten in VS Code: zeigt die Ausführung des aktiven Struktogramm-Editors
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const L10N = (() => { try { return JSON.parse(document.body.dataset.l10n || '{}'); } catch (e) { return {}; } })();
  const T = (k, ...a) => { const s = L10N[k] != null ? L10N[k] : k; return a.length ? s.replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? String(a[i]) : m)) : s; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const post = (m) => vscode.postMessage(m);

  const box = document.getElementById('exec');
  const empty = document.getElementById('empty');
  box.innerHTML = window.StruktoExec.markup(T, esc, false);
  const EX = window.StruktoExec.create({ T, esc, post, onEscape: () => post({ type: 'focusEditor' }) });

  function showEmpty(hasEditor) {
    empty.hidden = false;
    box.hidden = true;
    empty.textContent = hasEditor ? T('execview.idle') : T('execview.noEditor');
  }

  function apply(m, live) {
    if (m.type === 'execReset') { empty.hidden = true; box.hidden = false; EX.reset(m.title); }
    else if (m.type === 'execOut') EX.out(m.lines);
    else if (m.type === 'execTurtle') EX.turtle(m.ops);
    else if (m.type === 'execState') EX.state(m, live);
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'replay') {
      if (!m.msgs.length) { showEmpty(m.hasEditor); return; }
      m.msgs.forEach((x, i) => apply(x, i === m.msgs.length - 1));
    } else if (m.type === 'clear') EX.clear();
    else apply(m, true);
  });
  showEmpty(false);
  post({ type: 'ready' });
})();
