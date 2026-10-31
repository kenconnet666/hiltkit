// node test/integration/port/bugs/dynamic-layering.mjs
// 缺陷：{...dynamic(...)} 和同一元素上显式写的 class / sx 不分层，而是整体替换；dynamic 撤掉时显式的那份也被清空。
// 期望：同 merge 的规则——class 拼接、sx 叠加（dynamic 在后），撤掉后显式的那份还在。
import { open, verdict } from './lib.mjs';

const { browser, page, flush } =
  await open(`import { dynamic, flushSync, mount, sig } from 'hiltkit'; import { create } from 'hiltkit/css';
const s = create({ a: { color: 'rgb(1, 2, 3)', paddingTop: '5px' }, b: { color: 'rgb(9, 9, 9)' } });
const extraClass = sig(undefined); const extraSx = sig(undefined);
window.setExtra = (c, x) => { extraClass.set(c); extraSx.set(x); }; window.flushSync = flushSync; window.s = s;
mount(() => <div><i id="c" class="x" {...dynamic(() => extraClass())} /><b id="s" sx={[s.a]} {...dynamic(() => extraSx())} /></div>, document.body);`);
const cls = () => page.evaluate(() => document.getElementById('c').className);
const style = () =>
  page.evaluate(() => {
    const c = getComputedStyle(document.getElementById('s'));
    return [c.color, c.paddingTop];
  });

await page.evaluate(() => {
  window.setExtra({ class: 'y' }, { sx: [window.s.b] });
  window.flushSync();
});
verdict('class：显式的 x 和 dynamic 给的 y 拼接', (await cls()) === 'x y', await cls());
verdict(
  'sx：dynamic 的颜色盖过，显式的 paddingTop 还在',
  JSON.stringify(await style()) === JSON.stringify(['rgb(9, 9, 9)', '5px']),
  await style(),
);
await page.evaluate(() => {
  window.setExtra(undefined, undefined);
  window.flushSync();
});
verdict('class：dynamic 撤掉后 x 还在', (await cls()) === 'x', await cls());
verdict(
  'sx：dynamic 撤掉后回到显式的样式',
  JSON.stringify(await style()) === JSON.stringify(['rgb(1, 2, 3)', '5px']),
  await style(),
);
await browser.close();
