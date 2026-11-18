const Module = require('module'); const fs = require('fs'); const path = require('path');
const SPD = process.argv[2];
const vs = {
  workspace: { getConfiguration: () => ({ get: (k) => (k === 'jarPath' ? path.join(SPD, 'x/Structorizer') : undefined), update: async () => {} }) },
  window: { withProgress: (o, fn) => fn({ report: () => {} }), createOutputChannel: () => ({ appendLine: () => {} }), showErrorMessage: console.error, showInformationMessage: async () => null },
  ProgressLocation: {}, ConfigurationTarget: {}, Uri: { parse: (x) => x }, env: {}, commands: {},
};
const orig = Module._load; Module._load = function (r, ...a) { return r === 'vscode' ? vs : orig.call(this, r, ...a); };
const S = require('../src/structorizer');
const { parseCode } = require('../src/core/parsers');
const ctx = { globalStorageUri: { fsPath: path.join(SPD, 'gs') } };
(async () => {
  const z = fs.readFileSync(path.join(SPD, 's.zip'));
  console.log('unzip jar bytes:', S.unzipEntry(z, 'Structorizer.jar').length, 'orig', fs.statSync(path.join(SPD, 'x/Structorizer/Structorizer.app/Contents/Java/Structorizer.jar')).size);
  const doc = parseCode(fs.readFileSync('test/samples/rechner.py', 'utf8'), 'python', { name: 'rechner' });
  console.log(await S.exportCode(ctx, doc, 'Python'));
  console.log((await S.exportCode(ctx, { roots: [doc.roots[1]] }, 'Pascal')));
  const imp = await S.importCode(ctx, fs.readFileSync('test/samples/prog.c', 'utf8'), 'prog.c');
  console.log(imp.roots.map((r) => r.rootType + ' ' + r.text.join('|') + ' #' + r.children.length));
  const pas = `program Test;\nvar i, s: integer;\nbegin\n  s := 0;\n  for i := 1 to 10 do\n    s := s + i;\n  if s > 50 then writeln('groß') else writeln('klein');\nend.\n`;
  const ip = await S.importCode(ctx, pas, 'test.pas');
  console.log(JSON.stringify(ip.roots[0].children.map(e => [e.type, e.text])));
})().catch((e) => console.error('FEHLER', e));
