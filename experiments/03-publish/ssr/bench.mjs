// node 03-publish/ssr/bench.mjs：服务端渲染、水合、纯客户端渲染的耗时，以及 HTML 体积（注释标记的代价）
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launch, median } from '../../lib/browser.mjs';
import { compile } from '../packages/compiler/index.mjs';

const N = 10_000;
const ROUNDS = 7;
const here = (path) => fileURLToPath(new URL(path, import.meta.url));

async function bundle(contents, generate) {
  const result = await build({
    stdin: { contents, resolveDir: here('.'), loader: 'tsx' },
    bundle: true,
    write: false,
    minify: true,
    format: generate === 'server' ? 'esm' : 'iife',
    platform: generate === 'server' ? 'node' : 'browser',
    target: 'es2022',
    alias: { '@hilt/runtime': here(`../packages/runtime/${generate === 'server' ? 'server.js' : 'index.js'}`) },
    plugins: [
      {
        name: 'hilt',
        setup(b) {
          b.onLoad({ filter: /bench-app\.tsx$/ }, async ({ path }) => ({
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
  `import { component, renderToString } from '@hilt/runtime'; import { App } from './bench-app.tsx';
   export const render = (n) => renderToString(() => component(App, { n }));`,
  'server',
);
const clientCode = await bundle(
  `import { component, hydrate, mount } from '@hilt/runtime'; import { App } from './bench-app.tsx';
   window.runHydrate = (n) => { const t = performance.now(); hydrate(() => component(App, { n }), document.getElementById('app')); return performance.now() - t; };
   window.runMount = (n) => { const t = performance.now(); mount(() => component(App, { n }), document.getElementById('app')); return performance.now() - t; };`,
  'client',
);
const { render } = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);

for (let i = 0; i < 3; i++) render(N);
const serverTimes = [];
let html = '';
for (let i = 0; i < ROUNDS; i++) {
  const start = performance.now();
  html = render(N);
  serverTimes.push(performance.now() - start);
}
const withoutMarks = html.replace(/<!--[^>]*-->/g, '');

const browser = await launch();
const hydrateTimes = [];
const mountTimes = [];
const layout = 'document.body.offsetHeight';
for (let i = 0; i < ROUNDS; i++) {
  let page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head></head><body><div id="app">${html}</div></body></html>`);
  await page.addScriptTag({ content: clientCode });
  hydrateTimes.push(await page.evaluate(({ n, layout: l }) => { const ms = window.runHydrate(n); eval(l); return ms; }, { n: N, layout }));
  await page.close();
  page = await browser.newPage();
  await page.setContent('<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: clientCode });
  mountTimes.push(await page.evaluate(({ n, layout: l }) => { const ms = window.runMount(n); eval(l); return ms; }, { n: N, layout }));
  await page.close();
}
await browser.close();

console.log(`${N} 行（${ROUNDS} 轮中位数，脚本时间）`);
console.log(`服务端渲染：${median(serverTimes).toFixed(1)} ms`);
console.log(`水合：${median(hydrateTimes).toFixed(1)} ms`);
console.log(`纯客户端渲染：${median(mountTimes).toFixed(1)} ms`);
console.log(`HTML：${(html.length / 1024).toFixed(0)} KB，其中注释标记 ${((html.length - withoutMarks.length) / 1024).toFixed(1)} KB（${(((html.length - withoutMarks.length) / html.length) * 100).toFixed(1)}%）`);
console.log(`gzip 后：${(Buffer.byteLength((await import('node:zlib')).gzipSync(html)) / 1024).toFixed(0)} KB`);
