const Module = require('module');
const orig = Module._load;
const handler = { get: (t, k) => (k in t ? t[k] : new Proxy(function () {}, handler)), apply: () => new Proxy(function () {}, handler) };
Module._load = function (req, ...a) { if (req === 'vscode') return new Proxy({}, handler); return orig.call(this, req, ...a); };
const ext = require('../src/extension.js');
console.log('extension exports:', Object.keys(ext));
new Function(require('fs').readFileSync(__dirname + '/../media/editor.js', 'utf8'));
console.log('editor.js syntax ok');
