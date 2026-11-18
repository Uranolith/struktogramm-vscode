const fs = require('fs'); const path = require('path');
const { fromNsd } = require('../src/core/nsdxml');
const { generateCode } = require('../src/core/generators');
const dir = process.argv[2];
const roots = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.nsd'))) { const d = fromNsd(fs.readFileSync(path.join(dir, f), 'utf8')); roots.push(...d.roots); console.log(f, d.roots.map(r => r.rootType + ':' + r.text.join('|'))); }
const isUnknown = JSON.stringify(roots).includes('unbekanntes Element');
console.log('unknown elements:', isUnknown);
console.log(generateCode({ roots: roots.filter(r => r.rootType !== 'includable') }, 'python'));
