// 主题的断言：node 10-css/run.mjs --only=theme
import { openPage } from '../lib/browser.mjs';
import { bundle, here } from './lib.mjs';

export async function run({ browser, check }) {
  console.log('## 主题\n');
  const code = await bundle(here('./cases/theme.tsx'), { minify: false });
  const page = await openPage(browser, code);
  const call = async (name, ...args) => {
    const result = await page.evaluate(([n, a]) => window.api[n](...a), [name, args]);
    await page.evaluate(() => window.api.flushSync());
    return result;
  };
  const css = (selector, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [selector, prop]);

  check('根上的浅色：行文字黑、背景白', (await css('#rows li', 'color')) === 'rgb(0, 0, 0)' && (await css('#rows li', 'backgroundColor')) === 'rgb(255, 255, 255)');
  check('嵌套主题：内部 section 深色', (await css('#innerText', 'color')) === 'rgb(255, 255, 255)' && (await css('#innerText', 'paddingLeft')) === '10px');
  check('嵌套主题：深色里再嵌浅色（浅色主题没有覆盖 space，沿用外层深色的 10px 间距）', (await css('#innerInnerText', 'color')) === 'rgb(0, 0, 0)' && (await css('#innerInnerText', 'paddingLeft')) === '10px');
  check('局部主题：theme 与样式写在同一个 sx，只影响这个元素', (await css('#local', 'color')) === 'rgb(255, 0, 128)' && (await css('#local2', 'color')) === 'rgb(0, 0, 255)');
  check('运行时取色：themeStyle 写成行内变量', (await css('#runtime', 'color')) === 'rgb(1, 2, 3)');
  const stackedClasses = await page.evaluate(() => document.getElementById('stacked').className.split(' ').length);
  check('两个主题叠在同一个 sx：同组后者覆盖，元素上只有组合类与一个主题类', stackedClasses === 2 && (await css('#stacked', 'color')) === 'rgb(255, 255, 255)', stackedClasses);

  // ---- 全局切换：不重新渲染 ----
  const rendersBefore = await call('renders');
  await page.evaluate(() => {
    window.__records = [];
    const observer = new MutationObserver((records) => window.__records.push(...records));
    observer.observe(document.getElementById('app'), { subtree: true, attributes: true, childList: true, characterData: true });
    window.__observer = observer;
  });
  const start = Date.now();
  await call('setDark', true);
  const records = await page.evaluate(() => {
    window.__records.push(...window.__observer.takeRecords());
    return window.__records.map((r) => `${r.type}:${r.target.id || r.target.nodeName}:${r.attributeName ?? ''}`);
  });
  console.log(`     切主题（200 行）：DOM 改动 ${JSON.stringify(records)}，耗时（含强制取值）${Date.now() - start} ms`);
  check('换主题：组件没有重新渲染', (await call('renders')) === rendersBefore);
  check('换主题：整个页面只有根元素改了一次 class', records.length === 1 && records[0].startsWith('attributes:app:class'), records);
  check('换主题：行的颜色跟着变', (await css('#rows li', 'color')) === 'rgb(255, 255, 255)' && (await css('#rows li', 'backgroundColor')) === 'rgb(0, 0, 0)');
  check('换主题：嵌套的局部主题不受外层影响（内部浅色仍是浅色）', (await css('#innerInnerText', 'color')) === 'rgb(0, 0, 0)');
  await call('setDark', false);
  check('换回浅色', (await css('#rows li', 'color')) === 'rgb(0, 0, 0)');

  // ---- 运行时自定义主题的规则表增长 ----
  const rulesBefore = await call('rules');
  await call('setUserColor', 'rgb(9, 9, 9)');
  for (let i = 0; i < 50; i++) await call('setUserColor', `rgb(${i}, 0, 0)`);
  check('取色器连续变化 51 次：themeStyle 不新增规则', (await call('rules')) === rulesBefore);
  const grown = await call('makeThemes', 50);
  console.log(`     createTheme 每个颜色一个类：50 个不同颜色新增 ${grown} 条规则（所以运行时用户输入用 themeStyle）`);
  check('对照：createTheme 每个新颜色一条规则', grown === 50, grown);

  // ---- 写错的 token ----
  const message = await call('badToken');
  check('写错的 token 在第一次用到时报错，带属性名和组', typeof message === 'string' && message.includes('_nope') && message.includes('colors'), message);
  await page.close();
}
