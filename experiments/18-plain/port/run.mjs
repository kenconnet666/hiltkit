// node 18-plain/port/run.mjs：同一批断言，组件换成零编译写法（标准 JSX + 普通函数组件）
import { launch } from '../../lib/browser.mjs';
import { bundle } from '../bundle.mjs';

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};
const clientCode = await bundle(
  `import { flushSync, hydrate, mount, warnings } from 'hilt'; import { App } from './port/app.tsx';
   window.flushSync = flushSync; window.warnings = warnings;
   const host = document.getElementById('app');
   window.dispose = window.__mode === 'hydrate' ? hydrate(() => <App />, host) : mount(() => <App />, host);`,
);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
await page.setContent('<!doctype html><html><head></head><body><div id="app"></div></body></html>');
await page.addScriptTag({ content: clientCode });

const settle = async () => {
  await page.evaluate(() => window.flushSync());
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
  await page.evaluate(() => window.flushSync());
};
const set = async (name, value) => {
  await page.evaluate(([n, v]) => window.api.set(n, v), [name, value]);
  await settle();
};
const attr = (selector, name) => page.locator(selector).getAttribute(name);
const color = (selector) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).color, selector);
const bg = (selector) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundColor, selector);
const log = () => page.evaluate(() => ({ ...window.log }));
const rebuilt = () => page.evaluate(() => window.ported.rebuilt.button);
const sameElement = async (selector, action) => {
  await page.evaluate((s) => (window.__el = document.querySelector(s)), selector);
  await action();
  return page.evaluate((s) => window.__el === document.querySelector(s), selector);
};

console.log('--- Button：外观 ---');
const builtAtStart = await rebuilt();
check('实底品牌色', (await bg('#btn')) === 'rgb(0, 0, 255)', await bg('#btn'));
check('属性透传到按钮', (await attr('#btn', 'data-user')) === '1');
check('使用方的 class 在', (await attr('#btn', 'class')).includes('user-class'), await attr('#btn', 'class'));
check('部件属性 propsContent 落到内容层', (await page.locator('#btn span.content-class').count()) === 1);
check('type 默认 button', (await attr('#btn', 'type')) === 'button');
check('改档位不重建元素', await sameElement('#btn', () => set('tone', 'danger')));
check('改档位：样式变了', (await bg('#btn')) === 'rgb(255, 0, 0)', await bg('#btn'));
await set('variant', 'outline');
check('改样式：变成描边', (await bg('#btn')) === 'rgba(0, 0, 0, 0)' && (await color('#btn')) === 'rgb(255, 0, 0)', [await bg('#btn'), await color('#btn')]);
check('改档位没有重跑组件函数', (await rebuilt()) === builtAtStart, await rebuilt());
await set('size', 'sm');
check('size 查表样式', (await page.evaluate(() => getComputedStyle(document.getElementById('btn')).fontSize)) === '12px');
await set('fullWidth', true);
check('布尔样式', (await page.evaluate(() => getComputedStyle(document.getElementById('btn')).display)) === 'flex');

console.log('--- Button：行为 ---');
await page.click('#btn');
await settle();
check('使用方 onClick 执行', (await log()).userClicks === 1, await log());
await set('loading', true);
check('加载中：aria-busy', (await attr('#btn', 'aria-busy')) === 'true');
await page.click('#btn');
await settle();
check('加载中：受管层拦下，使用方 onClick 不执行（不用转调）', (await log()).userClicks === 1, await log());
check('还没到延迟：不显示指示', (await page.locator('#btn .spinner').count()) === 0, await page.locator('#btn .spinner').count());
await page.waitForTimeout(500);
await settle();
check('延迟后显示指示', (await page.locator('#btn .spinner').count()) === 1);
check('内容隐藏但保留', (await page.evaluate(() => getComputedStyle(document.querySelector('#btn .content-class')).opacity)) === '0', await page.evaluate(() => getComputedStyle(document.querySelector('#btn .content-class')).opacity));
await set('loading', false);
check('结束后恢复', (await page.locator('#btn .spinner').count()) === 0 && (await page.evaluate(() => getComputedStyle(document.querySelector('#btn .content-class')).opacity)) === '1');
await set('disabled', true);
check('不可用：原生 disabled', (await attr('#btn', 'disabled')) === '' && (await attr('#btn', 'data-disabled')) === '');
await set('soft', true);
check('可聚焦的不可用：换成 aria-disabled', (await attr('#btn', 'disabled')) === null && (await attr('#btn', 'aria-disabled')) === 'true');
await page.click('#btn', { force: true });
await settle();
check('可聚焦的不可用：点击被拦', (await log()).userClicks === 1, await log());
await set('disabled', false);

console.log('--- Button：动态部件属性 ---');
const iconBefore = await page.evaluate(() => document.querySelector('#btn [data-icon=plus]'));
void iconBefore;
check('部件属性后来才给也不重建按钮', await sameElement('#btn', () => set('propsIcon', { 'data-extra': 'yes', class: 'icon-class' })));
check('部件属性到了图标上', (await attr('#btn [data-icon=plus]', 'data-extra')) === 'yes');
check('部件属性的 class 拼接', (await attr('#btn [data-icon=plus]', 'class')).split(' ').join() === 'icon,icon-class', await attr('#btn [data-icon=plus]', 'class'));
await set('propsIcon', undefined);
check('部件属性撤掉后键也消失', (await attr('#btn [data-icon=plus]', 'data-extra')) === null);
check('按钮组件函数只跑过一次', (await rebuilt()) === builtAtStart, await rebuilt());

console.log('--- Button：组（context + 活对象 + 属性链）---');
check('组的样式传给按钮', (await color('#grouped')) === 'rgb(255, 0, 0)', await color('#grouped'));
check('自己写的优先', (await color('#grouped-own')) === 'rgb(0, 0, 255)', await color('#grouped-own'));
await set('groupTone', 'accent');
check('组的 prop 变了，按钮跟着变', (await color('#grouped')) === 'rgb(0, 0, 255)', await color('#grouped'));

console.log('--- Switch ---');
const input = 'input[role=switch]';
check('未声明的属性落到 input', (await attr(input, 'data-input')) === 'yes');
check('propsRoot 落到 label', (await attr('label', 'data-root')) === 'yes');
check('id 来自 Field', (await attr(input, 'id')) === 'f1', await attr(input, 'id'));
check('说明关联', (await attr(input, 'aria-describedby')) === 'f1-desc', await attr(input, 'aria-describedby'));
await page.check(input);
await settle();
check('切换：写回父级', (await page.evaluate(() => window.api.read().on)) === true);
check('切换：状态属性跟着变', (await attr('label', 'data-state')) === 'checked');
check('切换：其他元素跟着变', (await page.locator('#on-state').innerText()) === '开');
await set('readonly', true);
await page.click(input, { force: true });
await settle();
check('只读：点击被拦，状态不变', (await page.evaluate(() => window.api.read().on)) === true && (await page.isChecked(input)) === true, await page.evaluate(() => window.api.read()));
await set('readonly', false);
await set('switchLoading', true);
await page.click(input, { force: true });
await settle();
check('切换中：点击被拦', (await page.evaluate(() => window.api.read().on)) === true && (await page.isChecked(input)) === true);
await set('switchLoading', false);
await set('invalid', true);
check('校验状态来自 Field', (await attr(input, 'aria-invalid')) === 'true', await attr(input, 'aria-invalid'));
await set('wide', '开关字');
check('轨道文字：出现', (await page.locator('label [aria-hidden=true]').count()) === 2, await page.locator('label [aria-hidden=true]').count());
await set('wide', undefined);
check('轨道文字：消失', (await page.locator('label [aria-hidden=true]').count()) === 0);

console.log('--- Tabs ---');
check('默认第一个', (await attr('[data-value=a]', 'aria-selected')) === 'true', await attr('[data-value=a]', 'aria-selected'));
check('组合式：注册顺序决定默认', (await attr('[data-value=b]', 'aria-selected')) === 'false');
check('懒内容：没打开不创建', (await log()).panelBuilt === 0, await log());
await page.click('[data-value=b]');
await settle();
check('点击切换并写回', (await page.evaluate(() => window.api.read().tab)) === 'b', await page.evaluate(() => window.api.read()));
check('样式跟着变', (await color('[data-value=b]')) === 'rgb(0, 0, 255)' && (await color('[data-value=a]')) === 'rgb(100, 100, 100)', [await color('[data-value=b]'), await color('[data-value=a]')]);
check('懒内容：打开时创建一次', (await log()).panelBuilt === 1, await log());
await page.click('[data-value=a]');
await settle();
await page.click('[data-value=b]');
await settle();
check('懒内容：切走再切回不重建', (await log()).panelBuilt === 1, await log());
await page.click('[data-value=c]');
await settle();
check('使用方 preventDefault 拦下切换', (await page.evaluate(() => window.api.read().tab)) === 'b');
await page.focus('[data-value=b]');
await page.keyboard.press('ArrowLeft');
await settle();
check('键盘：方向键移动焦点并切换', (await page.evaluate(() => window.api.read().tab)) === 'a' && (await page.evaluate(() => document.activeElement.dataset.value)) === 'a', await page.evaluate(() => [window.api.read().tab, document.activeElement.dataset.value]));
check('aria 关联', (await attr('[data-value=a]', 'aria-controls')) !== null);

console.log('--- 返回 JSX 的辅助函数 ---');
const helperBefore = await log();
const topKept = await sameElement('#helper-top', () => set('helperLabel', '二'));
const lazyEl = await sameElement('#helper-lazy', () => set('helperLabel', '三'));
const helperAfter = await log();
console.log(`info 顶层读：元素保留=${topKept}，函数又跑了 ${helperAfter.helperRuns - helperBefore.helperRuns} 次；内容里读：元素保留=${lazyEl}，函数又跑了 ${helperAfter.helperKept - helperBefore.helperKept} 次`);
check('两种写法显示都对', (await page.locator('#helper-top').innerText()) === '三' && (await page.locator('#helper-lazy').innerText()) === '三');

console.log('--- 诊断的误报情况 ---');
const warnings = await page.evaluate(() => window.warnings.map((w) => String(w).split('\n').slice(1, 4).map((l) => l.trim().split(' ')[1]).join(' < ')));
console.log(`info 组件顶层读诊断共 ${warnings.length} 条：`);
const grouped = {};
for (const w of warnings) grouped[w] = (grouped[w] ?? 0) + 1;
for (const [w, n] of Object.entries(grouped).slice(0, 12)) console.log(`info   ${n} × ${w}`);
check('没有页面错误', errors.length === 0, errors.slice(0, 5));
await page.close();

console.log('--- SSR 与水合 ---');
const serverCode = await bundle(
  `import { renderToString } from 'hilt'; import { renderStyleTag } from 'hilt/css'; import { App } from './port/app.tsx';
   export function render() { const body = renderToString(() => <App />); return { body, head: renderStyleTag(body) }; }`,
  { server: true },
);
const { render } = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
const rendered = render();
console.log(`info HTML ${rendered.body.length} 字节，其中注释标记 ${rendered.body.length - rendered.body.replace(/<!--[^>]*-->/g, '').length} 字节`);
const hydrated = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const hydrateErrors = [];
hydrated.on('pageerror', (error) => hydrateErrors.push(error.stack ?? error.message));
await hydrated.setContent(`<!doctype html><html><head>${rendered.head}</head><body><div id="app">${rendered.body}</div></body></html>`);
await hydrated.evaluate(() => {
  window.__mode = 'hydrate';
  const walker = document.createTreeWalker(document.getElementById('app'));
  window.__nodes = [];
  while (walker.nextNode()) window.__nodes.push(walker.currentNode);
  window.__mutations = [];
  window.__observer = new MutationObserver((records) => window.__mutations.push(...records.map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)));
  window.__observer.observe(document.getElementById('app'), { subtree: true, childList: true, attributes: true, characterData: true });
});
await hydrated.addScriptTag({ content: clientCode });
const mutations = await hydrated.evaluate(() => {
  window.__observer.takeRecords().forEach((r) => window.__mutations.push(`${r.type}:${r.target.nodeName}`));
  return window.__mutations;
});
check('接管时没有 DOM 改动', mutations.length === 0, mutations.slice(0, 8));
const same = await hydrated.evaluate(() => {
  const walker = document.createTreeWalker(document.getElementById('app'));
  const now = [];
  while (walker.nextNode()) now.push(walker.currentNode);
  return now.length === window.__nodes.length && now.every((node, index) => node === window.__nodes[index]);
});
check('接管后节点还是原来那些', same);
check('接管没有报错', hydrateErrors.length === 0, hydrateErrors.slice(0, 5));
await hydrated.evaluate(() => document.getElementById('btn').click());
await hydrated.evaluate(() => window.flushSync());
check('接管后按钮能用', (await hydrated.evaluate(() => window.log.userClicks)) === 1);
await hydrated.check('input[role=switch]');
await hydrated.evaluate(() => window.flushSync());
check('接管后开关能用', (await hydrated.evaluate(() => window.api.read().on)) === true);
await browser.close();
console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;
