const fs = require('fs'), path = require('path');
const { parseCode, supportedLanguage } = require('../src/core/parsers');
const { rootToNsd } = require('../src/core/nsdxml');
const { parseSignature } = require('../src/core/pseudo');
const [src, dir] = process.argv.slice(2);
const doc = parseCode(fs.readFileSync(src, 'utf8'), supportedLanguage('', src), { name: path.basename(src).replace(/\..*/, '') });
for (const r of doc.roots) { const n = parseSignature(r.text).name; fs.writeFileSync(path.join(dir, n + '.nsd'), rootToNsd(r)); console.log(n, r.rootType); }
