const { fromNsd } = require('../src/core/nsdxml');
const { generateCode } = require('../src/core/generators');
const x = `<root text="&#34;Test&#34;" type="program"><children>
<instruction text="&#34;INPUT &#34;&#34;Zahl: &#34;&#34;, x&#34;"/>
<instruction text="&#34;INPUT name&#34;"/>
<alternative text="&#34;x &#62; 3&#34;"><qTrue><instruction text="&#34;OUTPUT &#34;&#34;Hallo &#34;&#34;, name&#34;"/></qTrue><qFalse/></alternative>
<for text="&#34;for i &#60;- 1 to x&#34;"><qFor><instruction text="&#34;s &#60;- s + i / 2&#34;"/></qFor></for>
</children></root>`;
const d = fromNsd(x);
for (const l of ['python', 'java', 'c']) console.log(generateCode(d, l));
