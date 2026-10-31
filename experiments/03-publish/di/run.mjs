// node 03-publish/di/run.mjs：语义断言 + context 查找的成本 + 服务端按请求隔离
import { fileURLToPath } from 'node:url';
import { bundle, launch, median, openPage } from '../../lib/browser.mjs';
import { hiltBuild } from '../rows/build.mjs';

const code = await bundle(fileURLToPath(new URL('./entry.tsx', import.meta.url)), { ...hiltBuild, minify: false });
const browser = await launch();
const page = await openPage(browser, code);
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
const flush = () => page.evaluate(() => window.flushSync());
const log = () => page.evaluate(() => ({ ...window.log }));
const text = (id) => page.evaluate((target) => document.getElementById(target)?.textContent ?? null, id);

let l = await log();
check('多个组件 use 同一个服务，只创建一次（子树那份另算）', l.cartBuilt === 2, l);
check('服务依赖服务，只创建一次', l.loggerBuilt === 1, l);
check('没人用的服务不创建', l.neverBuilt === 0, l);

check('全局那份初值', (await text('a')) === '0');
await page.click('#add');
await flush();
check('服务里的状态是活的', (await text('a')) === '1', await text('a'));
check('子树那份不受影响', (await text('s')) === '0', await text('s'));
await page.click('#addS');
await flush();
check('子树那份自己变', (await text('s')) === '1' && (await text('a')) === '1');
check('测试替身', (await text('f')) === '99', await text('f'));

check('context 嵌套：外层', (await text('t1')) === 'outer');
check('context 嵌套：内层', (await text('t2')) === 'inner');
check('context 嵌套：内层结束后恢复', (await text('t3')) === 'outer', await text('t3'));
check('context：范围外', (await text('t4')) === 'fallback', await text('t4'));
await page.evaluate(() => window.setLate(true));
await flush();
check('context：之后才建的分支在正确的位置', (await text('late')) === 'fallback', await text('late'));

check('活对象穿过 context：初值', (await text('tone')) === 'red');
await page.evaluate(() => window.setTone('blue'));
await flush();
check('活对象穿过 context：跟着变', (await text('tone')) === 'blue');

const before = (await log()).cartEffect;
await page.evaluate(() => window.setTransient(false));
await flush();
check('第一个调用者卸载', (await text('transient')) === null);
await page.click('#add');
await flush();
check('服务的 effect 跟着应用走，调用者卸载后还在', (await log()).cartEffect > before, await log());

await page.evaluate(() => window.mountSecond());
check('另一个应用实例有自己的一份', (await text('second-badge')) === '0', await text('second-badge'));

const effectRuns = (await log()).cartEffect;
await page.evaluate(() => window.dispose());
await page.evaluate(() => {
  // 应用销毁：服务的 effect 也停。通过一个还活着的按钮写状态
  document.getElementById('add').click();
});
await flush();
check('应用销毁后服务的 effect 也停了', (await log()).cartEffect === effectRuns, { effectRuns, now: await log() });

// ---- 成本：一条 owner 链上逐级查 vs 原型链 ----
const bench = await page.evaluate(() => {
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const results = {};
  for (const depth of [10, 100, 1000]) {
    // 旧做法：每个组件一个 owner 节点，provider 一个 Map
    const key = {};
    let owner = { parent: null, context: new Map([[key, 'v']]) };
    for (let i = 0; i < depth; i++) owner = { parent: owner, context: undefined };
    const walk = () => {
      for (let node = owner; node; node = node.parent) {
        if (node.context?.has(key)) return node.context.get(key);
      }
      return undefined;
    };
    // 新做法：只有 provider 一层，中间的组件不占地方
    const id = Symbol('k');
    const root = Object.create(null);
    root[id] = 'v';
    const proto = Object.create(root);
    const lookup = () => proto[id];
    let sink = 0;
    const time = (fn) => {
      const runs = [];
      for (let round = 0; round < 7; round++) {
        const start = performance.now();
        for (let i = 0; i < 200_000; i++) sink += fn().length;
        runs.push(performance.now() - start);
      }
      return +median(runs).toFixed(2);
    };
    results[depth] = { 'owner 链 ms': time(walk), '原型链 ms': time(lookup), sink };
    delete results[depth].sink;
  }
  return results;
});
console.log('20 万次 inject：', JSON.stringify(bench));

await browser.close();
