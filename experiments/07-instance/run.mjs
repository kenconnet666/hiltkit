// 实验七：组件实例成本。node 07-instance/run.mjs [--rounds N] [--scenario a|b] [--section steps|single|ablate|all] [--no-semantics]
//
// 优化编号（cfg 里的开关）：
//   1  release     释放没有依赖的 effect（defer：先跑后挂；unlink：先挂后断）
//   1b noDisposer  渲染 effect 不返回清理函数（少一个闭包）
//   2  scope       组件不要自己的作用域节点
//   3  hoistSet    omit 的键集合模块级只建一次，hidden 并集缓存
//   4  light       rest / merge 结果不建 Proxy，被调用方读键时才懒建
//   5  flat        层用平铺数组，不建每层一个对象
//   6  delegate    事件委托
//   7a lean        spread 一趟解析，不建 keys Set / active Map
//   7b hoist       组件内部的静态层提升进模板（依赖 lean）
//   X2 bindingNode 属性绑定用专门的节点类，没有闭包（我加的）
//   X1 ownerArray  作用域的子 effect 放 kids 数组，不为每个子节点建 Link（我加的）
//   8  shape       props 对象同形状（原型 getter + 键清单常量）
// 每个页面只跑一个组合；每轮新页面，同一页面先热身一次再量，取中位数。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundle, heapAfterGc, launch, median, openPage } from '../lib/browser.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : (args[at + 1] ?? true);
};
const ROUNDS = +flag('rounds', 7);
const SCENARIO = flag('scenario', 'both');
const SECTION = flag('section', 'all');
const SEMANTICS = !args.includes('--no-semantics');

const STEP_PATCHES = [
  ['v0 原型写法', {}],
  ['+1 release', { release: 'defer' }],
  ['+1b noDisposer', { noDisposer: true }],
  ['+2 noScope', { scope: false }],
  ['+X1 ownerArray', { ownerArray: true }],
  ['+3 hoistSet', { hoistSet: true }],
  ['+4 light', { light: true }],
  ['+5 flat', { flat: true }],
  ['+6 delegate', { delegate: true }],
  ['+7a lean', { lean: true }],
  ['+7b hoist', { hoist: true }],
  ['+X2 bindingNode', { bindingNode: true }],
  ['+8 shape', { shape: true }],
];
const steps = [];
let acc = {};
for (const [name, patch] of STEP_PATCHES) {
  acc = { ...acc, ...patch };
  steps.push([name, acc]);
}
const single = [
  ['v0', {}],
  ['1 release=defer', { release: 'defer' }],
  ['1 release=unlink', { release: 'unlink' }],
  ['1b noDisposer', { noDisposer: true }],
  ['2 noScope', { scope: false }],
  ['2+X1 noScope+ownerArray', { scope: false, ownerArray: true }],
  ['3 hoistSet', { hoistSet: true }],
  ['4 light', { light: true }],
  ['5 flat', { flat: true }],
  ['6 delegate', { delegate: true }],
  ['7a lean', { lean: true }],
  ['7a+7b lean+hoist', { lean: true, hoist: true }],
  ['X2 bindingNode', { bindingNode: true }],
  ['8 shape', { shape: true }],
];
const ablate = [
  ['v0', {}],
  ['去掉 effect（响应式键只写一次）', { ablate: 'effects' }],
  ['去掉事件监听', { ablate: 'events' }],
  ['去掉 DOM 属性写入', { ablate: 'attrs' }],
  ['去掉 spread（只克隆模板）', { ablate: 'spread' }],
];

const shapes = [
  ['同一种键顺序（defineProperties 构造）', { noise: 1 }],
  ['3 种键顺序', { noise: 3 }],
  ['3 种键顺序 + lean', { noise: 3, lean: true }],
  ['同一种键顺序 + lean', { noise: 1, lean: true }],
];

const code = await bundle(fileURLToPath(new URL('./entry.js', import.meta.url)));
const browser = await launch();

async function fresh(patch) {
  const page = await openPage(browser, code);
  await page.evaluate((p) => window.setup(p), patch);
  return page;
}

async function measure(scenario, patch) {
  const runs = [];
  const warm = scenario.startsWith('direct') ? 1000 : 500;
  for (let round = 0; round < ROUNDS; round++) {
    const page = await fresh(patch);
    await page.evaluate(([s, c]) => window.bench(s, c), [scenario, warm]);
    runs.push(await page.evaluate((s) => window.bench(s), scenario));
    await page.close();
  }
  const pick = (key) => +median(runs.map((run) => run[key])).toFixed(2);
  const heaps = [];
  for (let i = 0; i < 3; i++) {
    const page = await fresh(patch);
    const empty = await heapAfterGc(page);
    await page.evaluate((s) => void window.keep(s), scenario);
    const used = await heapAfterGc(page);
    heaps.push(used - empty);
    await page.close();
  }
  return {
    mount: pick('mount'),
    updateOne: pick('updateOne'),
    updateAll: pick('updateAll'),
    fire: pick('fire'),
    dispose: pick('dispose'),
    heapBytes: median(heaps),
  };
}

async function countsOf(scenario, patch) {
  const page = await fresh(patch);
  const result = await page.evaluate((s) => window.counts(s), scenario);
  await page.close();
  return result;
}
async function semanticsOf(patch) {
  const page = await fresh(patch);
  const result = await page.evaluate(() => window.semantics());
  await page.close();
  return result;
}

const COUNTS = { a: 10_000, b: 5_000, direct: 10_000, directB: 5_000 };
const all = {};

function print(title, rows, order) {
  console.log(`\n== ${title} ==`);
  const metrics = Object.keys(rows[order[0]]);
  console.log(['指标', ...order].join(' | '));
  for (const metric of metrics) console.log([metric, ...order.map((name) => rows[name][metric])].join(' | '));
}

async function section(title, scenario, list, withCounts) {
  const direct = scenario === 'a' ? 'direct' : 'directB';
  const rows = {};
  const order = [];
  for (const [name, patch] of list) {
    const m = await measure(scenario, patch);
    const row = {
      'mount ms': m.mount,
      'update 1 x1000 ms': m.updateOne,
      'update all ms': m.updateAll,
      'click x1000 ms': m.fire,
      'dispose ms': m.dispose,
      'heap KB / 实例': +(m.heapBytes / COUNTS[scenario] / 1024).toFixed(2),
    };
    if (withCounts) Object.assign(row, await countsOf(scenario, patch));
    rows[name] = row;
    order.push(name);
    console.error(`  [${title} ${scenario}] ${name}: mount ${row['mount ms']} ms, heap ${row['heap KB / 实例']} KB`);
  }
  if (withCounts) {
    const m = await measure(direct, {});
    rows['手写基线'] = {
      'mount ms': m.mount,
      'update 1 x1000 ms': m.updateOne,
      'update all ms': m.updateAll,
      'click x1000 ms': m.fire,
      'dispose ms': m.dispose,
      'heap KB / 实例': +(m.heapBytes / COUNTS[direct] / 1024).toFixed(2),
      ...(await countsOf(direct, {})),
    };
    order.push('手写基线');
  }
  print(`${title}（场景 ${scenario}：${COUNTS[scenario]} 个实例；轮数 ${ROUNDS}；有负载，仅看比例）`, rows, order);
  all[`${title}/${scenario}`] = rows;
}

const scenarios = SCENARIO === 'both' ? ['a', 'b'] : [SCENARIO];

if (SEMANTICS && (SECTION === 'all' || SECTION === 'steps')) {
  console.log('== 语义（逐步累加的每一步）==');
  const results = {};
  const names = steps.map(([name]) => name);
  for (const [name, patch] of steps) results[name] = await semanticsOf(patch);
  const labels = Object.keys(results[names[0]]);
  console.log(['检查', ...names].join(' | '));
  for (const label of labels) console.log([label, ...names.map((n) => results[n][label])].join(' | '));
  all.semantics = results;
}

for (const scenario of scenarios) {
  if (SECTION === 'all' || SECTION === 'steps') await section('逐步累加', scenario, steps, true);
}
for (const scenario of scenarios) {
  if (SECTION === 'all' || SECTION === 'single') await section('单项（各自叠在 v0 上）', scenario, single, true);
}
for (const scenario of scenarios) {
  if (SECTION === 'all' || SECTION === 'ablate') await section('消融（从 v0 去掉一块）', scenario, ablate, false);
}

if (SECTION === 'all' || SECTION === 'shapes') await section('形状（props 键顺序）', 'a', shapes, false);

// 层数的影响：同样 12 个键分到 L 层，只计 merge + spread
if (SECTION === 'all' || SECTION === 'layers') {
  console.log('\n== 层数的影响（10000 个元素，12 个键：8 静态 + 4 getter，平均分到 L 层）==');
  const configs = [
    ['v0', {}],
    ['全部优化（不含 shape/delegate/hoist）', { release: 'defer', noDisposer: true, scope: false, hoistSet: true, light: true, flat: true, lean: true }],
  ];
  const layerCounts = [1, 2, 4, 8];
  const table = {};
  for (const [name, patch] of configs) {
    for (const layerCount of layerCounts) {
      const times = [];
      const heaps = [];
      for (let round = 0; round < Math.min(ROUNDS, 5); round++) {
        const page = await fresh(patch);
        await page.evaluate(([l]) => { window.layerPrepare(l, 500); window.layerRun(); }, [layerCount]);
        await page.evaluate(([l]) => window.layerPrepare(l, 10_000), [layerCount]);
        const before = await heapAfterGc(page);
        times.push(await page.evaluate(() => window.layerRun()));
        heaps.push((await heapAfterGc(page)) - before);
        await page.close();
      }
      (table[name] ??= {})[`L=${layerCount}`] = `${median(times).toFixed(1)} ms / ${(median(heaps) / 10_000 / 1024).toFixed(2)} KB`;
    }
  }
  console.log(['配置', ...layerCounts.map((l) => `L=${l}`)].join(' | '));
  for (const [name, row] of Object.entries(table)) console.log([name, ...layerCounts.map((l) => row[`L=${l}`])].join(' | '));
  all.layers = table;
}

writeFileSync(fileURLToPath(new URL('./last-run.json', import.meta.url)), JSON.stringify(all, null, 1));
await browser.close();
