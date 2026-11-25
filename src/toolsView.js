'use strict';
/**
 * Struktograf-Seitenleiste: die Werkzeuge der Editor-Kopfzeile als Ansicht in der Aktivitätsleiste.
 * Befehle gehen an den zuletzt aktiven Struktogramm-Editor, sein Zustand (gesperrte Knöpfe, Tempo, Zoom) kommt zurück.
 */
const vscode = require('vscode');
const { t, allStrings, getLanguage } = require('./i18n');
const { toolbarLocation } = require('./webview');

const VIEW_ID = 'struktograf.tools';
const LAYOUT_KEY = 'struktograf.toolsLayout'; // Reihenfolge und eingeklappte Kategorien der Seitenleiste
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class ToolsViewProvider {
  constructor(context, editors) {
    this.context = context;
    this.editors = editors;   // NsdEditorProvider
    this.view = null;
    this.states = new WeakMap(); // Editor-Zustand -> zuletzt gemeldeter Knopf-Zustand
  }

  /** HTML der Ansicht (Texte in der eingestellten Sprache) */
  html(view) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const n = nonce();
    const uri = (f) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    return `<!DOCTYPE html>
<html lang="${getLanguage()}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('tools.css')}">
<title>${attr(t('tools.title'))}</title>
</head>
<body data-l10n="${attr(JSON.stringify(allStrings()))}">
<div id="root"></div>
<script nonce="${n}" src="${uri('icons.js')}"></script>
<script nonce="${n}" src="${uri('tools.js')}"></script>
</body>
</html>`;
  }

  /** nach einem Sprachwechsel neu aufbauen */
  relocalize() {
    if (!this.view) return;
    this.view.webview.html = this.html(this.view);
    this.refresh(true);
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.html = this.html(view);
    // Optionen nach dem HTML setzen: sonst lädt VS Code zuerst eine leere Seite ohne Content-Security-Policy
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidChangeVisibility(() => { if (view.visible) this.refresh(true); });
    view.onDidDispose(() => { if (this.view === view) this.view = null; });
  }

  onMessage(msg) {
    if (msg.type === 'ready') { this.refresh(true); return; }
    if (msg.type === 'command') { vscode.commands.executeCommand(msg.command); return; }
    if (msg.type === 'layout') { this.context.globalState.update(LAYOUT_KEY, { order: msg.order, collapsed: msg.collapsed }); return; }
    if (msg.type !== 'tool') return;
    const target = this.editors.active;
    if (!target) return;
    // Aktionen mit Dialog oder Tastaturbedienung: Fokus in den Editor, damit es direkt weitergeht
    const focus = !!(msg.kind || ['edit', 'help', 'addSub'].includes(msg.a));
    if (focus) target.panel.reveal(target.panel.viewColumn, false);
    target.panel.webview.postMessage({ ...msg, type: 'tool' });
  }

  /** Zustand eines Editors merken und anzeigen, wenn er der aktive ist */
  setState(editorState, toolState) {
    this.states.set(editorState, toolState);
    if (editorState === this.editors.active) this.refresh(false);
  }

  /** Ansicht auf den aktiven Editor abgleichen; force: Editor erneut nach seinem Zustand fragen */
  refresh(force) {
    if (!this.view) return;
    const ed = this.editors.active;
    if (ed && force) ed.panel.webview.postMessage({ type: 'toolStateRequest' });
    // Dateiname als Beschreibung neben dem Titel der Ansicht (wie VS Code es macht)
    this.view.description = ed ? decodeURIComponent(ed.document.uri.path.split('/').pop()) : '';
    this.view.webview.postMessage({
      type: 'state',
      hasEditor: !!ed,
      file: ed ? decodeURIComponent(ed.document.uri.path.split('/').pop()) : '',
      state: ed ? this.states.get(ed) || null : null,
      layout: this.context.globalState.get(LAYOUT_KEY) || null,
    });
  }

  /** Reihenfolge und eingeklappte Kategorien auf den Standard zurücksetzen */
  resetLayout() {
    this.context.globalState.update(LAYOUT_KEY, undefined);
    if (this.view) this.view.webview.postMessage({ type: 'resetLayout' });
  }
}

function nonce() {
  let s = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

module.exports = { ToolsViewProvider, VIEW_ID };
