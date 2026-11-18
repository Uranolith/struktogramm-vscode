const fs = require('fs');
const { ExecController } = require('../src/execSession');
const { parseCode } = require('../src/core/parsers');
const model = parseCode(fs.readFileSync(__dirname + '/samples/rechner.py', 'utf8'), 'python', { name: 'rechner' });
const log = [];
let ctl;
const webview = { postMessage: (m) => {
  if (m.type === 'execOut') m.lines.forEach((l) => log.push(`[${l.kind}] ${l.text}`));
  if (m.type === 'execState') {
    log.push(`state=${m.state} path=${m.path}` + (m.prompt ? ` prompt=${m.prompt}` : '') + (m.state === 'paused' ? ' vars=' + JSON.stringify(m.frames[m.frames.length - 1].vars.map(v => v.name + '=' + v.value)) : ''));
    if (m.state === 'input') setTimeout(() => ctl.handle({ type: 'execInput', value: '7' }), 10);
    if (m.state === 'paused' && !global.stepped) { global.stepped = 1; setTimeout(() => ctl.handle({ type: 'exec', cmd: 'step' }), 10); }
    else if (m.state === 'paused') setTimeout(() => ctl.handle({ type: 'exec', cmd: 'run', delay: 0 }), 10);
    if (m.state === 'done') { console.log(log.join('\n')); }
  }
} };
ctl = new ExecController(webview, () => model);
ctl.handle({ type: 'exec', cmd: 'run', delay: 0, breakpoints: ['roots/0/children/3'] });
