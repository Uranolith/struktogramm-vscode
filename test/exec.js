// Führt Struktogramme ohne Oberfläche aus: Eingaben aus Liste, Ausgabe auf Konsole
const fs = require('fs'); const path = require('path');
const { Interpreter, ExecError } = require('../src/core/executor');
const { parseCode, supportedLanguage } = require('../src/core/parsers');
function runDoc(doc, inputs, label) {
  const it = new Interpreter(doc);
  const idx = Math.max(0, doc.roots.findIndex((r) => r.rootType === 'program'));
  const g = it.run(idx);
  let r = g.next(), steps = 0; const out = [];
  try {
    while (!r.done) {
      const y = r.value; let send;
      if (y.type === 'step') steps++;
      if (y.type === 'output') out.push(y.text);
      if (y.type === 'input') { send = inputs.shift(); out.push(`[${y.prompt}] ${send}`); }
      if (steps > 200000) throw new Error('zu viele Schritte');
      r = g.next(send);
    }
  } catch (e) {
    if (e && e.kind === 'exit') out.push('(exit ' + e.value + ')');
    else out.push('FEHLER: ' + e.message + (e.path ? ' @' + e.path : ''));
  }
  console.log(`--- ${label} (${steps} Schritte)\n` + out.join('\n'));
}
for (const f of ['rechner.py', 'Rechner.java', 'prog.c', 'app.js']) {
  const src = fs.readFileSync(path.join(__dirname, 'samples', f), 'utf8');
  runDoc(parseCode(src, supportedLanguage('', f), { name: f }), ['7'], f);
}
const { fromNsd } = require('../src/core/nsdxml');
runDoc(fromNsd(fs.readFileSync(path.join(__dirname, 'out_rechner.nsd'), 'utf8')), ['13'], 'out_rechner.nsd (13)');
// Sonderfälle
const { mk } = require('../src/core/model');
runDoc({ roots: [mk.root('T', 'program', [
  mk.instruction(['int a[5]', 'x <- 7.0 / 2', 'y <- 7 / 2', 's <- "Wert: " + y', 'b <- {3, 1, 2}', 'b[1] <- 9']),
  mk.for('for i <- 0 to 4', [mk.instruction('a[i] <- i * i')]),
  mk.instruction(['OUTPUT a, " ", x, " ", y, " ", s, " ", b, " ", length(b), " ", not 3 > 4 and true']),
  mk.case('a[2]', ['1, 2', '4', 'default'], [[mk.instruction('OUTPUT "klein"')], [mk.instruction('OUTPUT "vier"')], [mk.instruction('OUTPUT "sonst"')]]),
  mk.instruction('OUTPUT fak(10), " ", 10 div 3, " ", 10 mod 3, " ", sqrt(16)'),
  mk.instruction('z <- 1 / 0'),
]), mk.root('fak(n: int): int', 'sub', [mk.alternative('n <= 1', [mk.jump('return 1')], [mk.jump('return n * fak(n - 1)')])])] }, [], 'Sonderfälle');
