'use strict';
/**
 * Panel „Struktogramm-Ausführung“ unten in VS Code (neben Probleme, Ausgabe, Debugkonsole …).
 * Zeigt Konsole, Eingabe, Turtleizer und Variablen des zuletzt aktiven Struktogramm-Editors.
 * Die Ausführung selbst läuft weiter über den ExecController des Editors; dieses Panel bekommt
 * eine Kopie aller Meldungen und hebt den Verlauf je Editor auf, damit es ihn jederzeit nachzeichnen kann.
 */
const vscode = require('vscode');
const { t, allStrings, getLanguage } = require('./i18n');
const { executionLocation } = require('./webview');

const VIEW_ID = 'struktograf.execution';
const MAX_LINES = 3000;
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class ExecViewProvider {
  constructor(context, editors) {
    this.context = context;
    this.editors = editors;    // NsdEditorProvider
    this.view = null;
    this.logs = new WeakMap(); // Editor-Zustand -> Meldungen seit dem letzten Start
    this.shown = null;         // Editor, dessen Verlauf gerade angezeigt wird
  }

  resolveWebviewView(view) {
    this.view = view;
    this.shown = null;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const n = nonce();
    const uri = (f) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    view.webview.html = `<!DOCTYPE html>
<html lang="${getLanguage()}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('exec.css')}">
<link rel="stylesheet" href="${uri('execview.css')}">
<title>${attr(t('web.exec.title'))}</title>
</head>
<body class="execview" data-l10n="${attr(JSON.stringify(allStrings()))}">
<div id="empty" hidden></div>
<div id="exec"></div>
<script nonce="${n}" src="${uri('execui.js')}"></script>
<script nonce="${n}" src="${uri('execview.js')}"></script>
</body>
</html>`;
    // Optionen nach dem HTML setzen (sonst lädt VS Code zuerst eine leere Seite ohne Content-Security-Policy)
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidChangeVisibility(() => { if (view.visible) this.showFor(this.editors.active, true); });
    view.onDidDispose(() => { if (this.view === view) { this.view = null; this.shown = null; } });
  }

  onMessage(msg) {
    if (msg.type === 'ready') { this.showFor(this.editors.active, true); return; }
    const ed = this.shown || this.editors.active;
    if (!ed) return;
    if (msg.type === 'execInput') ed.exec.handle(msg);
    else if (msg.type === 'focusEditor') ed.panel.reveal(ed.panel.viewColumn, false);
  }

  /** Meldung des ExecControllers eines Editors mitschneiden und ggf. anzeigen */
  forward(editorState, msg) {
    let log = this.logs.get(editorState);
    if (msg.type === 'execReset' || !log) { log = []; this.logs.set(editorState, log); }
    if (msg.type === 'execState') {
      const i = log.findIndex((m) => m.type === 'execState');
      if (i >= 0) log.splice(i, 1);
    }
    log.push(msg);
    // Konsole begrenzen: älteste Ausgaben verwerfen
    let lines = 0;
    for (const m of log) if (m.type === 'execOut') lines += m.lines.length;
    // Aufruf-Ereignisse begrenzen (der Interpreter zeichnet höchstens 5000 Aufrufe auf, also 10000 Ereignisse)
    let events = 0;
    for (const m of log) if (m.type === 'execCalls') events += m.items.length;
    while (events > 10000) {
      const i = log.findIndex((m) => m.type === 'execCalls');
      if (i < 0) break;
      events -= log[i].items.length;
      log.splice(i, 1);
    }
    // abgeschlossene Aufrufe begrenzen (die Anzeige zeigt höchstens 500)
    let calls = 0;
    for (const m of log) if (m.type === 'execCompleted') calls += m.items.length;
    while (calls > 600) {
      const i = log.findIndex((m) => m.type === 'execCompleted');
      if (i < 0) break;
      calls -= log[i].items.length;
      log.splice(i, 1);
    }
    while (lines > MAX_LINES) {
      const i = log.findIndex((m) => m.type === 'execOut');
      if (i < 0) break;
      lines -= log[i].lines.length;
      log.splice(i, 1);
    }
    if (executionLocation() !== 'panel') return;
    if (msg.type === 'execReset') this.reveal(editorState);
    if (this.view && this.shown === editorState) {
      this.view.webview.postMessage(msg);
      // Eingabe erwartet: Fokus ins Panel, damit man direkt tippen kann
      if (msg.type === 'execState' && msg.state === 'input') this.view.show(false);
    }
  }

  /** Panel sichtbar machen, ohne dem Editor den Fokus zu nehmen */
  reveal(editorState) {
    if (this.view) {
      if (!this.view.visible) this.view.show(true);
      this.showFor(editorState, false);
      return;
    }
    // Panel noch nie geöffnet: öffnen (holt sich den Verlauf beim Start), dann Fokus zurück in den Editor
    vscode.commands.executeCommand(VIEW_ID + '.focus').then(() => {
      if (editorState && editorState.panel) editorState.panel.reveal(editorState.panel.viewColumn, false);
    });
  }

  /** Verlauf eines Editors anzeigen (force: auch wenn er schon angezeigt wird) */
  showFor(editorState, force) {
    if (!this.view) return;
    if (!force && this.shown === editorState) return;
    this.shown = editorState || null;
    const file = editorState ? decodeURIComponent(editorState.document.uri.path.split('/').pop()) : '';
    this.view.description = file;
    this.view.webview.postMessage({ type: 'replay', hasEditor: !!editorState, file, msgs: editorState ? this.logs.get(editorState) || [] : [] });
  }

  clear() {
    const ed = this.shown;
    if (ed) this.logs.set(ed, (this.logs.get(ed) || []).filter((m) => m.type !== 'execOut'));
    if (this.view) this.view.webview.postMessage({ type: 'clear' });
  }
}

function nonce() {
  let s = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

module.exports = { ExecViewProvider, VIEW_ID: VIEW_ID, executionLocation };
