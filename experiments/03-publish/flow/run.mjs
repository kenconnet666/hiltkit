// node 03-publish/flow/run.mjs
import { fileURLToPath } from 'node:url';
import { bundle, launch, openPage } from '../../lib/browser.mjs';
import { hiltBuild } from '../rows/build.mjs';

const code = await bundle(fileURLToPath(new URL('./entry.tsx', import.meta.url)), { ...hiltBuild, minify: false });
const browser = await launch();
const page = await openPage(browser, code);
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
const settle = async () => {
  await page.evaluate(() => window.flushSync());
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
  await page.evaluate(() => window.flushSync());
};
const log = () => page.evaluate(() => ({ ...window.log, rebind: undefined }));
const call = async (name, value) => {
  await page.evaluate(([n, v]) => window.api[n](v), [name, value]);
  await settle();
};
const read = () => page.evaluate(() => window.api.read());
const text = (selector) => page.locator(selector).innerText();
const type = async (selector, value) => {
  await page.fill(selector, value);
  await settle();
};

console.log('--- 父传子 ---');
check('三层转交后值到了', (await text('#leaf')) === '中:a', await text('#leaf'));
let l = await log();
check('子组件函数体执行一次', l.bodyRuns === 1, l);
await call('setValue', 'b');
check('改 prop：叶子更新', (await text('#leaf')) === '中:b', await text('#leaf'));
check('改 prop：子组件函数体不重跑', (await log()).bodyRuns === 1);
await call('setUnrelated', 1);
check('父级无关状态：子组件不受影响', (await log()).bodyRuns === 1);
check('没读的 prop 不求值（但 expensive() 写在 JSX 里是函数调用）', (await log()).unreadProp === 0, await log());
check('默认值', (await page.locator('#leaf').getAttribute('data-size')) === 'md');
await call('setSize', 'lg');
check('传了值盖过默认值', (await page.locator('#leaf').getAttribute('data-size')) === 'lg');
check('默认值可以依赖前面的 prop，跟着变', (await text('#leaf')).startsWith('大:'), await text('#leaf'));
await call('setSize', undefined);
check('传回 undefined：回到默认值', (await page.locator('#leaf').getAttribute('data-size')) === 'md');

console.log('--- 槽 ---');
check('没读到的槽不创建', (await log()).slotBuilt === 0, await log());
await call('setOpen', true);
check('打开时才创建', (await log()).slotBuilt === 1 && (await page.locator('#slot-header em').count()) === 1, await log());
await call('setOpen', false);
await call('setOpen', true);
console.log(`info 关掉再打开，槽内容重新创建，共 ${(await log()).slotBuilt} 次（状态不保留）`);
check('作用域槽：初值', (await text('#scoped')) === '0');
await page.evaluate(() => window.setHover(3));
await settle();
check('作用域槽：子组件的状态变了，父级写的内容跟着变', (await text('#scoped')) === '3', await text('#scoped'));
check('children 是普通 prop', (await page.locator('#slot-children').count()) === 1);

console.log('--- 子传父：回调 ---');
await page.click('#pick');
await settle();
const picks = (await log()).inner;
check('跨组件层的回调都执行，靠后的层先执行', picks.join() === 'user:v,mid:v', picks);

console.log('--- 双向绑定 ---');
await type('#direct', 't2');
check('直接绑定：子改父', (await read()).text === 't2');
await type('#forward', 'f2');
check('中间层不声明，靠 rest 转交', (await read()).forwarded === 'f2', await read());
await type('#rebind', 'r2');
check('中间层声明后再绑：写回到最上面', (await read()).rebound === 'r2', await read());
await type('#field', 'n2');
check('绑定对象属性 form.name', (await read()).name === 'n2', await read());
await type('#cell', '9');
check('绑定数组元素 rows[1].qty', (await read()).qty === '9', await read());
await type('#transform', '42');
check('换算：_value 是表达式，回调里写回', (await read()).number === 42, await read());
check('换算：显示跟着父级', (await page.inputValue('#transform')) === '42');
await type('#free', 'alone');
check('什么都不传：组件自己的状态', (await page.inputValue('#free')) === 'alone');

console.log('--- 子暴露能力 ---');
check('ref 拿到子组件暴露的对象', await page.evaluate(() => typeof window.api.dialog().show === 'function'));
await page.evaluate(() => window.api.dialog().show());
await settle();
check('父级调用子组件的方法', (await page.locator('#dialog').getAttribute('data-open')) === 'yes');
check('暴露的状态是活的（活对象规则）', await page.evaluate(() => window.api.dialog().open === true));
check('不声明 ref：落到主元素', (await read()).box === 'INPUT', await read());
await call('setShowBox', false);
check('元素卸载后 ref 变成 null', (await read()).box === null, await read());
await call('setShowBox', true);
check('重新挂载 ref 又有了', (await read()).box === 'INPUT', await read());

console.log('--- 控制器 ---');
await page.click('#ctrl');
await settle();
check('子组件调用，父级看到', (await read()).count === 1, await read());
check('父级的状态，子组件显示', (await text('#ctrl')) === '1', await text('#ctrl'));

await browser.close();
