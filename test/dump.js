const fs = require('fs');
const path = require('path');
const { parseCode, supportedLanguage } = require('../src/core/parsers');
const { generateCode } = require('../src/core/generators');
const file = process.argv[2];
const lang = supportedLanguage('', file);
const doc = parseCode(fs.readFileSync(file, 'utf8'), lang, { name: path.basename(file).replace(/\..*$/, '') });
function show(seq, ind) {
  for (const el of seq) {
    console.log(ind + el.type + ': ' + JSON.stringify(el.text) + (el.comment ? ' //' + el.comment.join('|') : ''));
    for (const k of ['qTrue', 'qFalse', 'body', 'children']) if (el[k]) { console.log(ind + '  [' + k + ']'); show(el[k], ind + '    '); }
    if (el.branches) el.branches.forEach((b, i) => { console.log(ind + '  [branch ' + i + ']'); show(b, ind + '    '); });
  }
}
for (const r of doc.roots) { console.log('=== ROOT', r.rootType, JSON.stringify(r.text)); show(r.children, '  '); }
for (const t of (process.argv[3] || '').split(',').filter(Boolean)) { console.log('\n##### ' + t); console.log(generateCode(doc, t, {})); }
