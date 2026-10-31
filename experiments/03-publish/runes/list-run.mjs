// node 03-publish/runes/list-run.mjs
import { fileURLToPath } from 'node:url';
import { bundle, launch, openPage } from '../../lib/browser.mjs';
import { hiltBuild } from '../rows/build.mjs';

const code = await bundle(fileURLToPath(new URL('./list-entry.tsx', import.meta.url)), { ...hiltBuild, minify: false });
const browser = await launch();
const page = await openPage(browser, code);
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
const flush = () => page.evaluate(() => window.flushSync());
const texts = (selector) => page.locator(`${selector} li`).allInnerTexts();
const call = async (name, value) => {
  await page.evaluate(([n, v]) => window.api[n](v), [name, value]);
  await flush();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
};
const pressed = (id) => page.locator(id).getAttribute('aria-pressed');

check('map：初始渲染', (await texts('#plain')).join() === '0:a,1:b', await texts('#plain'));
const firstLi = await page.evaluateHandle(() => document.querySelector('#plain li'));
await call('swapPlain');
check('map：重排，下标跟着更新', (await texts('#plain')).join() === '0:b,1:a', await texts('#plain'));
check('map：重排复用节点', await page.evaluate((node) => node === document.querySelectorAll('#plain li')[1], firstLi));
await call('addPlain');
check('map：新增', (await texts('#plain')).length === 3);

const built = (await page.evaluate(() => window.log.rowBuilt));
await call('setKeyed', [{ id: 2, name: 'TWO' }, { id: 1, name: 'ONE' }]);
check('key：数据换了对象，文本跟着变、下标跟着变', (await texts('#keyed')).join() === '0:TWO,1:ONE', await texts('#keyed'));
check('key：id 相同的行不重建组件', (await page.evaluate(() => window.log.rowBuilt)) === built, await page.evaluate(() => window.log.rowBuilt));
await call('setKeyed', [{ id: 3, name: 'three' }]);
check('key：新 id 建新行，旧的移除', (await texts('#keyed')).join() === '0:three', await texts('#keyed'));

check('解构的参数：初值', (await texts('#destructured')).join() === 'x');

await page.click('#bound');
await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
await flush();
check('_on={x}：自动写回', (await page.evaluate(() => window.api.read().bound)) === true && (await pressed('#bound')) === 'true');

await page.click('#locked');
await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
await flush();
const state = await page.evaluate(() => window.api.read());
check('手写 onOnChange 接管写回：回调被调用', state.notified === 1, state);
check('父级没采纳：状态没变', state.locked === false, state);
check('父级没采纳：组件自动退回，不用补偿代码', (await pressed('#locked')) === 'false', await pressed('#locked'));

await call('setAllow', true);
await page.click('#locked');
await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
await flush();
check('父级采纳：组件跟着变', (await pressed('#locked')) === 'true' && (await page.evaluate(() => window.api.read().locked)) === true);

await page.click('#free');
await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
await flush();
check('什么都不传：组件自己的状态', (await pressed('#free')) === 'true', await pressed('#free'));
await browser.close();
