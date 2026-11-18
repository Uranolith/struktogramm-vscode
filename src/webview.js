'use strict';
const vscode = require('vscode');
const { renderSvg } = require('./core/render');

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
<html lang="de">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>Struktogramm</title>
</head>
<body data-readonly="${readonly ? 1 : 0}">
<div id="toolbar"></div>
<div id="message" hidden></div>
<div id="scroller"><div id="canvas"></div><div id="dropmark" hidden></div></div>
<div id="execpanel" hidden>
  <div class="exechead"><b>Ausführung</b> <span id="execstate"></span><span class="spacer"></span><button id="execClear" title="Ausgabe leeren">Leeren</button><button id="execClose" title="Schließen (beendet die Ausführung)">✕</button></div>
  <div class="execbody">
    <div id="console"><div id="conout"></div><form id="conin" hidden><label id="conprompt" for="coninput"></label><input id="coninput" autocomplete="off" spellcheck="false"><button type="submit">OK</button></form></div>
    <div id="turtle" hidden title="Turtleizer"><svg id="turtlesvg" xmlns="http://www.w3.org/2000/svg"></svg></div>
    <div id="vars"></div>
  </div>
</div>
<div id="statusbar"></div>
<div id="menu" hidden></div>
<div id="dialog" hidden></div>
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
  const t = vscode.workspace.getConfiguration('struktogramm').get('theme', 'auto');
  return t === 'light' || t === 'dark' ? t : editorTheme();
}

function settings() {
  const c = vscode.workspace.getConfiguration('struktogramm');
  return {
    theme: diagramTheme(),
    trueLabel: c.get('trueLabel', 'ja'),
    falseLabel: c.get('falseLabel', 'nein'),
    pretty: c.get('prettyOperators', true),
    highlight: c.get('highlightKeywords', true),
  };
}

function render(model, overrides) {
  return renderSvg(model, { ...settings(), ...(overrides || {}) });
}

module.exports = { webviewHtml, settings, render, diagramTheme, editorTheme };
