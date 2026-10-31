// “传变量即带写权限”给普通 prop 带来的成本：三层按钮、表单字段，开关前后对比。node 17-bind/bench-forward.mjs [--rounds=7]
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { heapAfterGc, launch, median, openPage } from '../lib/browser.mjs';
import { compile } from '../03-publish/packages/compiler/index.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const rounds = Number(process.argv.find((arg) => arg.startsWith('--rounds='))?.slice(9) ?? 7);
const hiltPath = here('./hilt.ts').replaceAll('\\', '/');
const SOURCE = `import { flushSync, mount } from '@hilt/runtime';
const Base = _component(({ title, id, label, children, ...rest }) => <button class="base" id={id} title={title} aria-label={label} {...rest}>{children}</button>);
const Mid = _component(({ title, id, label, children, ...rest }) => <Base title={title} id={id} label={label} {...rest}>{children}</Base>);
const Top = _component(({ title, id, label, children }) => <Mid title={title} id={id} label={label}>{children}</Mid>);
const Row = _component(({ index }) => {
  let title = _state('a');
  let label = _state('b');
  (window.setters ??= []).push(() => (title = title + '!'));
  return <Top title={title} id={String(index)} label={label}>保存</Top>;
});
const App = _component(() => <div>{window.ids.map((item) => <Row index={item.i} />)}</div>);
window.flushSync = flushSync;
window.run = () => mount(() => <App />, document.body);
`;
async function bundle(options) {
  const compiled = await compile(SOURCE, here('./bench-case.tsx'), options);
  const result = await build({
    stdin: { contents: compiled.code, resolveDir: here('.'), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
    alias: { '@hilt/runtime': here('../03-publish/packages/runtime/index.js') },
  });
  return result.outputFiles[0].text;
}
const VARIANTS = [
  ['只读 getter', await bundle({})],
  ['带写权限', await bundle({ twoWayFrom: hiltPath, autoBind: true })],
];
const browser = await launch();
const samples = {};
for (let round = 0; round < rounds; round++) {
  for (const [label, code] of round % 2 ? [...VARIANTS].reverse() : VARIANTS) {
    const page = await openPage(browser, code);
    await page.evaluate(() => (window.ids = Array.from({ length: 10000 }, (_, i) => ({ i }))));
    const base = await heapAfterGc(page);
    const create = await page.evaluate(() => {
      const start = performance.now();
      window.run();
      window.flushSync();
      return performance.now() - start;
    });
    const heap = (await heapAfterGc(page)) - base;
    const row = (samples[label] ??= { create: [], heap: [] });
    row.create.push(create);
    row.heap.push(heap);
    await page.close();
  }
}
console.log('| 三层转交 3 个 prop，1 万行 | 创建 ms | 每行 KB |\n| --- | --- | --- |');
for (const [label] of VARIANTS) console.log(`| ${label} | ${median(samples[label].create).toFixed(1)} | ${(median(samples[label].heap) / 1024 / 10000).toFixed(2)} |`);
await browser.close();
void dirname, readFile;
