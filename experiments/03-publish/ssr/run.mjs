// node 03-publish/ssr/run.mjs：同一份组件两种产物 → 服务端出 HTML → 浏览器接管，断言不重建 DOM、之后能正常更新
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launch } from '../../lib/browser.mjs';
import { compile } from '../packages/compiler/index.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const runtimeDir = here('../packages/runtime/');

async function bundle(entry, generate) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: generate === 'server' ? 'esm' : 'iife',
    platform: generate === 'server' ? 'node' : 'browser',
    target: 'es2022',
    alias: { '@hilt/runtime': `${runtimeDir}${generate === 'server' ? 'server.js' : 'index.js'}`, '@hilt/css/abi': here('../../10-css/engine/abi.ts'), '@hilt/css': here('../../10-css/engine/runtime.ts') },
    plugins: [
      {
        name: 'hilt',
        setup(b) {
          b.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
            contents: (await compile(await readFile(path, 'utf8'), path, { generate })).code,
            loader: 'js',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

const serverCode = await bundle(here('./server-entry.tsx'), 'server');
const clientCode = await bundle(here('./client-entry.tsx'), 'client');
const { render } = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
const rendered = render();
console.log(`服务端渲染 ${rendered.ms.toFixed(2)} ms，HTML ${rendered.body.length} 字节`);
console.log(rendered.body.slice(0, 700));

const browser = await launch();
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);

const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on('pageerror', (error) => console.log('pageerror', error.message));
await page.setContent(`<!doctype html><html><head>${rendered.head}</head><body><div id="app">${rendered.body}</div></body></html>`);

// 接管前记下全部节点，并监听任何 DOM、CSSOM 改动
await page.evaluate(() => {
  window.__mode = 'hydrate';
  const walker = document.createTreeWalker(document.getElementById('app'));
  window.__nodes = [];
  while (walker.nextNode()) window.__nodes.push(walker.currentNode);
  window.__mutations = [];
  window.__observer = new MutationObserver((records) => window.__mutations.push(...records.map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)));
  window.__observer.observe(document.getElementById('app'), { subtree: true, childList: true, attributes: true, characterData: true });
  window.__inserted = 0;
  const original = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function (...args) {
    window.__inserted++;
    return original.apply(this, args);
  };
});
const visible = await page.evaluate(() => document.getElementById('text').textContent);
check('没有 JS 时内容已经在页面上', visible.includes('前 1 中 2 后'), visible);
await page.addScriptTag({ content: clientCode });
await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
const mutations = await page.evaluate(() => {
  window.__observer.takeRecords().forEach((r) => window.__mutations.push(`${r.type}:${r.target.nodeName}`));
  return window.__mutations;
});
check('接管时没有任何 DOM 改动', mutations.length === 0, mutations.slice(0, 8));
const same = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.getElementById('app'));
  const now = [];
  while (walker.nextNode()) now.push(walker.currentNode);
  return now.length === window.__nodes.length && now.every((node, index) => node === window.__nodes[index]);
});
check('接管后节点还是原来那些', same);
check('接管时不重新插样式规则', (await page.evaluate(() => window.__inserted)) === 0, await page.evaluate(() => window.__inserted));
console.log(`接管耗时 ${(await page.evaluate(() => window.__hydrateMs)).toFixed(2)} ms`);

const flush = () => page.evaluate(() => window.flushSync());
const text = (selector) => page.locator(selector).innerText();
const attr = (selector, name) => page.locator(selector).getAttribute(name);
const call = async (name, value) => {
  await page.evaluate(([n, v]) => window.api[n](v), [name, value]);
  await flush();
};

check('服务端样式已生效', (await page.evaluate(() => getComputedStyle(document.getElementById('box')).color)) === 'rgb(255, 0, 0)');
check('服务端动态样式已生效', (await page.evaluate(() => getComputedStyle(document.getElementById('box')).width)) === '10px');
check('合并后的 class', (await attr('#btn', 'class'))?.split(' ').join() === 'base,btn,user', await attr('#btn', 'class'));

await call('setCount', 5);
check('文本段独立更新', (await text('#text')) === '前 5 中 10 后', await text('#text'));
check('相邻动态文本', (await text('#adjacent')) === '510', await text('#adjacent'));
check('属性更新', (await attr('#root', 'data-count')) === '5');
check('组件 children 里的文本', (await text('#btn')).includes('保存 5'), await text('#btn'));
check('分支里的文本', (await text('#branch')) === '分支 5', await text('#branch'));
check('片段里的文本', (await page.evaluate(() => document.getElementById('frag1').parentNode.textContent)).includes('片段5片段2'), await page.evaluate(() => document.getElementById('frag1').parentNode.textContent.slice(0, 200)));
check('列表后面的文本', (await text('#tail')).includes('结尾 5'), await text('#tail'));

await call('setEmpty', '有了');
check('空字符串后来有内容', (await text('#empty')) === '[有了]', await text('#empty'));
await call('setEmpty', '');
check('再变回空', (await text('#empty')) === '[]', await text('#empty'));

await page.click('#btn');
await flush();
check('事件接上了：使用方的', (await page.evaluate(() => window.api.read().count)) === 6);
check('事件接上了：库内部的', (await attr('#btn', 'data-clicks')) === '1');

await page.check('#sw input');
await flush();
check('双向绑定接上了', (await page.evaluate(() => window.api.read().on)) === true && (await text('#state')) === '开');

await call('setLoading', true);
check('按钮内部的分支出现', (await page.locator('#btn .spinner').count()) === 1 && (await attr('#btn', 'aria-busy')) === 'true');
check('其他子节点没丢', (await text('#btn')).includes('保存'), await text('#btn'));
await call('setLoading', false);
check('按钮内部的分支消失', (await page.locator('#btn .spinner').count()) === 0);

await call('setShow', false);
check('分支切换', (await page.locator('#branch').count()) === 0 && (await text('#other')) === '另一个');
check('&& 分支消失', (await page.locator('#and').count()) === 0);
await call('setShow', true);
check('分支切回', (await page.locator('#branch').count()) === 1 && (await page.locator('#and').count()) === 1);

await call('setWidth', '50px');
check('动态样式更新', (await page.evaluate(() => getComputedStyle(document.getElementById('box')).width)) === '50px');

check('context', (await text('#eager')) === 'dark');
await call('setLate', true);
check('context：接管后才建的分支', (await text('#late')) === 'dark', await text('#late'));

await call('push', 'c');
check('列表接管后能增加', (await page.locator('#list li').allInnerTexts()).join() === 'a,b,c', await page.locator('#list li').allInnerTexts());
const firstLi = await page.evaluateHandle(() => document.querySelector('#list li'));
await call('swap');
check('列表能重排', (await page.locator('#list li').allInnerTexts()).join() === 'c,b,a');
check('重排复用接管来的节点', await page.evaluate((node) => node === document.querySelectorAll('#list li')[2], firstLi));
check('列表后面的文本没被挤走', (await text('#tail')).includes('结尾'), await text('#tail'));
await call('clear');
check('列表能清空', (await page.locator('#list li').count()) === 0 && (await page.locator('#tail a').count()) === 0);
await call('push', 'd');
check('清空后还能加', (await page.locator('#list li').allInnerTexts()).join() === 'd');

// 和纯客户端渲染的结果比：结构、文本一致（注释和生成的类名除外）
const structure = (root) => {
  const out = [];
  const visit = (node) => {
    if (node.nodeType === 8) return;
    if (node.nodeType === 3) {
      if (node.data) out.push(`#${node.data}`);
      return;
    }
    const attrs = [...node.attributes].filter((a) => a.name !== 'class' && a.name !== 'style').map((a) => `${a.name}=${a.value}`).sort();
    out.push(`<${node.tagName} ${attrs.join(' ')}>`);
    node.childNodes.forEach(visit);
    out.push(`</${node.tagName}>`);
  };
  root.childNodes.forEach(visit);
  return out.join('');
};
const clientPage = await browser.newPage();
await clientPage.setContent('<!doctype html><html><head></head><body><div id="app"></div></body></html>');
await clientPage.addScriptTag({ content: clientCode });
const serverPage = await browser.newPage();
await serverPage.setContent(`<!doctype html><html><head></head><body><div id="app">${rendered.body}</div></body></html>`);
const expected = await clientPage.evaluate(`(${structure.toString()})(document.getElementById('app'))`);
const actual = await serverPage.evaluate(`(${structure.toString()})(document.getElementById('app'))`);
// 相邻文本：客户端是两个文本节点，服务端也是（靠空注释隔开），这里连起来比
const flat = (value) => value.replaceAll('#', '');
check('服务端输出与纯客户端渲染结构一致', flat(expected) === flat(actual), { expected: flat(expected).slice(0, 600), actual: flat(actual).slice(0, 600) });

await browser.close();
