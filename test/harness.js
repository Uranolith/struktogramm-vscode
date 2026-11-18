// Erzeugt eine HTML-Datei, die das Webview im Browser nachstellt (für Bildschirmtests)
const fs = require('fs');
const { parseCode } = require('../src/core/parsers');
const { renderSvg } = require('../src/core/render');
const doc = parseCode(fs.readFileSync(__dirname + '/samples/Rechner.java', 'utf8'), 'java');
const { svg } = renderSvg(doc, {});
const css = fs.readFileSync(__dirname + '/../media/editor.css', 'utf8');
const js = fs.readFileSync(__dirname + '/../media/editor.js', 'utf8');
const wv = fs.readFileSync(__dirname + '/../src/webview.js', 'utf8');
const body = wv.slice(wv.indexOf('<body'), wv.indexOf('<script nonce')).replace(/<body[^>]*>/, '');
const mode = process.argv[3] || 'exec';
const msgs = mode === 'exec' ? [
  { type: 'execReset', title: 'Rechner' },
  { type: 'execOut', lines: [{ text: '7', kind: 'in' }, { text: 'Summe: 28', kind: 'out' }, { text: '● Haltepunkt erreicht.', kind: 'info' }] },
  { type: 'execState', state: 'paused', path: 'roots/0/children/4', frames: [{ name: 'Rechner', vars: [{ name: 'n', value: '7', type: 'int' }, { name: 'summe', value: '28', type: 'int' }, { name: 'a', value: '{1, 2, 3}', type: 'int[]' }] }] },
] : [{ type: 'update', doc, svg, select: 'roots/0/children/4', editNew: true }];
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>:root{--vscode-editor-background:#1f1f1f;--vscode-foreground:#ccc;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-font-family:Segoe UI;--vscode-font-size:13px}${css}</style></head>
<body data-readonly="0">${body}
<script>window.acquireVsCodeApi=()=>({postMessage:m=>console.log(JSON.stringify(m)),getState:()=>({bps:['roots/0/children/6']}),setState:()=>{}});</script>
<script>${js}</script>
<script>window.postMessage(${JSON.stringify({ type: 'update', doc, svg, settings: {}, select: 'roots/0/children/2' })},'*');
setTimeout(()=>{ for (const m of ${JSON.stringify(msgs)}) window.postMessage(m,'*'); },200);</script></body></html>`;
fs.writeFileSync(process.argv[2], html);
