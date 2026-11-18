const fs = require('fs');
const { parseCode } = require('../src/core/parsers');
const { toNsd } = require('../src/core/nsdxml');
const doc = parseCode(fs.readFileSync(__dirname + '/samples/rechner.py', 'utf8'), 'python', { name: 'rechner' });
fs.writeFileSync(__dirname + '/samples/rechner.nsd', toNsd(doc));
console.log('ok', doc.roots.length, 'Diagramme');
