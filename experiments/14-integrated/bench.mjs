// 合并前后对比：node 14-integrated/bench.mjs [--rounds=7]
// 同一份 bench-app.tsx，分别用 packages-v0（alien-signals + 简化深代理）和 packages（合并版）编译、运行。每轮一个新页面。
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { heapAfterGc, launch, median, openPage } from '../lib/browser.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const rounds = Number(process.argv.find((arg) => arg.startsWith('--rounds='))?.slice(9) ?? 7);

async function bundleVersion(packages) {
  const { compile } = await import(`../03-publish/${packages}/compiler/index.mjs`);
  const result = await build({
    entryPoints: [here('./bench-app.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
    alias: { '@hilt/runtime': here(`../03-publish/${packages}/runtime/index.js`) },
    plugins: [
      {
        name: 'hilt',
        setup(b) {
          b.onLoad({ filter: /bench-app\.tsx$/ }, async ({ path }) => ({
            contents: (await compile(await readFile(path, 'utf8'), path)).code,
            loader: 'js',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

const VERSIONS = [
  ['旧原型', await bundleVersion('packages-v0')],
  ['合并版', await bundleVersion('packages')],
];
const browser = await launch();

/** 一轮：新页面，prepare 不计时，每个 step 计时（含 flush）；可选量堆 */
async function round(code, plan) {
  const page = await openPage(browser, code);
  const out = {};
  const base = plan.heap ? await heapAfterGc(page) : 0;
  for (const [label, step] of plan.steps) {
    out[label] = await page.evaluate(step.fn, step.arg);
    if (plan.heap === label) out[`${label} 堆 KB`] = Math.round(((await heapAfterGc(page)) - base) / 1024);
  }
  await page.close();
  return out;
}
const timed = (body) => `(() => { const start = performance.now(); ${body}; window.benchApi.flushSync(); return performance.now() - start; })()`;
const step = (body) => ({ fn: timed(body) });

const PLANS = [
  {
    title: '三层按钮 10000 个（每个 1 个响应式 title、class 跨层拼接、1 个事件）',
    heap: '创建',
    steps: [
      ['创建', step('window.benchApi.mountButtons(10000)')],
      ['改 title（全部更新）', step("window.setTitle('b')")],
    ],
  },
  {
    title: '表单字段 5000 个（条件内容、内容类 prop）',
    heap: '创建',
    steps: [
      ['创建', step('window.benchApi.mountFields(5000)')],
      ['改 invalid（全部更新）', step('window.setInvalid(true)')],
    ],
  },
  {
    title: '行列表 1000 行（深代理）',
    steps: [
      ['挂载', step('window.benchApi.mountRows()')],
      ['创建 1000 行', step('window.rowsApi.create(1000)')],
      ['每 10 行改文字', step('window.rowsApi.updateEvery(10)')],
      ['选中一行', step('window.rowsApi.selectRow(5)')],
      ['交换两行', step('window.rowsApi.swap()')],
      ['删一行', step('window.rowsApi.removeOne()')],
      ['清空', step('window.rowsApi.clear()')],
      ['再建 10000 行', step('window.rowsApi.create(10000)')],
      ['每 10 行改文字（一万行）', step('window.rowsApi.updateEvery(10)')],
    ],
  },
  {
    title: '嵌套 100 层改叶子文字 1000 次',
    steps: [
      ['创建', step('window.benchApi.mountDeep(100)')],
      ['改叶子 1000 次', step('for (let i = 1; i <= 1000; i++) { window.setDeep(i); window.benchApi.flushSync(); }')],
    ],
  },
];

const results = [];
for (const [name, code] of VERSIONS) results.push(`${name}：${(code.length / 1024).toFixed(1)} KB，gzip ${(gzipSync(code).length / 1024).toFixed(1)} KB`);
console.log(results.join('；'));

for (const plan of PLANS) {
  const samples = {};
  for (const [name] of VERSIONS) samples[name] = {};
  for (let r = 0; r < rounds; r++) {
    // 交替跑，抵消先后顺序的影响
    for (const [name, code] of r % 2 ? [...VERSIONS].reverse() : VERSIONS) {
      const out = await round(code, plan);
      for (const label in out) (samples[name][label] ??= []).push(out[label]);
    }
  }
  console.log(`\n### ${plan.title}\n`);
  console.log('| 操作 | 旧原型 | 合并版 | 合并版/旧 |');
  console.log('| --- | --- | --- | --- |');
  for (const label of Object.keys(samples['合并版'])) {
    const before = median(samples['旧原型'][label] ?? [NaN]);
    const after = median(samples['合并版'][label]);
    console.log(`| ${label} | ${before.toFixed(1)} | ${after.toFixed(1)} | ${(after / before).toFixed(2)} |`);
  }
}
await browser.close();
