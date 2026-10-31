// node 03-publish/lifecycle/run.mjs
import { fileURLToPath } from 'node:url';
import { bundle, launch, openPage } from '../../lib/browser.mjs';
import { hiltBuild } from '../rows/build.mjs';

const code = await bundle(fileURLToPath(new URL('./entry.tsx', import.meta.url)), hiltBuild);
const browser = await launch();
const page = await openPage(browser, code);
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
const flush = () => page.evaluate(() => window.api.flushSync());
const log = () => page.evaluate(() => ({ ...window.log }));
const call = (name, value) => page.evaluate(([n, v]) => window.api[n](v), [name, value]);
const text = (id) => page.evaluate((target) => document.getElementById(target)?.textContent ?? null, id);

const first = await log();
check('_effect 挂载后才第一次执行', first.order?.join() === 'body,body-end,effect', first.order);
check('_effect 第一次执行时 ref 已就绪、元素已挂上', first.connected === true, first.connected);

let before = await log();
await call('setTick', 1);
await flush();
let after = await log();
check('挂着时子组件 effect 跟着变', after.childRuns === before.childRuns + 1, { before, after });

await call('setShow', false);
await flush();
check('分支卸载：节点没了', (await text('child')) === null);
const offCleanups = (await log()).childCleanups;
const offRuns = (await log()).childRuns;
await call('setTick', 2);
await flush();
after = await log();
check('分支卸载：effect 不再跑', after.childRuns === offRuns, after);
check('分支卸载：清理函数只跑到卸载那次', after.childCleanups === offCleanups, after);

const rowBefore = await log();
await call('removeRow');
await flush();
const rowAfterRemove = await log();
check('列表删行：清理函数跑了', rowAfterRemove.rowCleanups === rowBefore.rowCleanups + 1, { rowBefore, rowAfterRemove });
await call('setTick', 3);
await flush();
const rowFinal = await log();
check('列表删行：只剩 2 行的 effect 在跑', rowFinal.rowRuns === rowAfterRemove.rowRuns + 2, { rowAfterRemove, rowFinal });

check('context：Provider 里立刻创建的能读到', (await text('eager')) === 'dark', await text('eager'));
check('context：Provider 外读到默认值', (await text('outside')) === 'fallback', await text('outside'));
await call('setLateShow', true);
await flush();
check('context：之后才创建的分支也能读到', (await text('late')) === 'dark', await text('late'));

const sumBefore = (await log()).sumRuns;
const returned = await call('batch');
await flush();
const sumAfter = (await log()).sumRuns;
check('同一轮读派生值是新的', returned === 120, returned);
check('同一轮多次写只跑一次 effect', sumAfter === sumBefore + 1, { sumBefore, sumAfter });

const built = (await log()).childrenBuilt;
const twice = await page.evaluate(() => document.getElementById('twice').innerHTML);
console.log(`info children 写两次：组件创建 ${built} 次，${twice}`);

const throwBefore = (await log()).afterThrow;
await call('boom', 1).catch(() => {});
await flush().catch(() => {});
await page.waitForTimeout(50);
const throwAfter = (await log()).afterThrow;
check('一个 effect 抛错：同一轮排在后面的 effect 仍然执行', throwAfter === throwBefore + 1, { throwBefore, throwAfter, errors: await page.evaluate(() => window.api.errors) });
await call('boom', 2).catch(() => {});
await flush().catch(() => {});
await page.waitForTimeout(50);
const throwLater = (await log()).afterThrow;
check('抛错之后响应式系统还能继续工作', throwLater > throwAfter, { throwAfter, throwLater });

await browser.close();
