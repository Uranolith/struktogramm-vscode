const fs = require('fs');
const { parseCode } = require('../src/core/parsers');
const { toNsd, fromNsd } = require('../src/core/nsdxml');
const { renderSvg } = require('../src/core/render');
const { generateCode } = require('../src/core/generators');
const E = require('../src/core/edit');
const doc = parseCode(fs.readFileSync('test/samples/rechner.py', 'utf8'), 'python', { name: 'rechner' });
const xml = toNsd(doc);
const back = fromNsd(xml);
const strip = (d) => JSON.stringify(d.roots.map(r => ({...r, meta: undefined})));
console.log('XML roundtrip identical:', strip(back) === strip(doc));
fs.writeFileSync('test/out_rechner.nsd', xml);
const single = { roots: [doc.roots[1]] };
console.log(toNsd(single).slice(0, 600));
const { svg, width, height } = renderSvg(doc, {});
fs.writeFileSync('test/out_rechner.svg', svg);
console.log('svg', width, height, svg.length);
// Edit ops
let p = E.apply(back, { op: 'insert', path: 'roots/0/children/0', kind: 'while' });
console.log('inserted at', p);
p = E.apply(back, { op: 'insert', path: p + '/body/#', kind: 'instruction' });
console.log('inserted at', p, JSON.stringify(E.get(back, 'roots/0/children/1')));
p = E.apply(back, { op: 'update', path: p, text: 'x <- x + 1' });
p = E.apply(back, { op: 'move', path: 'roots/0/children/1', dir: -1 });
console.log('moved to', p);
p = E.apply(back, { op: 'delete', path: p });
console.log('after delete', p, back.roots[0].children.length);
const caseEl = back.roots[0].children.find(e => e.type === 'case');
const cp = 'roots/0/children/' + back.roots[0].children.indexOf(caseEl);
E.apply(back, { op: 'update', path: cp, text: ['zahl', '0', '1, 2', '3', 'default'] });
console.log(JSON.stringify(caseEl.branches.map(b => b.length)));
E.apply(back, { op: 'update', path: cp, text: ['zahl', '0', 'default'] });
console.log(JSON.stringify(caseEl.branches.map(b => b.length)), caseEl.text);
// Structorizer-Datei lesen (Format-Probe)
const sample = `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns:nsd="https://structorizer.fisch.lu" version="3.30" text="&#34;Test&#34;" comment="" color="ffffff" type="program" style="nice">
  <children>
    <instruction text="&#34;INPUT x&#34;" comment="" color="ffffff" rotated="0" disabled="0"></instruction>
    <alternative text="&#34;(x &#62; 3)&#34;" comment="" color="ffffff" disabled="0">
      <qTrue><instruction text="&#34;OUTPUT &#34;&#34;groß&#34;&#34;&#34;" comment="" color="80ff80" rotated="0" disabled="0"></instruction></qTrue>
      <qFalse color="ffffff"></qFalse>
    </alternative>
    <for text="&#34;for i &#60;- 1 to x&#34;" comment="&#34;Zähler&#34;" counterVar="i" startValue="1" endValue="x" stepConst="1" style="COUNTER" color="ffffff" disabled="0"><qFor><instruction text="&#34;s &#60;- s + i&#34;,&#34;t &#60;- 2&#34;" comment="" color="ffffff" rotated="0" disabled="0"></instruction></qFor></for>
    <case text="&#34;x&#34;,&#34;1&#34;,&#34;2&#34;,&#34;%&#34;" comment="" color="ffffff" disabled="0"><qCase></qCase><qCase></qCase><qCase></qCase></case>
  </children>
</root>`;
const sd = fromNsd(sample);
console.log(JSON.stringify(sd.roots[0].children));
console.log(generateCode(sd, 'python'));
