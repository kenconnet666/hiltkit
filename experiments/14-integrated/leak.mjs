// 内存泄漏：反复挂载、更新、卸载，强制 GC 后看堆是否回到基线。node 14-integrated/leak.mjs
// 组件不占节点之后，effect、行、清理都挂在 owner 上：这里验证它们真的被回收。
import { fileURLToPath } from 'node:url';
import { heapAfterGc, launch, openPage } from '../lib/browser.mjs';
import { bundle } from './bundle.mjs';

const code = await bundle('./leak-app.tsx', 'client');
const browser = await launch();
let failed = 0;
const check = (label, passed, detail) => {
  if (!passed) failed++;
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
};

const only = process.argv[2];
const ALL = [
  ['挂载再卸载整个应用', 'cycleApp'],
  ['条件分支反复切换（组件、sx、_effect、onCleanup、ref、context）', 'cycleBranch'],
  ['列表反复建满再清空（深代理的行）', 'cycleList'],
  ['列表行逐个替换', 'cycleRows'],
  ['错误边界反复抛错再重试', 'cycleBoundary'],
  ['传送反复开关', 'cyclePortal'],
  ['深代理对象反复整体替换', 'cycleState'],
  ['定位：行只有文字', 'cycleRowsPlain'],
  ['定位：行里 Child 档位固定', 'cycleRowsFixed'],
  ['定位：行里只有动态宽度', 'cycleRowsWidth'],
];
const SCENARIOS = ALL.filter(([, name]) => !only || name.includes(only));
for (const [label, name] of SCENARIOS) {
  const page = await openPage(browser, code);
  await page.evaluate(`window.leakApi.setup('${name}')`);
  // 热身：样式引擎的规则缓存、JIT、模板克隆源都建好了才算基线
  await page.evaluate(`window.leakApi.run(50)`);
  const base = await heapAfterGc(page);
  const series = [];
  for (let batch = 0; batch < 12; batch++) {
    await page.evaluate(`window.leakApi.run(200)`);
    series.push(Math.round(((await heapAfterGc(page)) - base) / 1024));
  }
  // 前面涨的是一次性的缓存和 JIT；引擎的动态值缓存有上限，满了清空，呈锯齿：比后半段前后两截的峰值
  const half = series.length >> 1;
  const peak = (from, to) => Math.max(...series.slice(from, to));
  const perCycle = (peak(half + 3, series.length) - peak(half, half + 3)) / (200 * 3);
  const nodes = await page.evaluate('window.leakApi.domCount()');
  check(`${label}：后半段每轮增长 ${perCycle.toFixed(3)} KB（序列 ${series.join(', ')}），残留 DOM ${nodes}`, perCycle < 0.02 && nodes < 50, series);
  await page.close();
}
await browser.close();
console.log(failed ? `\n${failed} 条失败` : '\n全部通过');
if (failed) process.exitCode = 1;
void fileURLToPath;
