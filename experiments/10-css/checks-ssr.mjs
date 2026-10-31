// SSR 的断言：node 10-css/run.mjs --only=ssr
// 服务端出 HTML + <style> → 浏览器无 JS 也有样式 → 客户端接管不重插规则、不改 DOM → 之后更新正常；规则表不无限增长；防闪烁脚本
import { bundle, here } from './lib.mjs';

export async function run({ browser, check }) {
  console.log('## SSR\n');
  const serverCode = await bundle(here('./cases/ssr-server.tsx'), { generate: 'server', minify: false });
  const clientCode = await bundle(here('./cases/ssr-client.tsx'), { minify: false });
  const server = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
  const rendered = server.render();
  console.log(`     服务端渲染 ${rendered.ms.toFixed(2)} ms，HTML ${rendered.body.length} 字节，样式标签 ${rendered.head.length} 字节`);
  const names = /data-names="([^"]*)"/.exec(rendered.head)[1].split(' ');
  console.log(`     样式标签：${names.length} 个名字（类名、关键帧、变量组、主题）：${names.join(' ')}`);

  check('样式标签带 data-names，包含用到的类、关键帧、变量组、两套候选主题', names.some((n) => n.startsWith('--s-colors')) && names.some((n) => n.startsWith('k')) && names.length >= 8, names);
  check('HTML 里的元素是变量写法的动态样式（服务端一律写成变量）', rendered.body.includes('--x-width:40px'), rendered.body.slice(0, 300));

  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', (error) => console.log('pageerror', error.message));
  page.on('console', (message) => message.type() === 'error' && console.log('console.error', message.text()));
  const html = (extraHead = '') => `<!doctype html><html><head>${rendered.boot}${rendered.head}${extraHead}</head><body><div id="app">${rendered.body}</div></body></html>`;
  await page.route('http://ssr.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html() }));

  // ---- 没有 JS：样式已生效；防闪烁脚本 ----
  await page.addInitScript(() => {
    window.__mode = 'hydrate';
  });
  await page.goto('http://ssr.test/');
  const computed = (id, prop) => page.evaluate(([i, p]) => getComputedStyle(document.getElementById(i))[p], [id, prop]);
  check('没有 JS 时静态与动态样式已生效（红色、宽 40px、字面量 sx）', (await computed('box', 'color')) === 'rgb(255, 0, 0)' && (await computed('box', 'width')) === '40px' && (await computed('literal', 'marginTop')) === '3px');
  check('没有 JS 时配方的档位样式已生效', (await computed('chip', 'fontSize')) === '11px');

  // 接管前记下全部节点，监听 DOM 与 CSSOM 改动
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.getElementById('app'));
    window.__nodes = [];
    while (walker.nextNode()) window.__nodes.push(walker.currentNode);
    window.__mutations = [];
    window.__observer = new MutationObserver((records) => window.__mutations.push(...records.map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)));
    // <head> 的子节点不观察：测试自己用 addScriptTag 往里加 <script>；新增 <style> 由下面的计数检查
    const all = { subtree: true, childList: true, attributes: true, characterData: true };
    window.__observer.observe(document.getElementById('app'), all);
    window.__observer.observe(document.querySelector('style[data-hilt-css]'), all);
    window.__observer.observe(document.documentElement, { attributes: true });
    window.__inserted = 0;
    const original = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function (...args) {
      window.__inserted++;
      return original.apply(this, args);
    };
    window.__styleCount = document.querySelectorAll('style').length;
  });
  const before = await page.evaluate(() => document.getElementById('app').innerHTML);
  await page.addScriptTag({ content: clientCode });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const mutations = await page.evaluate(() => {
    window.__observer.takeRecords().forEach((r) => window.__mutations.push(`${r.type}:${r.target.nodeName}`));
    return window.__mutations;
  });
  check('接管时没有任何 DOM 改动（含 head、style 标签）', mutations.length === 0, mutations.slice(0, 8));
  check('接管后节点还是原来那些，HTML 一字不差', await page.evaluate((b) => { const w = document.createTreeWalker(document.getElementById('app')); const now = []; while (w.nextNode()) now.push(w.currentNode); return now.length === window.__nodes.length && now.every((n, i) => n === window.__nodes[i]) && document.getElementById('app').innerHTML === b; }, before));
  check('接管时一条规则都没有重新插入（insertRule 0 次）', (await page.evaluate(() => window.__inserted)) === 0, await page.evaluate(() => window.__inserted));
  check('接管后只有一张引擎的 <style>，没有新增', (await page.evaluate(() => document.querySelectorAll('style[data-hilt-css]').length)) === 1 && (await page.evaluate(() => document.querySelectorAll('style').length === window.__styleCount)));
  console.log(`     接管耗时 ${(await page.evaluate(() => window.__hydrateMs)).toFixed(2)} ms`);

  // ---- 接管之后更新 ----
  const flush = () => page.evaluate(() => window.flushSync());
  const call = async (name, value) => {
    await page.evaluate(([n, v]) => window.api[n](v), [name, value]);
    await flush();
  };
  const classOf = (id) => page.evaluate((i) => document.getElementById(i).className, id);
  const boxClass = await classOf('box');
  await call('setWidth', '90px');
  check('接管后动态值更新：只改变量，类不变', (await computed('box', 'width')) === '90px' && (await classOf('box')) === boxClass);
  await call('setHot', true);
  check('接管后条件项更新：换类，使用方 class（user）还在', (await computed('box', 'fontWeight')) === '700' && (await classOf('box')).includes('user') && (await classOf('box')) !== boxClass);
  await call('setClass', 'user2');
  check('接管后使用方 class 更新', (await classOf('box')).includes('user2') && !(await classOf('box')).split(' ').includes('user'));
  await call('setSize', 'lg');
  check('接管后配方档位更新', (await computed('chip', 'fontSize')) === '15px');
  const insertedBefore = await page.evaluate(() => window.__inserted);
  await call('setExtra', true);
  check('接管后新出现的样式会插进同一张表', (await computed('extra', 'letterSpacing')) === '3px' && (await page.evaluate(() => window.__inserted)) > insertedBefore && (await page.evaluate(() => document.querySelectorAll('style[data-hilt-css]').length)) === 1);
  check('接管后 context 仍可用', (await page.evaluate(() => document.getElementById('ctx').textContent)) === 'dark');
  await page.close();

  // ---- 防闪烁：主题类在页面画出之前就在 <html> 上 ----
  const bootPage = async (scheme, stored) => {
    const p = await browser.newPage({ colorScheme: scheme });
    await p.route('http://ssr.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html() }));
    if (stored) await p.addInitScript((value) => localStorage.setItem('pref', value), stored);
    await p.goto('http://ssr.test/', { waitUntil: 'commit' });
    await p.waitForSelector('#page');
    // 没有加载客户端脚本：只有 boot 脚本跑过
    const result = await p.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.getElementById('page')).backgroundColor }));
    await p.close();
    return result;
  };
  const dark = await bootPage('dark', undefined);
  const light = await bootPage('dark', 'light');
  const systemLight = await bootPage('light', 'system');
  check('防闪烁：没存偏好 + 系统深色 → 首屏（没有任何应用 JS）就是深色底', dark.theme === 'dark' && dark.bg === 'rgb(10, 10, 10)', dark);
  check('防闪烁：存了 light 覆盖系统深色', light.theme === 'light' && light.bg === 'rgb(255, 255, 255)', light);
  check('防闪烁：存了 system + 系统浅色 → 浅色', systemLight.theme === 'light', systemLight);

  // ---- 规则表不随请求无限增长 ----
  const afterFirst = server.insertedCount();
  for (let i = 0; i < 300; i++) server.render({ width: `${i}px` });
  check('300 次请求（动态值每次不同）：规则表一条没多（动态值写成变量，不新增类）', server.insertedCount() === afterFirst, [afterFirst, server.insertedCount()]);
  for (let i = 0; i < 5000; i++) server.render({ literalWidth: 10 + i });
  const grown = server.insertedCount();
  console.log(`     5000 个请求各带一个不同的字面量 sx：规则表 ${afterFirst} → ${grown} 个名字`);
  check('字面量 sx 随请求内容变化：规则表有上限（volatile 限量）', grown < afterFirst + 2100, grown);
  // 被挤掉的规则，再次渲染时仍会补回来
  const again = server.render({ literalWidth: 10 });
  check('被限量挤掉的规则再次出现时会补回，不会输出没有样式的类', again.head.includes('margin-top:10px'), again.head.slice(0, 400));
  const recent = server.render({ literalWidth: 10 + 4999 });
  check('最近的请求规则在', recent.head.includes(`margin-top:${10 + 4999}px`));
}
