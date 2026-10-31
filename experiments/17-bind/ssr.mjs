// 各方案的壳能否服务端渲染再接管，以及编译成本。node 17-bind/ssr.mjs
import { readFile, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launch, median } from '../lib/browser.mjs';
import { compile } from '../03-publish/packages/compiler/index.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const hiltPath = here('./hilt.ts').replaceAll('\\', '/');

async function bundle(name, generate) {
  const server = generate === 'server';
  const twoWay = name !== 's0-runes';
  const autoBind = name === 's5-auto';
  const entry = server
    ? `import { component, renderToString } from '@hilt/runtime'; import { App } from './cases/${name}.tsx'; export const render = () => renderToString(() => component(App, {}));`
    : `import { component, flushSync, hydrate } from '@hilt/runtime'; import { App } from './cases/${name}.tsx'; window.flushSync = flushSync; window.start = () => hydrate(() => component(App, {}), document.getElementById('ssr'));`;
  const result = await build({
    stdin: { contents: entry, resolveDir: here('.'), loader: 'tsx' },
    bundle: true,
    write: false,
    format: server ? 'esm' : 'iife',
    platform: server ? 'node' : 'browser',
    target: 'es2022',
    alias: {
      '@hilt/runtime': server ? here('./ssr-runtime.js') : here('../03-publish/packages/runtime/index.js'),
      '@hilt/css/abi': here('../10-css/engine/abi.ts'),
      '@hilt/css': here('../10-css/engine/runtime.ts'),
    },
    plugins: [
      {
        name: 'hilt',
        setup(b) {
          b.onLoad({ filter: /17-bind[\\/]cases[\\/].*\.tsx$/ }, async ({ path }) => ({
            contents: (await compile(await readFile(path, 'utf8'), path, { generate, ...(twoWay ? { twoWayFrom: hiltPath, autoBind } : {}) })).code,
            loader: 'js',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

const browser = await launch();
const names = (await readdir(here('./cases'))).map((file) => file.replace('.tsx', ''));
console.log('## 服务端渲染再接管\n');
for (const name of names) {
  try {
    const serverCode = await bundle(name, 'server');
    const clientCode = await bundle(name, 'client');
    const { render } = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
    const body = render();
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(`<!doctype html><html><body><div id="ssr">${body}</div></body></html>`);
    const before = await page.evaluate(() => ({ city: document.getElementById('city').value, temp: document.getElementById('temp').value, ga: document.getElementById('g-a').checked, gb: document.getElementById('g-b').checked }));
    await page.evaluate(() => {
      window.mutations = [];
      window.observer = new MutationObserver((records) => window.mutations.push(...records.map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)));
      window.observer.observe(document.getElementById('ssr'), { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await page.addScriptTag({ content: clientCode });
    await page.evaluate(() => void window.start());
    const mutations = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [...window.mutations, ...window.observer.takeRecords().map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)];
    });
    await page.click('#sw-bound');
    await page.evaluate(() => window.flushSync());
    const bound = await page.evaluate(() => document.getElementById('sw-bound-state').textContent);
    await page.fill('#city', '上海');
    await page.evaluate(() => window.flushSync());
    const city = await page.evaluate(() => document.getElementById('city-state').textContent);
    const good = before.city === '北京' && before.temp === '32' && before.ga === true && before.gb === false && mutations.length === 0 && bound === 'true' && city === '上海' && errors.length === 0;
    console.log(`${good ? 'ok  ' : 'FAIL'} ${name}：首屏值 ${JSON.stringify(before)}，接管改动 ${mutations.length}，接管后双向 ${bound}/${city}${errors.length ? `，错误 ${errors[0]}` : ''}${mutations.length ? ` ${mutations.slice(0, 6).join(' ')}` : ''}`);
    await page.close();
  } catch (error) {
    console.log(`FAIL ${name}：${String(error.message).split('\n')[0].slice(0, 300)}`);
  }
}
await browser.close();

console.log('\n## 编译成本（Babel 原型编译器，50 轮中位数，每个文件）\n\n| 文件 | ms |\n| --- | --- |');
for (const name of names) {
  const path = here(`./cases/${name}.tsx`);
  const source = await readFile(path, 'utf8');
  const options = name === 's0-runes' ? {} : { twoWayFrom: hiltPath, autoBind: name === 's5-auto' };
  const samples = [];
  for (let round = -10; round < 50; round++) {
    const start = performance.now();
    await compile(source, path, options);
    if (round >= 0) samples.push(performance.now() - start);
  }
  console.log(`| ${name} | ${median(samples).toFixed(2)} |`);
}
