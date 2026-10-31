// 运行时体积：不同用法各带上多少，按模块拆开。node 14-integrated/size.mjs
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const VARIANTS = [
  ['计数器（signal、模板、文本、事件）', `import { template, insert, on, signal, mount } from '@hilt/runtime'; const t = template('<button></button>'); const n = signal(0); mount(() => { const el = t(); on(el, 'click', () => n.value++); insert(el, () => n.value); return el; }, document.body);`],
  ['+ 属性写入（attrStr、setClass）', `import { template, insert, on, signal, mount, attrStr, setClass, renderEffect } from '@hilt/runtime'; const t = template('<button></button>'); const n = signal(0); mount(() => { const el = t(); renderEffect(() => { attrStr(el, 'title', n.value); setClass(el, n.value); }); on(el, 'click', () => n.value++); insert(el, () => n.value); return el; }, document.body);`],
  ['+ spread / merge', `import { template, insert, signal, mount, spread, merge } from '@hilt/runtime'; const t = template('<button></button>'); const n = signal(0); mount(() => { const el = t(); spread(el, merge({ class: 'a' }, { get title() { return n.value; } })); insert(el, () => n.value); return el; }, document.body);`],
  ['+ 列表', `import { template, signal, mount, component, For, insert } from '@hilt/runtime'; const t = template('<ul></ul>'); const n = signal([]); mount(() => { const el = t(); insert(el, () => component(For, { get each() { return n.value; }, children: (x) => x })); return el; }, document.body);`],
  ['+ 深代理', `import { template, insert, mount, state } from '@hilt/runtime'; const t = template('<p></p>'); const s = state({ a: 1 }); mount(() => { const el = t(); insert(el, () => s.a); return el; }, document.body);`],
  ['+ 水合', `import { template, insert, signal, hydrate, first } from '@hilt/runtime'; const t = template('<p></p>'); const n = signal(0); hydrate(() => { const el = t(); first(el); insert(el, () => n.value); return el; }, document.body);`],
  ['+ 懒加载', `import { template, mount, lazy, component } from '@hilt/runtime'; const L = lazy(() => import('data:text/javascript,export default 1')); mount(() => component(L, {}), document.body);`],
];
const rows = [];
let detail;
for (const [label, contents] of VARIANTS) {
  const result = await build({
    stdin: { contents, resolveDir: here('.'), loader: 'js' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
    metafile: true,
    external: ['data:*'],
    alias: { '@hilt/runtime': here('../03-publish/packages/runtime/index.js') },
  });
  const code = result.outputFiles[0].text;
  rows.push([label, code.length, gzipSync(code, { level: 9 }).length]);
  const inputs = Object.values(result.metafile.outputs)[0].inputs;
  detail = Object.entries(inputs).map(([file, info]) => `${file.split('/').slice(-1)[0]} ${info.bytesInOutput}`);
  console.log(`${label}：${detail.join('，')}`);
}
console.log('\n| 用法 | minify | gzip |\n| --- | --- | --- |');
for (const row of rows) console.log(`| ${row.join(' | ')} |`);
