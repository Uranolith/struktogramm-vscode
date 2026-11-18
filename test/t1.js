const P = require('../src/core/pseudo');
const { parseCode } = require('../src/core/parsers');
for (const l of ['java','c','javascript','pascal','python']) console.log(l, '|', P.translateExpr('int(sqrt(n)) + 1', l, {}), '|', P.translateExpr('not x > 3 and y = 2', l, {}));
const d = parseCode('int main(){ int a = (int) sqrt(x) + (double)(a+b); if (!(a == b) || !c) a++; }', 'c');
console.log(JSON.stringify(d.roots[0].children.map(e=>e.text)));
