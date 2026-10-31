// 和 Vue 对比：组件库形态、服务端渲染、体积、转换成本。node 18-plain/vue-compare/run.mjs [--rounds=7]
// 列表基准走 05-compare/rows/run.mjs。每轮一个新页面，各版本交替跑。
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
import * as sfc35 from 'vue/compiler-sfc';
import { heapAfterGc, launch, median, openPage } from '../../lib/browser.mjs';
import { compileVue } from '../../05-compare/lib/compilers.mjs';
import { buildOptions } from '../../05-compare/lib/esbuild-plugin.mjs';
import { ALIAS, bundle as plainBundle } from '../bundle.mjs';
import './gen-vue.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const rounds = Number(process.argv.find((arg) => arg.startsWith('--rounds='))?.slice(9) ?? 7);

const vueEntry = (kind) => `import { ${kind === 'vapor36' ? 'createVaporApp as make' : 'createApp as make'}, nextTick } from 'vue';
import Switches from './vue/Switches.vue';
import Buttons from './vue/Buttons.vue';
const show = (App) => make(App).mount(document.body.appendChild(document.createElement('div')));
window.flush = nextTick;
window.runSwitches = () => show(Switches);
window.runButtons = () => show(Buttons);`;
async function bundleVue(kind) {
  const options = buildOptions(kind);
  const result = await build({
    stdin: { contents: vueEntry(kind), resolveDir: here('.'), loader: 'js' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
    conditions: ['browser', 'production'],
    ...options,
  });
  return result.outputFiles[0].text;
}
const plainEntry = `import { flushSync, merge, model, mount, sig, read } from 'hilt';
function Switch({ checked, label, ...rest }) {
  const on = model(checked, false);
  return <label data-state={() => (on() ? 'on' : 'off')}><input type="checkbox" {...rest} checked={on} />{label}</label>;
}
function SwitchRow() { const on = sig(false); (window.setters ??= []).push(() => on.toggle()); return <Switch label="x" checked={on} />; }
function Switches() { return <div>{window.ids.map(() => <SwitchRow />)}</div>; }
function Base({ children, ...rest }) { return <button {...merge(rest, { class: 'base', 'data-part': 'root' })}>{children}</button>; }
function Mid({ size = 'md', children, ...rest }) { return <Base {...merge(rest, { class: () => 'btn btn-' + read(size) })}>{children}</Base>; }
const noop = () => {};
function ButtonRow({ index, title }) { return <Mid id={'b' + index} size="md" title={title} onClick={noop}>保存</Mid>; }
function Buttons() { const title = sig('a'); window.setAll = (next) => title.set(next); return <div>{window.ids.map((item) => <ButtonRow index={item.i} title={title} />)}</div>; }
window.flush = async () => flushSync();
window.runSwitches = () => mount(() => <Switches />, document.body.appendChild(document.createElement('div')));
window.runButtons = () => mount(() => <Buttons />, document.body.appendChild(document.createElement('div')));`;

const VARIANTS = [
  ['Vue 3.5 虚拟 DOM', await bundleVue('vdom35')],
  ['Vue 3.6 Vapor', await bundleVue('vapor36')],
  ['hilt 标准 JSX', await plainBundle(plainEntry, { minify: true })],
];
console.log('## 产物（同一组组件）\n\n| 版本 | minify KB | gzip KB |\n| --- | --- | --- |');
for (const [name, code] of VARIANTS) console.log(`| ${name} | ${(code.length / 1024).toFixed(1)} | ${(gzipSync(code).length / 1024).toFixed(1)} |`);

const browser = await launch();
const PLANS = [
  { title: '一万个 v-model 开关', start: 'window.runSwitches()', update: ['全部切换', 'for (const set of window.setters) set()'] },
  { title: '三层按钮一万个（属性透传、class 合并、事件）', start: 'window.runButtons()', update: ['改 title（全部更新）', "window.setAll('b')"] },
];
for (const plan of PLANS) {
  const samples = {};
  const failures = {};
  for (let round = 0; round < rounds; round++) {
    for (const [name, code] of round % 2 ? [...VARIANTS].reverse() : VARIANTS) {
      if (failures[name]) continue;
      const page = await openPage(browser, code);
      try {
        await page.evaluate(() => (window.ids = Array.from({ length: 10000 }, (_, i) => ({ i }))));
        const base = await heapAfterGc(page);
        const create = await page.evaluate(`(async () => { const start = performance.now(); ${plan.start}; await window.flush(); document.body.offsetHeight; return performance.now() - start; })()`);
        const heap = ((await heapAfterGc(page)) - base) / 1024 / 10000;
        const update = await page.evaluate(`(async () => { const start = performance.now(); ${plan.update[1]}; await window.flush(); document.body.offsetHeight; return performance.now() - start; })()`);
        const row = (samples[name] ??= { create: [], heap: [], update: [] });
        row.create.push(create);
        row.heap.push(heap);
        row.update.push(update);
      } catch (error) {
        failures[name] = String(error.message).slice(0, 200);
      }
      await page.close();
    }
  }
  console.log(`\n## ${plan.title}\n\n| 版本 | 创建 ms | 每个 KB | ${plan.update[0]} ms |\n| --- | --- | --- | --- |`);
  for (const [name] of VARIANTS) {
    if (failures[name]) {
      console.log(`| ${name} | 失败：${failures[name]} | | |`);
      continue;
    }
    const row = samples[name];
    console.log(`| ${name} | ${median(row.create).toFixed(1)} | ${median(row.heap).toFixed(2)} | ${median(row.update).toFixed(1)} |`);
  }
}

// ---- 服务端渲染和水合：1 万行 ----
const ssrPlugin = {
  name: 'vue-ssr',
  setup(b) {
    b.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const { descriptor } = sfc35.parse(source, { filename: path });
      const id = createHash('sha256').update(path).digest('hex').slice(0, 8);
      const script = sfc35.compileScript(descriptor, { id, isProd: true, inlineTemplate: true, templateOptions: { ssr: true, ssrCssVars: [] } });
      return { contents: script.content, loader: 'js', resolveDir: dirname(path) };
    });
  },
};
const data = `globalThis.ssrData = Array.from({ length: 10000 }, (_, i) => ({ id: i, label: 'row ' + i }));`;
const vueServer = await build({
  stdin: { contents: `${data}\nimport { createSSRApp } from 'vue'; import { renderToString } from 'vue/server-renderer'; export const makeHtml = async (App) => renderToString(createSSRApp(App)); export { default as App } from './vue/SsrRows.vue';`, resolveDir: here('.'), loader: 'js' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['vue', 'vue/server-renderer'],
  plugins: [ssrPlugin],
  define: { 'process.env.NODE_ENV': '"production"' },
});
const vueClient = await build({
  stdin: { contents: `${data}\nimport { createSSRApp, createApp, nextTick } from 'vue'; import App from './vue/SsrRows.vue'; window.flush = nextTick; window.adopt = () => createSSRApp(App).mount(document.getElementById('ssr')); window.fresh = () => createApp(App).mount(document.getElementById('ssr'));`, resolveDir: here('.'), loader: 'js' },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  minify: true,
  conditions: ['browser', 'production'],
  ...buildOptions('vdom35'),
});
const plainRows = `${data}
import { For, flushSync, hydrate, mount, renderToString, sig } from 'hilt';
function App() {
  const rows = sig.raw(globalThis.ssrData);
  const selected = sig.raw(null);
  const noop = () => {};
  return <table><tbody><For each={rows}>{(row) => (
    <tr class={() => (selected() === row.id ? 'danger' : '')}>
      <td>{row.id}</td>
      <td><a onClick={() => selected.set(row.id)}>{row.label}</a></td>
      <td><a class="remove" onClick={noop}>x</a></td>
    </tr>
  )}</For></tbody></table>;
}`;
const plainServer = await plainBundle(`${plainRows}\nexport const makeHtml = () => renderToString(() => <App />);`, { server: true });
const plainClient = await plainBundle(`${plainRows}\nwindow.flush = async () => flushSync(); window.adopt = () => hydrate(() => <App />, document.getElementById('ssr')); window.fresh = () => mount(() => <App />, document.getElementById('ssr'));`, { minify: true });

// Vue 的服务端产物要能解析到 node_modules：写到实验目录下再导入
const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
mkdirSync(here('./.out'), { recursive: true });
writeFileSync(here('./.out/vue-server.mjs'), vueServer.outputFiles[0].text);
writeFileSync(here('./.out/plain-server.mjs'), plainServer);
// vue 是 external，走 node 的入口，按运行时的 NODE_ENV 选开发版或生产版
process.env.NODE_ENV = 'production';
const vueModule = await import('./.out/vue-server.mjs');
const plainModule = await import('./.out/plain-server.mjs');
const measureServer = async (make) => {
  const list = [];
  let html = '';
  for (let i = -3; i < rounds; i++) {
    const start = performance.now();
    html = await make();
    if (i >= 0) list.push(performance.now() - start);
  }
  return { ms: median(list), html };
};
const SSR = [
  ['Vue 3.5 虚拟 DOM', await measureServer(() => vueModule.makeHtml(vueModule.App)), vueClient.outputFiles[0].text],
  ['hilt 标准 JSX', await measureServer(() => plainModule.makeHtml()), plainClient],
];
console.log('\n## 服务端渲染和接管（1 万行）\n\n| 版本 | 服务端 ms | HTML KB | gzip KB | 接管 ms | 接管后 DOM 改动 | 纯客户端 ms |\n| --- | --- | --- | --- | --- | --- | --- |');
for (const [name, server, code] of SSR) {
  const adopts = [];
  const fresh = [];
  let mutations = 0;
  for (let round = 0; round < rounds; round++) {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><div id="ssr">${server.html}</div></body></html>`);
    await page.evaluate(() => {
      window.mutated = 0;
      window.observer = new MutationObserver((records) => (window.mutated += records.length));
      window.observer.observe(document.getElementById('ssr'), { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await page.addScriptTag({ content: code });
    adopts.push(await page.evaluate(async () => {
      const start = performance.now();
      window.adopt();
      await window.flush();
      return performance.now() - start;
    }));
    mutations = await page.evaluate(() => window.mutated + window.observer.takeRecords().length);
    await page.close();
    const clean = await browser.newPage();
    await clean.setContent('<!doctype html><html><body><div id="ssr"></div></body></html>');
    await clean.addScriptTag({ content: code });
    fresh.push(await clean.evaluate(async () => {
      const start = performance.now();
      window.fresh();
      await window.flush();
      return performance.now() - start;
    }));
    await clean.close();
  }
  console.log(`| ${name} | ${server.ms.toFixed(1)} | ${(server.html.length / 1024).toFixed(0)} | ${(gzipSync(server.html).length / 1024).toFixed(0)} | ${median(adopts).toFixed(1)} | ${mutations} | ${median(fresh).toFixed(1)} |`);
}
await browser.close();
rmSync(here('./.out'), { recursive: true, force: true });

// ---- 转换成本：开发服务器每个文件都要走一遍 ----
console.log('\n## 单个组件文件的转换（中位数，ms/文件）\n');
const vueFiles = (await readdir(here('./vue'))).filter((file) => file.endsWith('.vue'));
const timeFiles = async (run) => {
  const list = [];
  for (let i = -5; i < 30; i++) {
    const start = performance.now();
    for (const file of vueFiles) await run(file);
    if (i >= 0) list.push((performance.now() - start) / vueFiles.length);
  }
  return median(list).toFixed(2);
};
const sources = Object.fromEntries(await Promise.all(vueFiles.map(async (file) => [file, await readFile(here(`./vue/${file}`), 'utf8')])));
console.log(`Vue 3.5 SFC 编译：${await timeFiles(async (file) => compileVue(sources[file], here(`./vue/${file}`), 'vdom35'))}`);
console.log(`Vue 3.6 Vapor 编译：${await timeFiles(async (file) => compileVue(sources[file], here(`./vue/${file}`), 'vapor36'))}`);
// 同样几个小组件，一个文件一个
const parts = plainEntry.split('\n').filter((line) => line.startsWith('function') && line.trimEnd().endsWith('}'));
parts.push("function Switch({ checked, label, ...rest }) {\n  const on = model(checked, false);\n  return <label data-state={() => (on() ? 'on' : 'off')}><input type=\"checkbox\" {...rest} checked={on} />{label}</label>;\n}");
const perFile = parts.length;
console.log(`hilt 标准 JSX（esbuild）：${await (async () => {
  const list = [];
  for (let i = -5; i < 30; i++) {
    const start = performance.now();
    for (const part of parts) await transform(part, { loader: 'tsx', jsx: 'automatic', jsxImportSource: 'hilt' });
    if (i >= 0) list.push((performance.now() - start) / perFile);
  }
  return median(list).toFixed(2);
})()}`);
void ALIAS;
