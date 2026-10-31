// node 05-compare/rows/run.mjs [--rounds=7] [--only=solid,svelte]
// krausest 式列表基准：每个框架每轮一个全新页面，各操作量一次，多轮取中位数。
// 计时 = 调用动作（含框架的异步刷新）+ 强制布局；操作后校验 DOM 结果，不对就报错。
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { bundle, heapAfterGc, launch, median, openPage } from '../../lib/browser.mjs';
import { buildOptions } from '../lib/esbuild-plugin.mjs';
import { hiltBuild, hiltEntry } from '../../03-publish/rows/build.mjs';
import { ALIAS } from '../../18-plain/bundle.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** 框架列表。entry 是入口源码，必须设置 window.bench；build 是可选的 esbuild 选项（插件/别名）。 */
const FRAMEWORKS = [
  { name: 'hilt-plain', entry: here('../../18-plain/vue-compare/rows.tsx'), build: { jsx: 'automatic', jsxImportSource: 'hilt', alias: ALIAS } },
  { name: 'hilt-plain-deep', entry: here('../../18-plain/vue-compare/rows-deep.tsx'), build: { jsx: 'automatic', jsxImportSource: 'hilt', alias: ALIAS } },
  { name: 'hilt-runes', entry: hiltEntry, build: hiltBuild },
  { name: 'solid', entry: here('./solid/entry.jsx'), build: buildOptions('solid') },
  { name: 'svelte5', entry: here('./svelte/entry.js'), build: buildOptions('svelte') },
  { name: 'vue36-vapor', entry: here('./vue/entry-vapor.js'), build: buildOptions('vapor36') },
  { name: 'vue35-vdom', entry: here('./vue/entry-vdom35.js'), build: buildOptions('vdom35') },
];

const arg = (key, fallback) => process.argv.find((a) => a.startsWith(`--${key}=`))?.split('=')[1] ?? fallback;
const ROUNDS = +arg('rounds', 7);
const only = arg('only', '')?.split(',').filter(Boolean);
const frameworks = only.length ? FRAMEWORKS.filter((f) => only.includes(f.name)) : FRAMEWORKS;

// 每步：[结果名, 动作, 参数, 校验函数(snapshot, before) -> 错误信息|undefined]
const STEPS = [
  ['create 1000', 'create', [1000], (s) => s.count !== 1000 && `行数 ${s.count}`],
  ['replace 1000', 'replace', [1000], (s, b) => (s.count !== 1000 || s.ids[0] === b.ids[0]) && `行数 ${s.count}，首行 id 未变`],
  ['update every 10th', 'update', [], (s) => !s.suffix.every((x, i) => x === (i % 10 === 0)) && '每 10 行追加 !!! 的结果不对'],
  ['select row', 'select', [5], (s) => (s.danger.join() !== '5') && `选中行 ${s.danger}`],
  ['swap rows', 'swap', [], (s, b) => (s.ids[1] !== b.ids[998] || s.ids[998] !== b.ids[1] || s.count !== 1000) && '交换结果不对'],
  ['remove row', 'remove', [5], (s, b) => (s.count !== 999 || s.ids.includes(b.ids[5])) && `删除结果不对，行数 ${s.count}`],
  ['clear', 'clear', [], (s) => s.count !== 0 && `行数 ${s.count}`],
  ['create 10000', 'create', [10000], (s) => s.count !== 10000 && `行数 ${s.count}`],
];

/** 页面里的快照：行数、id、选中行下标、每行 label 是否带 !!! 后缀 */
const snapshot = (page) =>
  page.evaluate(() => {
    const trs = [...document.querySelectorAll('tbody > tr')];
    const checkSample = trs.length === 1000 || trs.length === 999;
    return {
      count: trs.length,
      ids: trs.map((tr) => tr.children[0].textContent),
      danger: trs.flatMap((tr, i) => (tr.classList.contains('danger') ? [i] : [])),
      suffix: checkSample ? trs.map((tr) => tr.children[1].textContent.endsWith(' !!!')) : [],
      rowHtml: trs[0]?.outerHTML.replace(/\s+/g, ' ').slice(0, 200),
    };
  });

/** 在页面里量一次：动作 + 异步刷新 + 强制布局，返回 [总耗时, 脚本耗时] */
const measure = (page, action, args) =>
  page.evaluate(
    async ([a, argv]) => {
      const t0 = performance.now();
      await window.bench[a](...argv);
      const t1 = performance.now();
      document.body.getBoundingClientRect();
      document.querySelector('tbody').offsetHeight; // 强制布局
      return [performance.now() - t0, t1 - t0];
    },
    [action, args],
  );

const results = {};
const browser = await launch();
for (const { name, entry, build } of frameworks) {
  const code = await bundle(entry, build);
  const gzip = gzipSync(code, { level: 9 }).length;
  results[name] = { bytes: Buffer.byteLength(code), gzip, ms: {}, scriptMs: {}, errors: [] };

  const samples = Object.fromEntries(STEPS.map(([label]) => [label, []]));
  const script = Object.fromEntries(STEPS.map(([label]) => [label, []]));
  for (let round = 0; round < ROUNDS; round++) {
    const page = await openPage(browser, code);
    // 预热：同一页面把全部动作跑一遍，让 JIT 和框架的惰性初始化先发生
    for (const [, action, args] of STEPS.slice(0, 7)) await measure(page, action, args);
    await measure(page, 'clear', []);
    for (const [label, action, args, check] of STEPS) {
      const before = await snapshot(page);
      const [total, scriptOnly] = await measure(page, action, args);
      samples[label].push(total);
      script[label].push(scriptOnly);
      const after = await snapshot(page);
      const problem = check(after, before);
      if (problem && round === 0) results[name].errors.push(`${label}: ${problem}`);
      if (round === 0 && label === 'create 1000') results[name].rowHtml = after.rowHtml;
    }
    await page.close();
  }
  for (const [label] of STEPS) {
    results[name].ms[label] = +median(samples[label]).toFixed(2);
    results[name].scriptMs[label] = +median(script[label]).toFixed(2);
  }

  // 堆：全新页面，空页面 GC 后量一次，建 10000 行后再量
  const page = await openPage(browser, code);
  const empty = await heapAfterGc(page);
  await measure(page, 'create', [10000]);
  const used = await heapAfterGc(page);
  results[name].heapKB = Math.round((used - empty) / 1024);
  await page.close();
}
await browser.close();

const names = Object.keys(results);
const table = (title, rows) => {
  console.log(`\n== ${title} ==`);
  console.log(['', ...names].join(' | '));
  for (const [label, get] of rows) console.log([label, ...names.map((n) => get(results[n], label))].join(' | '));
};
table(`耗时 ms（中位数，${ROUNDS} 轮，含强制布局）`, STEPS.map(([label]) => [label, (r) => r.ms[label]]));
table('其中脚本耗时 ms（不含强制布局）', STEPS.map(([label]) => [label, (r) => r.scriptMs[label]]));
table('体积与内存', [
  ['bundle minified bytes', (r) => r.bytes],
  ['bundle gzip bytes', (r) => r.gzip],
  ['JS heap after create 10000 (KB, 净增)', (r) => r.heapKB],
]);
console.log('\n== DOM 结果校验 ==');
for (const n of names) console.log(`${n}: ${results[n].errors.length ? results[n].errors.join('; ') : 'OK'}\n  首行: ${results[n].rowHtml}`);
