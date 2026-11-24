'use strict';
const vscode = require('vscode');
const { renderSvg } = require('./core/render');
const { t, allStrings, getLanguage } = require('./i18n');
const { getSplit } = require('./execSplit');

/** Ausführungsanzeige im Panel unten ('panel', Standard) oder im Editor unter dem Diagramm ('editor') */
const executionLocation = () => (vscode.workspace.getConfiguration('struktogramm').get('executionPanelLocation', 'panel') === 'editor' ? 'editor' : 'panel');

/** Werkzeuge in der Seitenleiste ('sidebar', Standard) oder in der Editor-Kopfzeile ('editor'); liest auch die frühere Dev-Vorschau-Einstellung */
function toolbarLocation() {
  const c = vscode.workspace.getConfiguration('struktogramm');
  const i = c.inspect('toolbarLocation') || {};
  const set = i.workspaceFolderValue ?? i.workspaceValue ?? i.globalValue;
  const v = set !== undefined ? set : c.get('devPreview.toolbarLocation', 'editor');
  return v === 'sidebar' ? 'sidebar' : 'editor';
}

/** Text für ein HTML-Attribut */
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function nonce() {
  let s = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

/** HTML für Editor (readonly=false) oder Vorschau (readonly=true) */
function webviewHtml(webview, extensionUri, readonly) {
  const media = vscode.Uri.joinPath(extensionUri, 'media');
  const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'editor.js'));
  const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'editor.css'));
  const n = nonce();
  return `<!DOCTYPE html>
<html lang="${getLanguage()}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(media, 'exec.css'))}">
<title>${attr(t('ext.filterNsd'))}</title>
</head>
<body data-readonly="${readonly ? 1 : 0}" data-toolbar="${readonly ? 'editor' : toolbarLocation()}" data-exec="${readonly ? 'editor' : executionLocation()}" data-split="${attr(JSON.stringify(getSplit() || {}))}" data-l10n="${attr(JSON.stringify(allStrings()))}">
<div id="toolbar" role="toolbar" aria-label="${attr(t('web.toolbarLabel'))}"></div>
<div id="message" hidden></div>
<div id="scroller"><div id="canvas"></div><div id="dropmark" hidden></div></div>
<div id="execpanel" hidden></div>
<div id="statusbar" role="status" aria-live="polite"></div>
<div id="menu" hidden></div>
<div id="dialog" hidden></div>
<script nonce="${n}" src="${webview.asWebviewUri(vscode.Uri.joinPath(media, 'icons.js'))}"></script>
<script nonce="${n}" src="${webview.asWebviewUri(vscode.Uri.joinPath(media, 'execui.js'))}"></script>
<script nonce="${n}" src="${js}"></script>
</body>
</html>`;
}

/** Farbschema des Diagramms: Einstellung oder automatisch nach VS-Code-Theme */
function editorTheme() {
  const k = vscode.window.activeColorTheme ? vscode.window.activeColorTheme.kind : 1;
  // 1 = Light, 2 = Dark, 3 = HighContrast (dunkel), 4 = HighContrastLight
  return k === 2 || k === 3 ? 'dark' : 'light';
}

function diagramTheme() {
  const th = vscode.workspace.getConfiguration('struktogramm').get('theme', 'auto');
  return th === 'light' || th === 'dark' ? th : editorTheme();
}

function settings() {
  const c = vscode.workspace.getConfiguration('struktogramm');
  return {
    theme: diagramTheme(),
    // leer = Standard: true / false
    trueLabel: c.get('trueLabel') || t('core.trueLabel'),
    falseLabel: c.get('falseLabel') || t('core.falseLabel'),
    pretty: c.get('prettyOperators', true),
    highlight: c.get('highlightKeywords', true),
  };
}

function render(model, overrides) {
  return renderSvg(model, { ...settings(), ...(overrides || {}) });
}

module.exports = { executionLocation, toolbarLocation, webviewHtml, settings, render, diagramTheme, editorTheme };
