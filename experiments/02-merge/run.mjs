// node 02-merge/run.mjs：语义表 + 性能表（每个 kit 每轮一个新页面，取中位数）
import { fileURLToPath } from 'node:url';
import { bundle, heapAfterGc, launch, median, openPage } from '../lib/browser.mjs';

const SEMANTIC_KITS = ['eager-whole', 'proxy-all', 'proxy-static', 'define-static', 'hoisted', 'solid'];
const KITS = ['direct', ...SEMANTIC_KITS];
const COUNT = 10_000;
const ROUNDS = 7;

const code = await bundle(fileURLToPath(new URL('./entry.js', import.meta.url)));
const browser = await launch();

console.log('== 语义 ==');
const semantic = {};
for (const name of SEMANTIC_KITS) {
  const page = await openPage(browser, code);
  semantic[name] = await page.evaluate((n) => window.semantics(n), name);
  await page.close();
}
const labels = Object.keys(semantic[SEMANTIC_KITS[0]]);
console.log(['检查', ...SEMANTIC_KITS].join(' | '));
for (const label of labels) {
  console.log([label, ...SEMANTIC_KITS.map((k) => semantic[k][label])].join(' | '));
}

console.log(`\n== 性能：${COUNT} 个三层按钮 ==`);
const rows = {};
for (const name of KITS) {
  const runs = [];
  for (let round = 0; round < ROUNDS; round++) {
    const page = await openPage(browser, code);
    // 同一页面先热身一次，再量
    await page.evaluate(([n, c]) => window.bench(n, c), [name, 1000]);
    const run = await page.evaluate(([n, c]) => window.bench(n, c), [name, COUNT]);
    runs.push(run);
    await page.close();
  }
  const pick = (key) => +median(runs.map((run) => run[key])).toFixed(2);
  const page = await openPage(browser, code);
  const empty = await heapAfterGc(page);
  await page.evaluate(([n, c]) => window.heap(n, c), [name, COUNT]);
  const used = await heapAfterGc(page);
  await page.close();
  rows[name] = {
    'mount ms': pick('mount'),
    'update 1 button x1000 ms': pick('updateOne'),
    'update all (shared signal) ms': pick('updateAll'),
    'dispose ms': pick('dispose'),
    'DOM writes / update': pick('writesPerOne'),
    'unrelated getter re-evals / update': pick('evalsPerOne'),
    'heap KB / button': +((used - empty) / COUNT / 1024).toFixed(2),
    'attrs on element': pick('attrs'),
  };
}
const metrics = Object.keys(rows[KITS[0]]);
console.log(['指标', ...KITS].join(' | '));
for (const metric of metrics) {
  console.log([metric, ...KITS.map((k) => rows[k][metric])].join(' | '));
}
await browser.close();
