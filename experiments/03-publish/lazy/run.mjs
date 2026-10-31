// node 03-publish/lazy/run.mjs：懒加载与推迟接管
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launch } from '../../lib/browser.mjs';
import { compile } from '../packages/compiler/index.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

async function bundle(contents, generate) {
  const result = await build({
    stdin: { contents, resolveDir: here('.'), loader: 'tsx' },
    bundle: true,
    write: false,
    format: generate === 'server' ? 'esm' : 'iife',
    platform: generate === 'server' ? 'node' : 'browser',
    target: 'es2022',
    alias: { '@hilt/runtime': here(`../packages/runtime/${generate === 'server' ? 'server.js' : 'index.js'}`) },
    plugins: [
      {
        name: 'hilt',
        setup(b) {
          b.onLoad({ filter: /(app|heavy)\.tsx$/ }, async ({ path }) => ({
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

const serverCode = await bundle(
  `import { component, preloadLazy, renderToString } from '@hilt/runtime'; import { App } from './app.tsx';
   export const render = async () => { await preloadLazy(); return renderToString(() => component(App, {})); };`,
  'server',
);
const clientCode = await bundle(
  `import { component, flushSync, hydrate, mount } from '@hilt/runtime'; import { App } from './app.tsx';
   window.flushSync = flushSync;
   const host = document.getElementById('app');
   window.dispose = window.__mode === 'hydrate' ? hydrate(() => component(App, {}), host) : mount(() => component(App, {}), host);`,
  'client',
);
const { render } = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
const html = await render();

const browser = await launch();
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
const sleep = (page, ms) => page.waitForTimeout(ms);
const ready = async (page) => {
  await page.evaluate(() => window.flushSync());
  await sleep(page, 60);
  await page.evaluate(() => window.flushSync());
};

console.log('--- 纯客户端 ---');
{
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  page.on('pageerror', (error) => console.log('pageerror', error.message));
  await page.setContent('<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  await page.evaluate(() => {
    window.log = { heavyLoaded: 0 };
    window.__mode = 'mount';
  });
  await page.addScriptTag({ content: clientCode });
  check('加载完成前还没有内容', (await page.locator('#on-load').count()) === 0);
  await sleep(page, 260);
  await ready(page);
  check('加载后内容出现', (await page.locator('#on-load').innerText()) === 'load:0', await page.locator('#on-load').count());
  check('多个实例只加载一次模块', (await page.evaluate(() => window.log.heavyLoaded)) === 1, await page.evaluate(() => window.log));
  check('懒加载的组件看得到外层 context', (await page.locator('#on-load').getAttribute('data-theme')) === 'dark');
  await page.click('#on-load');
  await ready(page);
  check('功能正常', (await page.locator('#on-load').innerText()) === 'load:1');
  await page.close();
}

console.log('--- 推迟接管 ---');
{
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  page.on('pageerror', (error) => console.log('pageerror', error.message));
  await page.setContent(`<!doctype html><html><head></head><body><div id="app">${html}</div></body></html>`);
  await page.evaluate(() => {
    window.log = { heavyLoaded: 0 };
    window.__mode = 'hydrate';
    window.__nodes = new Map([...document.querySelectorAll('button')].map((el) => [el.id, el]));
    window.__mutations = [];
    new MutationObserver((records) => window.__mutations.push(...records.map((r) => r.type))).observe(document.getElementById('app'), { subtree: true, childList: true, attributes: true, characterData: true });
  });
  check('SSR 内容已在页面上，代码还没加载', (await page.locator('#on-interaction').innerText()) === 'click:0');
  await page.addScriptTag({ content: clientCode });
  check('接管开始时模块还没执行', (await page.evaluate(() => window.log.heavyLoaded)) === 0);
  await sleep(page, 260);
  await ready(page);
  check('load：代码到了就接管', (await page.evaluate(() => window.log.heavyLoaded)) === 1);
  await page.click('#on-load');
  await ready(page);
  check('load：接管后能用', (await page.locator('#on-load').innerText()) === 'load:1', await page.locator('#on-load').innerText());

  // idle 在空闲时接管，visible 还在视口外不接管
  const before = await page.locator('#on-visible').innerText();
  await page.evaluate(() => document.getElementById('on-visible').click());
  await ready(page);
  check('visible：视口外没接管，点了没反应', (await page.locator('#on-visible').innerText()) === before);
  await page.locator('#on-visible').scrollIntoViewIfNeeded();
  await sleep(page, 320);
  await page.click('#on-visible');
  await ready(page);
  check('visible：进入视口后接管', (await page.locator('#on-visible').innerText()) === 'visible:1', await page.locator('#on-visible').innerText());

  await sleep(page, 260);
  await page.click('#on-idle');
  await ready(page);
  check('idle：空闲时接管', (await page.locator('#on-idle').innerText()) === 'idle:1', await page.locator('#on-idle').innerText());

  // 用户的第一下不能丢
  await page.click('#on-interaction');
  await sleep(page, 260);
  await ready(page);
  check('interaction：第一下点击在接管后重放', (await page.locator('#on-interaction').innerText()) === 'click:1', await page.locator('#on-interaction').innerText());
  check('interaction：回调传到父级', (await page.evaluate(() => window.api.hits())) === 1);
  check('interaction：元素还是服务端那个', await page.evaluate(() => document.getElementById('on-interaction') === window.__nodes.get('on-interaction')));
  await page.click('#on-interaction');
  await ready(page);
  check('interaction：之后正常', (await page.locator('#on-interaction').innerText()) === 'click:2');

  // 等待期间 prop 变了
  await page.evaluate(() => window.api.setLabel('NEW'));
  await ready(page);
  await page.click('#on-changed');
  await sleep(page, 260);
  await ready(page);
  // 用户点的是已经过时、被替换掉的元素：不重放到新内容上，这一下有意丢弃
  check('等待期间 prop 变了：重新渲染显示新值，那次点击丢弃', (await page.locator('#on-changed').innerText()) === 'NEW:0', await page.locator('#on-changed').innerText());
  await page.click('#on-changed');
  await ready(page);
  check('重新渲染后的内容正常工作', (await page.locator('#on-changed').innerText()) === 'NEW:1', await page.locator('#on-changed').innerText());

  // 接管之前组件被卸载
  await page.evaluate(() => window.api.setCancelled(false));
  await ready(page);
  check('还没接管就卸载：内容没了', (await page.locator('#on-cancelled').count()) === 0, await page.locator('#on-cancelled').count());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await sleep(page, 50);
  check('卸载后没有报错', errors.length === 0, errors);
  await page.close();
}

await browser.close();
