// node 14-integrated/run.mjs：内核、深代理、属性、样式、水合接到一起之后的行为（Chromium）
import { launch, openPage } from '../lib/browser.mjs';
import { bundle } from './bundle.mjs';

let failed = 0;
const check = (label, passed, detail) => {
  if (!passed) failed++;
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
};

const clientCode = await bundle('./client.tsx', 'client');
const serverCode = await bundle('./server.tsx', 'server');
const server = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
const browser = await launch();
const errors = [];

async function fresh() {
  const page = await openPage(browser, clientCode);
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}
const text = (page, id) => page.evaluate((target) => document.getElementById(target)?.textContent ?? null, id);
const flush = (page) => page.evaluate(() => window.app.flushSync());

// ---- context ----
{
  console.log('## 组件不占节点 + 原型链 context');
  const page = await fresh();
  await page.evaluate(() => window.mountCase('ContextCase'));
  check('子树读到 provider 的值', (await text(page, 'ctx-wrap')) === 'wrap');
  check('provider 直接返回 children 也读得到（不用包一层元素）', (await text(page, 'ctx-bare')) === 'bare', await text(page, 'ctx-bare'));
  check('兄弟组件读不到别人 provide 的值', (await text(page, 'ctx-sibling')) === 'none', await text(page, 'ctx-sibling'));
  await page.evaluate(() => window.contextApi.showLate());
  await flush(page);
  check('之后才创建的分支读得到', (await text(page, 'ctx-late')) === 'wrap', await text(page, 'ctx-late'));
  check('列表行读得到', (await text(page, 'ctx-row-1')) === 'wrap');
  await page.evaluate(() => window.contextApi.addRow());
  await flush(page);
  check('之后才创建的行读得到', (await text(page, 'ctx-row-3')) === 'wrap', await text(page, 'ctx-row-3'));
  await page.close();
}

// ---- 销毁 ----
{
  console.log('## 组件不占节点：销毁跟着所在分支');
  const page = await fresh();
  await page.evaluate(() => window.mountCase('LifetimeCase'));
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.app.log)));
  let log = await state();
  check('_effect 挂载后执行', ['run:branch', 'run:a', 'run:b'].every((name) => log.effects.includes(name)), log.effects);
  await page.evaluate(() => window.lifetimeApi.hide());
  await flush(page);
  log = await state();
  check('分支销毁：组件的 onCleanup 跑了一次', log.cleanups.filter((name) => name === 'branch').length === 1, log.cleanups);
  check('分支销毁：_effect 的清理跑了', log.effects.includes('stop:branch'), log.effects);
  check('其他组件没动', !log.cleanups.includes('a') && !log.cleanups.includes('b'), log.cleanups);
  await page.evaluate(() => window.lifetimeApi.drop());
  await flush(page);
  log = await state();
  check('列表行销毁：只有那一行', log.cleanups.includes('a') && !log.cleanups.includes('b'), log.cleanups);
  await page.evaluate(() => window.lifetimeApi.show());
  await flush(page);
  log = await state();
  check('重新显示：新实例的 _effect 跑了', log.effects.filter((name) => name === 'run:branch').length === 2, log.effects);
  await page.evaluate(() => {
    window.lifetimeApi.flicker();
    window.app.flushSync();
  });
  log = await state();
  check('挂上又立刻撤掉：_effect 第一次执行之前作废', !log.effects.includes('run:quick'), log.effects);
  check('挂上又立刻撤掉：onCleanup 仍然跑', log.cleanups.includes('quick'), log.cleanups);
  await page.close();
}

// ---- 外层先于内层 ----
{
  console.log('## 外层条件先于内层');
  const page = await fresh();
  const before = errors.length;
  await page.evaluate(() => window.mountCase('GlitchCase'));
  check('初值', (await text(page, 'profile')) === 'n1');
  await page.evaluate(() => window.glitchApi.clear());
  await flush(page);
  check('外层条件不成立：内层不会读到 null', errors.length === before && (await text(page, 'no-user')) === '无', errors.slice(before));
  await page.evaluate(() => window.glitchApi.set('n2'));
  await flush(page);
  check('恢复', (await text(page, 'profile')) === 'n2');
  await page.close();
}

// ---- 深代理 ----
{
  console.log('## 深代理 + 列表 + 绑定');
  const page = await fresh();
  await page.evaluate(() => window.mountCase('DeepCase'));
  const dom = () =>
    page.evaluate(() => [...document.querySelectorAll('#todos li')].map((li) => [li.querySelector('span').textContent, li.querySelector('input').checked, li.dataset.done]));
  check('初值', JSON.stringify(await dom()) === JSON.stringify([['a', false, 'false'], ['b', true, 'true']]), await dom());
  await page.evaluate(() => {
    window.mutated = 0;
    window.observer = new MutationObserver((records) => (window.mutated += records.length));
    window.observer.observe(document.getElementById('todos'), { subtree: true, childList: true, characterData: true, attributes: true });
    window.deepApi.rename(1, 'bb');
  });
  await flush(page);
  const mutated = await page.evaluate(() => {
    window.mutated += window.observer.takeRecords().length;
    return window.mutated;
  });
  check('改一个字段：只有一处 DOM 改动', mutated === 1, mutated);
  await page.click('#todos li:nth-child(1) input');
  await flush(page);
  const snapshot = await page.evaluate(() => window.deepApi.snapshot());
  check('勾选经 _bind 写回到行对象的属性', snapshot[0].done === true, snapshot);
  check('snapshot 是普通对象', JSON.stringify(snapshot[1]) === JSON.stringify({ id: 2, title: 'bb', done: true }), snapshot);
  await page.evaluate(() => window.deepApi.toggle(1));
  await page.evaluate(() => window.deepApi.setFilter('active'));
  await flush(page);
  check('派生列表跟着过滤', (await dom()).length === 1, await dom());
  await page.evaluate(() => window.deepApi.add('c'));
  await flush(page);
  check('push 之后派生列表更新', (await dom()).map((row) => row[0]).join() === 'bb,c', await dom());
  check('条件分支里的 .map 也是列表', (await page.evaluate(() => document.querySelectorAll('#empty u').length)) === 2);
  await page.close();
}

// ---- 属性 ----
{
  console.log('## 属性：编译路径、spread、服务端三边同形');
  const page = await fresh();
  const pairs = await page.evaluate(() => window.attrPairs());
  let compiledSame = 0;
  pairs.forEach(([spread, direct], index) => {
    if (JSON.stringify(spread) === JSON.stringify(direct)) compiledSame++;
    else check(`第 ${index} 组：编译路径和 spread 一致`, false, { spread, direct });
  });
  check(`编译路径和 spread 写出来一样（${compiledSame}/${pairs.length}）`, compiledSame === pairs.length);
  let serverSame = 0;
  for (let index = 0; index < server.attrCount; index++) {
    const [spreadHtml, directHtml] = server.attrHtml(index);
    if (spreadHtml !== directHtml) {
      check(`第 ${index} 组：服务端两条路一致`, false, { spreadHtml, directHtml });
      continue;
    }
    const parsed = await page.evaluate((html) => {
      const box = document.createElement('div');
      box.innerHTML = html;
      const el = box.firstElementChild;
      const attrs = Object.fromEntries([...el.attributes].map((attr) => [attr.name, attr.value]).sort());
      if (attrs.style) attrs.style = el.style.cssText;
      return { attrs, value: el.value, checked: el.checked };
    }, spreadHtml);
    if (JSON.stringify(parsed) === JSON.stringify(pairs[index][0])) serverSame++;
    else check(`第 ${index} 组：服务端解析后和客户端同形`, false, { html: spreadHtml, parsed, client: pairs[index][0] });
  }
  check(`服务端解析出来和客户端新建同形（${serverSame}/${server.attrCount}）`, serverSame === server.attrCount);
  await page.close();
}

// ---- 水合 ----
{
  console.log('## 水合：全部放在一起');
  await server.preloadLazy().catch(() => {});
  const { body, head } = server.renderCase('HydrateCase');
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const before = errors.length;
  await page.setContent(`<!doctype html><html><head>${head}</head><body><div id="ssr">${body}</div></body></html>`);
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.getElementById('ssr'));
    window.nodes = [];
    while (walker.nextNode()) window.nodes.push(walker.currentNode);
    window.mutations = [];
    window.observer = new MutationObserver((records) => window.mutations.push(...records.map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)));
    window.observer.observe(document.getElementById('ssr'), { subtree: true, childList: true, attributes: true, characterData: true });
    window.inserted = 0;
    const original = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function (...args) {
      window.inserted++;
      return original.apply(this, args);
    };
  });
  const firstPaint = await page.evaluate(() => {
    const root = document.getElementById('hydrate-root');
    return { width: getComputedStyle(root).width, weight: getComputedStyle(root).fontWeight, on: root.classList.contains('on'), h: root.style.getPropertyValue('--h') };
  });
  check('没有 JS 时 class、style、sx 都写进了同一个元素', firstPaint.width === '10px' && firstPaint.weight === '700' && firstPaint.on && firstPaint.h === '1', firstPaint);
  await page.addScriptTag({ content: clientCode });
  await page.evaluate(() => {
    window.hydrateCase('HydrateCase', document.getElementById('ssr'));
  });
  const result = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    window.mutations.push(...window.observer.takeRecords().map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`));
    const walker = document.createTreeWalker(document.getElementById('ssr'));
    const now = [];
    while (walker.nextNode()) now.push(walker.currentNode);
    return { mutations: window.mutations, inserted: window.inserted, sameNodes: now.length === window.nodes.length && now.every((node, index) => node === window.nodes[index]) };
  });
  check('接管时 0 次 DOM 改动', result.mutations.length === 0, result.mutations.slice(0, 10));
  check('接管时 0 次 insertRule', result.inserted === 0, result.inserted);
  check('所有节点都是服务端那些', result.sameNodes);
  check('没有报错', errors.length === before, errors.slice(before));
  const uid = await page.evaluate(() => [...document.querySelectorAll('label')].map((label) => [label.htmlFor, label.nextElementSibling.id]));
  check('useId：服务端和客户端的 label 与 input 对得上', uid.every(([a, b]) => a && a === b) && uid[0][0] !== uid[1][0], uid);
  await page.evaluate(() => window.hydrateApi.setOn(false));
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const after = await page.evaluate(() => ({
    main: document.getElementById('hydrate-root').className.includes(' on'),
    data: document.getElementById('hydrate-root').dataset.on,
    weight: getComputedStyle(document.getElementById('hydrate-root')).fontWeight,
    check: document.getElementById('h-check').checked,
    recipe: getComputedStyle(document.getElementById('h-recipe')).fontSize,
    disabled: document.getElementById('h-recipe').disabled,
    path: document.querySelector('#h-svg path').getAttribute('d'),
    pathClass: document.querySelector('#h-svg path').getAttribute('class'),
    branch: [!!document.getElementById('h-yes'), !!document.getElementById('h-no')],
    html: document.getElementById('h-html').innerHTML,
  }));
  check('接管后 class 更新', after.main === false, after);
  check('接管后 data 属性更新', after.data === 'false', after);
  check('接管后 sx 换类', after.weight !== '700', after);
  check('接管后 checked 更新', after.check === false, after);
  check('接管后配方的档位更新', after.recipe === '12px', after);
  check('接管后布尔属性更新', after.disabled === true, after);
  check('接管后 SVG 属性更新、class 还在', after.path === 'M1 1' && after.pathClass === 'p', after);
  check('接管后分支切换', after.branch[0] === false && after.branch[1] === true, after);
  check('接管后 innerHTML 没被重写', after.html === '<b>内</b>', after);
  await page.fill('#h-text', '输入');
  check('接管后 _bind 写回，textarea 跟着变', (await page.evaluate(() => document.getElementById('h-area').value)) === '输入');
  await page.evaluate(() => window.hydrateApi.add('z'));
  await page.evaluate(() => window.hydrateApi.setPick('z'));
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 10)));
  check('select：option 后来才出现也能选中', (await page.evaluate(() => document.getElementById('h-select').value)) === 'z');
  await page.evaluate(() => window.hydrateApi.setWidth('33px'));
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  check('接管后动态样式只改变量', (await page.evaluate(() => getComputedStyle(document.getElementById('hydrate-root')).width)) === '33px');
  await page.close();
}

// ---- 错误边界 ----
{
  console.log('## 错误边界');
  const page = await fresh();
  const before = errors.length;
  await page.evaluate(() => window.mountCase('BoundaryCase'));
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  check('渲染时抛错（隔两层）：显示 fallback', (await text(page, 'render-fallback')) === '渲染炸了', await text(page, 'render-fallback'));
  check('旁边的内容不受影响', (await text(page, 'boundary-sibling')) === '旁边');
  check('更新前正常', (await text(page, 'late-bomb')) === '1');
  await page.evaluate(() => window.boundaryApi.setTick(2));
  await flush(page);
  check('更新时抛错：显示 fallback', (await text(page, 'update-fallback')) === '更新炸了', await text(page, 'update-fallback'));
  check('上层没有报错', errors.length === before, errors.slice(before));
  await page.evaluate(() => {
    window.boundaryApi.setTick(3);
    window.boundaryApi.disarm();
  });
  await flush(page);
  await page.click('#update-fallback');
  await page.click('#render-fallback');
  await flush(page);
  check('重试：更新后的内容恢复', (await text(page, 'late-bomb')) === '3', await text(page, 'late-bomb'));
  check('重试：渲染后的内容恢复', (await text(page, 'bomb-safe')) === '安全', await text(page, 'bomb-safe'));
  await page.close();
  const rendered = server.renderCase('BoundaryCase').body;
  check('服务端：渲染抛错输出 fallback', rendered.includes('渲染炸了') && rendered.includes('旁边'), rendered);
}

// ---- 传送 ----
{
  console.log('## 传送');
  const page = await fresh();
  await page.evaluate(() => window.mountCase('PortalCase'));
  await flush(page);
  const parent = () => page.evaluate(() => document.getElementById('portaled')?.parentElement?.nodeName ?? null);
  check('内容在 body 下', (await parent()) === 'BODY', await parent());
  check('context 跟着原来的位置', (await text(page, 'portal-leaf')) === 'portal-theme', await text(page, 'portal-leaf'));
  await page.evaluate(() => window.portalApi.setLabel('二'));
  await flush(page);
  check('内容随状态更新', (await text(page, 'portaled')).startsWith('二'), await text(page, 'portaled'));
  const comments = () => page.evaluate(() => [...document.body.childNodes].filter((node) => node.nodeType === 8).length);
  const leftBefore = await comments();
  await page.evaluate(() => window.portalApi.setOpen(false));
  await flush(page);
  check('所在分支销毁：内容和标记都移除', (await parent()) === null && (await comments()) < leftBefore, { parent: await parent(), comments: await comments() });
  check('服务端不输出传送内容', !server.renderCase('PortalCase').body.includes('portaled'));
  await page.close();
}

// ---- 诊断 ----
{
  console.log('## 诊断');
  const page = await fresh();
  const before = await page.evaluate(() => window.app.warnings.length);
  await page.evaluate(() => window.mountCase('WarnCase'));
  check('组件体顶层读响应式数据：开发期有提示', (await page.evaluate(() => window.app.warnings.length)) === before + 1);
  await page.close();
}

await browser.close();
console.log(failed ? `\n${failed} 条失败` : '\n全部通过');
if (failed) process.exitCode = 1;
