// 条件的断言：node 10-css/run.mjs --only=conditions
import { openPage } from '../lib/browser.mjs';
import { bundle, here } from './lib.mjs';

export async function run({ browser, check }) {
  console.log('## 条件（别名、容器查询、when.*）\n');
  const code = await bundle(here('./cases/conditions.tsx'), { minify: false });
  const page = await openPage(browser, code);
  const flush = () => page.evaluate(() => window.api.flushSync());
  const css = (id, prop) => page.evaluate(([i, p]) => getComputedStyle(document.getElementById(i))[p], [id, prop]);
  const classOf = (id) => page.evaluate((i) => document.getElementById(i).className, id);
  const rules = () => page.evaluate(() => [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0));
  const bytes = () => page.evaluate(() => [...document.styleSheets].reduce((n, s) => n + [...s.cssRules].reduce((m, r) => m + r.cssText.length, 0), 0));

  // ---- 别名跟 DOM 属性走 ----
  check('默认色', (await css('item', 'color')) === 'rgb(0, 0, 0)');
  const classBefore = await classOf('item');
  await page.evaluate(() => window.api.setSelected(true));
  await flush();
  check('_selected：状态变了只改 aria-selected，颜色跟着变，类名不变', (await css('item', 'color')) === 'rgb(255, 0, 0)' && (await classOf('item')) === classBefore);
  check('使用方只覆盖 _selected：选中色变了，默认色与别的条件保留', (await css('override', 'color')) === 'rgb(0, 255, 0)');
  await page.evaluate(() => window.api.setSelected(false));
  await flush();
  check('取消选中后，使用方的覆盖只在选中时才有', (await css('override', 'color')) === 'rgb(0, 0, 0)');
  check('_disabled 认 aria-disabled', (await css('disabled', 'color')) === 'rgb(128, 128, 128)');
  await page.hover('#item');
  check('_hover 与别名并存', (await css('item', 'color')) === 'rgb(0, 0, 255)');
  await page.mouse.move(900, 800);

  // 第三方（headless 库、浏览器）自己改 DOM 属性，样式也跟：不依赖我们的状态
  await page.evaluate(() => document.getElementById('open').setAttribute('data-state', 'open'));
  check('_open 认第三方设的 data-state="open"（不需要任何 JS 状态）', (await css('open', 'backgroundColor')) === 'rgb(2, 2, 2)');
  await page.evaluate(() => document.getElementById('open').removeAttribute('data-state'));
  check('属性去掉后恢复', (await css('open', 'backgroundColor')) === 'rgb(1, 1, 1)');

  // ---- 自定义别名 ----
  check('defineConditions：自定义 _loading（属性选择器）', (await css('loading', 'opacity')) === '0.5');
  check('defineConditions：自定义 _md（@media 断点，视口 1200 宽）', (await css('item', 'fontSize')) === '20px');

  const startingStyle = await page.evaluate(() => [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).some((rule) => rule.cssText.includes('@starting-style')));
  check('@starting-style 当条件键：规则被浏览器接受', startingStyle);
  const errors = await page.evaluate(() => window.api.badAlias());
  check('defineConditions 校验：不以 _ 开头、盖掉内置别名、值不是选择器 / @ 规则都报错', errors.length === 3, errors);

  // ---- 容器查询 ----
  check('@container：容器 300 宽时不生效', (await css('inBox', 'color')) === 'rgb(0, 0, 0)');
  await page.evaluate(() => (document.getElementById('box').style.width = '500px'));
  check('@container：容器变宽后生效（跟容器不跟视口）', (await css('inBox', 'color')) === 'rgb(0, 128, 0)');

  // ---- when.* ----
  check('when.ancestor 平时不生效', (await css('child', 'color')) === 'rgb(0, 0, 0)');
  await page.hover('#scope');
  check('when.ancestor(:hover, marker)：祖先悬停时子元素变色', (await css('child', 'color')) === 'rgb(200, 0, 0)');
  await page.mouse.move(900, 800);

  // ---- 状态组合的规则数：条件类 vs 属性别名 ----
  const flags = ['a', 'b', 'c', 'd'];
  const rulesBefore = await rules();
  const bytesBefore = await bytes();
  const combos = [];
  for (let n = 0; n < 16; n++) combos.push(Object.fromEntries(flags.map((f, i) => [f, !!(n & (1 << i))])));
  const seen = new Set();
  const seenAlias = new Set();
  for (const combo of combos) {
    for (const [key, value] of Object.entries(combo)) await page.evaluate(([k, v]) => window.api.setFlag(k, v), [key, value]);
    await flush();
    seen.add(await classOf('classes'));
    seenAlias.add(await classOf('alias'));
  }
  const rulesAfter = await rules();
  const bytesAfter = await bytes();
  console.log(`     4 个布尔状态走遍 16 种组合：条件类写法出现 ${seen.size} 个不同的类名，别名写法 ${seenAlias.size} 个；样式表共新增 ${rulesAfter - rulesBefore} 条规则、${bytesAfter - bytesBefore} 字节`);
  check('别名写法：16 种状态组合始终同一个类', seenAlias.size === 1, [...seenAlias]);
  check('条件类写法：每种组合各一个组合类（2^4）', seen.size === 16, [...seen].length);

  // 两种写法的计算样式一致（全开）
  const same = await page.evaluate(() => {
    const a = getComputedStyle(document.getElementById('classes'));
    const b = getComputedStyle(document.getElementById('alias'));
    return ['color', 'fontWeight', 'opacity', 'letterSpacing'].every((p) => a[p] === b[p]);
  });
  check('全开时两种写法算出的样式相同', same);
  await page.close();
}
