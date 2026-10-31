// node 03-publish/sx/run.mjs：sx 跨组件层合并 + 引擎，在 Chromium 里断言
import { fileURLToPath } from 'node:url';
import { bundle, launch, openPage } from '../../lib/browser.mjs';
import { hiltBuild } from '../rows/build.mjs';

const code = await bundle(fileURLToPath(new URL('./entry.tsx', import.meta.url)), hiltBuild);
const browser = await launch();
const page = await openPage(browser, code);
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
const flush = () => page.evaluate(() => window.api.flushSync());
const info = (id) =>
  page.evaluate((target) => {
    const el = document.getElementById(target);
    const style = getComputedStyle(el);
    return {
      classes: el.className.split(' '),
      padding: style.paddingTop,
      margin: style.marginTop,
      color: style.color,
      width: style.width,
      inline: el.getAttribute('style'),
    };
  }, id);
const generated = (classes) => classes.filter((name) => !['inner', 'box', 'u', 'v'].includes(name));

let plain = await info('plain');
check('静态 class 跨层拼接', plain.classes.includes('inner') && plain.classes.includes('box'), plain.classes);
check('两层 sx 合成一个类', generated(plain.classes).length === 1, plain.classes);
check('底层样式生效', plain.padding === '4px' && plain.color === 'rgb(255, 0, 0)', plain);
check('上层动态样式生效', plain.width === '10px', plain);

const firstClass = generated(plain.classes)[0];
await page.evaluate(() => window.api.setWidth('33px'));
await flush();
plain = await info('plain');
check('动态值变了：宽度更新', plain.width === '33px', plain);
const secondClass = generated(plain.classes)[0];
const rulesAfterFirstChange = await page.evaluate(() => window.api.sheetRules());
await page.evaluate(() => window.api.setWidth('44px'));
await flush();
plain = await info('plain');
check('动态值再变：类不再换', generated(plain.classes)[0] === secondClass && plain.width === '44px', { firstClass, secondClass, plain });
check('动态值再变：不插新规则', (await page.evaluate(() => window.api.sheetRules())) === rulesAfterFirstChange);

let over = await info('over');
check('使用方 sx 盖过组件的', over.padding === '9px', over);
check('没覆盖的属性保留', over.margin === '2px' && over.color === 'rgb(255, 0, 0)', over);
check('使用方 class 也拼上', over.classes.includes('u'), over.classes);
const overGenerated = generated(over.classes)[0];
await page.evaluate(() => window.api.setClass('v'));
await flush();
over = await info('over');
check('只改 class 时生成的类不变', generated(over.classes)[0] === overGenerated && over.classes.includes('v') && !over.classes.includes('u'), over.classes);

let cond = await info('cond');
check('条件 sx 关闭时用组件的颜色', cond.color === 'rgb(255, 0, 0)', cond);
await page.hover('#cond');
await page.waitForFunction(() => getComputedStyle(document.getElementById('cond')).color === 'rgb(0, 0, 255)', null, { timeout: 2000 }).catch(() => {});
check('组件的 :hover 生效', (await info('cond')).color === 'rgb(0, 0, 255)', await info('cond'));
await page.mouse.move(0, 0);
await page.evaluate(() => window.api.setHot(true));
await flush();
cond = await info('cond');
check('条件 sx 打开：普通值整体替换', cond.color === 'rgb(255, 165, 0)', cond);
await page.evaluate(() => window.api.setHot(false));
await flush();
cond = await info('cond');
check('条件 sx 关闭：恢复组件的颜色', cond.color === 'rgb(255, 0, 0)', cond);

await browser.close();
