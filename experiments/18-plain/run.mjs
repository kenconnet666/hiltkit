// node 18-plain/run.mjs：不用编译插件时的行为、服务端渲染、水合
import { launch } from '../lib/browser.mjs';
import { bundle } from './bundle.mjs';

const clientCode = await bundle(`import { flushSync, hydrate, mount, warnings } from 'hilt'; import { App } from './cases/app.tsx';
window.flushSync = flushSync; window.warnings = warnings;
window.startMount = () => mount(() => <App />, document.body);
window.startHydrate = () => hydrate(() => <App />, document.getElementById('ssr'));`);
const serverCode = await bundle(`import { renderToString } from 'hilt'; import { renderStyleTag } from 'hilt/css'; import { App } from './cases/app.tsx';
export const render = () => { const body = renderToString(() => <App />); return { body, head: renderStyleTag(body) }; };`, { server: true });

const browser = await launch();
let failed = 0;
let passed = 0;
const check = (label, ok, detail) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};

async function scenario(page, title) {
  console.log(`## ${title}`);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(3000);
  const flush = () => page.evaluate(() => window.flushSync());
  const text = (id) => page.evaluate((target) => document.getElementById(target)?.textContent, id);
  const checked = (id) => page.evaluate((target) => document.getElementById(target)?.checked, id);
  const value = (id) => page.evaluate((target) => document.getElementById(target)?.value, id);
  const click = async (id) => {
    await page.click(`#${id}`);
    await flush();
  };
  const fill = async (id, next) => {
    await page.fill(`#${id}`, next);
    await flush();
  };
  const dataState = (id) => page.evaluate((target) => document.getElementById(target)?.closest('label')?.dataset.state, id);
  const call = async (fn, ...args) => {
    await page.evaluate(([name, list]) => window.api[name](...list), [fn, args]);
    await flush();
  };
  try {
    await click('sw-bound');
    check('双向：子改父', (await text('sw-bound-state')) === 'true', await text('sw-bound-state'));
    check('双向：子组件自己的显示', (await dataState('sw-bound')) === 'on', await dataState('sw-bound'));
    await call('setOn', false);
    check('双向：父改子', (await checked('sw-bound')) === false && (await dataState('sw-bound')) === 'off');
    await click('sw-free');
    check('不传：组件自己持有', (await checked('sw-free')) === true && (await dataState('sw-free')) === 'on');
    await click('sw-ctrl');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await flush();
    check('受控：没采纳，父级不变', (await text('sw-ctrl-state')) === 'false', await text('sw-ctrl-state'));
    check('受控：没采纳，子组件退回', (await dataState('sw-ctrl')) === 'off', await dataState('sw-ctrl'));
    check('受控：没采纳，原生 checked 也退回', (await checked('sw-ctrl')) === false, await checked('sw-ctrl'));
    await call('setAllow', true);
    await click('sw-ctrl');
    check('受控：采纳后生效', (await text('sw-ctrl-state')) === 'true' && (await checked('sw-ctrl')) === true);
    await fill('field', '你好');
    check('转交两层到原生元素', (await text('field-state')) === '你好', await text('field-state'));
    check('textarea 跟着变', (await value('area')) === '你好', await value('area'));
    check('嵌套字段初值', (await value('city')) === '北京', await value('city'));
    await fill('city', '上海');
    check('嵌套字段写回', (await text('city-state')) === '上海', await text('city-state'));
    check('换算：初值', (await value('temp')) === '32', await value('temp'));
    await fill('temp', '212');
    check('换算：写回', Number(await text('temp-state')) === 100, await text('temp-state'));
    check('多选组：初值', (await checked('g-a')) === true && (await checked('g-b')) === false);
    await click('g-b');
    check('多选组：加入', (await text('g-state')) === 'a,b', await text('g-state'));
    await click('g-a');
    check('多选组：移除', (await text('g-state')) === 'b', await text('g-state'));
    await fill('trim', '  x  ');
    check('去空格', (await text('trim-state')) === '[x]', await text('trim-state'));
    check('Tabs：受控初值', (await text('panel')) === 'a', await text('panel'));
    await click('tab-b');
    check('Tabs：点击写回', (await text('panel')) === 'b', await text('panel'));
    await call('setTab', 'a');
    check('Tabs：父改', (await text('panel')) === 'a', await text('panel'));
    check('Tabs：不传，默认第一个', (await text('free-panel')) === 'x', await text('free-panel'));
    await click('free-y');
    check('Tabs：不传，自己持有', (await text('free-panel')) === 'y', await text('free-panel'));
    await click('toggle');
    check('组合函数返回的壳是活的', (await text('toggle-state')) === 'true', await text('toggle-state'));
    // 合并
    const merged = await page.evaluate(() => {
      const el = document.getElementById('merged');
      return { cls: el.className, type: el.type, busy: el.getAttribute('aria-busy') };
    });
    check('merge：class 拼接、库的属性保留', merged.cls.includes('base') && merged.cls.includes('user') && merged.type === 'button' && merged.busy === 'false', merged);
    await click('merged');
    check('merge：使用方事件执行', (await text('clicks')) === '1', await text('clicks'));
    await call('setLoading', true);
    check('响应式 prop 穿过组件', (await page.evaluate(() => document.getElementById('merged').getAttribute('aria-busy'))) === 'true');
    await click('merged');
    check('merge：受管层 preventDefault 跳过使用方', (await text('clicks')) === '1', await text('clicks'));
    // 样式
    const style = () =>
      page.evaluate(() => {
        const el = document.getElementById('styled');
        const css = getComputedStyle(el);
        return { width: css.width, weight: css.fontWeight, padding: css.paddingTop, cls: [...el.classList], on: el.classList.contains('on') };
      });
    let styled = await style();
    check('sx：静态、条件、动态值都生效', styled.width === '10px' && styled.weight === '700' && styled.padding === '3px', styled);
    check('class 数组里的函数', styled.on === true, styled);
    await page.evaluate(() => {
      document.getElementById('styled').classList.add('third-party');
    });
    await call('setWidth', '33px');
    styled = await style();
    check('sx：动态值更新', styled.width === '33px', styled);
    await call('setActive', false);
    styled = await style();
    check('sx：条件项去掉', styled.weight !== '700', styled);
    check('class 函数项去掉，第三方类还在', styled.on === false && styled.cls.includes('third-party'), styled);
    // 列表
    const listed = () => page.evaluate(() => [...document.querySelectorAll('#rows li')].map((li) => `${li.dataset.index}:${li.textContent}`).join());
    check('列表：初值', (await listed()) === '0:a,1:b', await listed());
    const firstRow = await page.evaluateHandle(() => document.querySelector('#rows li'));
    await call('renameFirst', 'A');
    check('列表：同 key 数据变了，行复用', (await listed()) === '0:A,1:b' && (await page.evaluate((el) => el === document.querySelector('#rows li'), firstRow)), await listed());
    await call('addRow', 'c');
    check('列表：加一行', (await listed()) === '0:A,1:b,2:c', await listed());
    await call('swapRows');
    check('列表：重排，下标跟着变', (await listed()) === '0:c,1:b,2:A', await listed());
    check('列表：行节点复用', await page.evaluate((el) => el === document.querySelector('#rows li:last-child'), firstRow));
    // 条件
    check('when：初值', (await text('who-name')) === '张三');
    const nameNode = await page.evaluateHandle(() => document.getElementById('who-name'));
    await call('setUser', '李四');
    check('when：真假不变不重建分支', (await text('who-name')) === '李四' && (await page.evaluate((el) => el === document.getElementById('who-name'), nameNode)));
    await call('clearUser');
    check('when：变成空', (await text('who-none')) === '无' && (await text('who-name')) === undefined);
    // select
    check('select：初值', (await value('pick')) === 'b', await value('pick'));
    await page.selectOption('#pick', 'a');
    await flush();
    await call('setPick', 'b');
    check('select：父改', (await value('pick')) === 'b', await value('pick'));
    // SVG
    const svg = await page.evaluate(() => {
      const path = document.querySelector('#icon path');
      return { ns: path.namespaceURI, d: path.getAttribute('d') };
    });
    check('SVG：命名空间和动态属性', svg.ns.endsWith('svg') && svg.d === 'M1 1', svg);
    // id
    const ids = await page.evaluate(() => [...document.querySelectorAll('label[for]')].map((label) => [label.htmlFor, label.nextElementSibling.id]));
    check('useId：label 和 input 对得上', ids.length === 2 && ids.every(([a, b]) => a && a === b) && ids[0][0] !== ids[1][0], ids);
    check('没有报错', errors.length === 0, errors);
  } catch (error) {
    check(`中断：${String(error.message).slice(0, 200)}`, false, errors);
  }
}

// 纯客户端
{
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ content: clientCode });
  await page.evaluate(() => void window.startMount());
  await scenario(page, '客户端挂载');
  await page.close();
}

// 服务端渲染再接管：同一份组件，不分两份产物
{
  console.log('## 服务端渲染');
  const { render } = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
  const { body, head } = render();
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head>${head}</head><body><div id="ssr">${body}</div></body></html>`);
  const first = await page.evaluate(() => {
    const styled = getComputedStyle(document.getElementById('styled'));
    return {
      city: document.getElementById('city').value,
      temp: document.getElementById('temp').value,
      ga: document.getElementById('g-a').checked,
      gb: document.getElementById('g-b').checked,
      pick: document.getElementById('pick').value,
      panel: document.getElementById('panel').textContent,
      rows: document.querySelectorAll('#rows li').length,
      who: document.getElementById('who-name')?.textContent,
      width: styled.width,
      weight: styled.fontWeight,
      labels: [...document.querySelectorAll('label[for]')].map((label) => label.htmlFor),
    };
  });
  check('没有 JS 时内容、表单值、样式都对', first.city === '北京' && first.temp === '32' && first.ga === true && first.gb === false && first.pick === 'b' && first.panel === 'a' && first.rows === 2 && first.who === '张三' && first.width === '10px' && first.weight === '700', first);
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.getElementById('ssr'));
    window.nodes = [];
    while (walker.nextNode()) window.nodes.push(walker.currentNode);
    window.mutations = [];
    window.observer = new MutationObserver((records) => window.mutations.push(...records.map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)));
    window.observer.observe(document.getElementById('ssr'), { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.addScriptTag({ content: clientCode });
  const before = await page.evaluate(() => {
    window.startHydrate();
    return document.querySelectorAll('[id]').length;
  });
  const result = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const all = [...window.mutations, ...window.observer.takeRecords().map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)];
    const walker = document.createTreeWalker(document.getElementById('ssr'));
    const now = [];
    while (walker.nextNode()) now.push(walker.currentNode);
    return { all, same: now.length === window.nodes.length && now.every((node, i) => node === window.nodes[i]), labels: [...document.querySelectorAll('label[for]')].map((label) => [label.htmlFor, label.nextElementSibling.id]) };
  });
  check('接管：0 次 DOM 改动', result.all.length === 0, result.all.slice(0, 10));
  check('接管：节点都是服务端那些', result.same);
  check('接管：useId 两边一致', result.labels.every(([a, b]) => a && a === b), result.labels);
  void before;
  await page.evaluate(() => document.getElementById('ssr').setAttribute('data-hydrated', ''));
  await scenario(page, '接管之后的行为');
  await page.close();
}

// 写了调用就只取一次：这条路线最大的坑，开发期能提示多少
{
  console.log('## 忘了写成函数');
  const code = await bundle(`import { flushSync, mount, sig, warnings } from 'hilt';
function Bad() { const count = sig(1); window.setCount = (n) => count.set(n); return <p id="bad" title={count()}>{count()}</p>; }
function Good() { const count = sig(1); window.setGood = (n) => count.set(n); return <p id="good" title={() => String(count())}>{count}</p>; }
function RowBad() { const count = sig(1); window.setRow = (n) => count.set(n); return <ul>{[1].map(() => <li id="row-bad">{count()}</li>)}</ul>; }
window.flushSync = flushSync; window.warnings = warnings;
mount(() => <div><Bad /><Good /><RowBad /></div>, document.body);`);
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ content: code });
  const out = await page.evaluate(() => {
    window.setCount(2);
    window.setGood(2);
    window.setRow(2);
    window.flushSync();
    return { bad: document.getElementById('bad').textContent, good: document.getElementById('good').textContent, row: document.getElementById('row-bad').textContent, warned: window.warnings.length };
  });
  check('{count} 是活的', out.good === '2', out);
  check('{count()} 不更新（预期如此）', out.bad === '1', out);
  check('组件体里写 {count()}、title={count()}：开发期有提示', out.warned >= 2, out);
  console.log(`     提示 ${out.warned} 条`);
  await page.close();
}

await browser.close();
console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;
