// 调试钩子的开销：node 18-plain/devtools/cost.mjs [--rounds=15]。各版本交替跑，串行。
//   无钩子：构建时删掉所有 devHooks 判断，代表没加钩子之前
//   钩子未装：生产产物的样子，只多判断
//   已装 / 录制中：开发期
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { heapAfterGc, launch, median } from '../../lib/browser.mjs';
import { bundle } from '../bundle.mjs';

const rounds = Number(process.argv.find((item) => item.startsWith('--rounds='))?.slice(9) ?? 15);
const stripHooks = {
  name: 'strip-dev-hooks',
  setup(b) {
    b.onLoad({ filter: /[\\/](reactive\.js|state\.js|index\.ts)$/ }, async ({ path }) => {
      if (path.endsWith('.ts') && !path.includes('hilt')) return undefined;
      const text = (await readFile(path, 'utf8'))
        .replace(/^[^\n]*devHooks\?\.[^\n]*\n/gm, '')
        .replace(/^\s*if \(devHooks && [^\n]*\n/gm, '')
        .replace(/if \(devHooks\) devHooks\.component\([^\n]*\n\s*else (mountComponent\([^\n]*\n)/, '$1')
        .replace(/\(devHooks \? devHooks\.app\(host, \(\) => renderValue\(view\(\), host, null\)\) : (renderValue\(view\(\), host, null\))\)/g, '$1');
      if (text.includes('devHooks?.') || text.includes('devHooks.')) throw new Error(`还有钩子没删：${path}`);
      return { contents: text, loader: path.endsWith('.ts') ? 'ts' : 'js' };
    });
  },
};
const body = `import { sig } from 'hilt';
import './vue-compare/rows';
window.writes = () => { const s = sig.raw(0); for (let i = 1; i <= 1000000; i++) s.set(i); };`;
const VARIANTS = [
  ['无钩子', await bundle(body, { minify: true, plugins: [stripHooks] })],
  ['钩子未装', await bundle(body, { minify: true })],
  ['已装', await bundle(`import 'hilt/devtools';\n${body}`, { minify: true, jsxDev: true })],
  ['录制中', await bundle(`import 'hilt/devtools';\n${body}\nwindow.__HILT_DEVTOOLS__.call('record', { action: 'start' });`, { minify: true, jsxDev: true })],
];
const browser = await launch();
const samples = Object.fromEntries(VARIANTS.map(([name]) => [name, { create: [], update: [], writes: [], heap: [] }]));
for (let round = 0; round < rounds; round++) {
  for (const [name, code] of round % 2 ? [...VARIANTS].reverse() : VARIANTS) {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: code });
    const timed = (action) =>
      page.evaluate(async (run) => {
        const start = performance.now();
        await new Function(`return ${run}`)();
        return performance.now() - start;
      }, action);
    for (let i = 0; i < 3; i++) {
      await timed('window.bench.create(1000)');
      await timed('window.bench.clear()');
    }
    const row = samples[name];
    const base = await heapAfterGc(page);
    row.create.push(await timed('window.bench.create(10000)'));
    row.heap.push(((await heapAfterGc(page)) - base) / 1024);
    row.update.push(await timed('window.bench.update()'));
    await timed('window.bench.clear()');
    row.writes.push(await timed('window.writes()'));
    await page.close();
  }
}
await browser.close();
console.log(`## 调试钩子开销（Chromium，${rounds} 轮中位数，脚本耗时）\n`);
console.log('| 版本 | 建 1 万行 ms | 每 10 行更新 ms | 100 万次写入 ms | 建 1 万行堆 KB | gzip KB |\n| --- | --- | --- | --- | --- | --- |');
for (const [name, code] of VARIANTS) {
  const row = samples[name];
  console.log(`| ${name} | ${median(row.create).toFixed(0)} | ${median(row.update).toFixed(1)} | ${median(row.writes).toFixed(1)} | ${median(row.heap).toFixed(0)} | ${(gzipSync(code).length / 1024).toFixed(2)} |`);
}
