// Regressionstest: jedes Beispiel -> Struktogramm -> .nsd -> zurück -> jede Zielsprache
const fs = require('fs');
const path = require('path');
const { parseCode, supportedLanguage } = require('../src/core/parsers');
const { generateCode, TARGETS } = require('../src/core/generators');
const { toNsd, fromNsd } = require('../src/core/nsdxml');
const { renderSvg } = require('../src/core/render');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
let fail = 0;
for (const f of fs.readdirSync(path.join(__dirname, 'samples'))) {
  const lang = supportedLanguage('', f);
  if (!lang) continue;
  const base = f.replace(/\..*$/, '');
  try {
    const doc = fromNsd(toNsd(parseCode(fs.readFileSync(path.join(__dirname, 'samples', f), 'utf8'), lang, { name: base })));
    renderSvg(doc);
    for (const t of Object.keys(TARGETS)) {
      const code = generateCode(doc, t, { className: base.charAt(0).toUpperCase() + base.slice(1) });
      fs.writeFileSync(path.join(outDir, `${base}_${lang}.${TARGETS[t].ext}`), code);
    }
    console.log('ok  ', f);
  } catch (e) { fail++; console.log('FAIL', f, e.stack); }
}
process.exit(fail ? 1 : 0);
