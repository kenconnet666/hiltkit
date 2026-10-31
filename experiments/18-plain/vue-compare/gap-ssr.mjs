// 拆开服务端渲染的差距：手写字符串（下限）、Vue 编译模板、Vue h()（不靠模板编译）、hilt。
// node 18-plain/vue-compare/gap-ssr.mjs [--rounds=15] [--profile]。各版本交替跑，串行。
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as sfc35 from 'vue/compiler-sfc';
import { median } from '../../lib/browser.mjs';
import { bundle as plainBundle } from '../bundle.mjs';
import './gen-vue.mjs';
import { serverPatches } from './gap-patches.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const arg = (key, fallback) => process.argv.find((item) => item.startsWith(`--${key}=`))?.split('=')[1] ?? fallback;
const rounds = Number(arg('rounds', 15));
const COUNT = 10000;

globalThis.ssrData = Array.from({ length: COUNT }, (_, i) => ({ id: i, label: 'row ' + i }));
globalThis.window = { ids: Array.from({ length: COUNT }, (_, i) => ({ i })), setters: [] };

const ssrPlugin = {
  name: 'vue-ssr',
  setup(b) {
    b.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const { descriptor } = sfc35.parse(readFileSync(path, 'utf8'), { filename: path });
      const id = createHash('sha256').update(path).digest('hex').slice(0, 8);
      const script = sfc35.compileScript(descriptor, { id, isProd: true, inlineTemplate: true, templateOptions: { ssr: true, ssrCssVars: [] } });
      return { contents: script.content, loader: 'js', resolveDir: dirname(path) };
    });
  },
};
const vueSource = `import { createSSRApp, h, shallowRef } from 'vue';
import { renderToString } from 'vue/server-renderer';
import Rows from './vue/SsrRows.vue';
import Buttons from './vue/Buttons.vue';
const noop = () => {};
const RowsH = {
  setup() {
    const rows = shallowRef(globalThis.ssrData);
    const selected = shallowRef(null);
    return () => h('table', h('tbody', rows.value.map((row) => h('tr', { key: row.id, class: { danger: selected.value === row.id } }, [
      h('td', row.id),
      h('td', h('a', { onClick: () => (selected.value = row.id) }, row.label)),
      h('td', h('a', { class: 'remove', onClick: noop }, 'x')),
    ]))));
  },
};
const Base = { setup: (props, { slots }) => () => h('button', { class: 'base', 'data-part': 'root' }, slots.default()) };
const Mid = { props: { size: { default: 'md' } }, setup: (props, { slots }) => () => h(Base, { class: 'btn btn-' + props.size }, slots) };
const ButtonRow = { props: ['index', 'title'], setup: (props) => () => h(Mid, { id: 'b' + props.index, size: 'md', title: props.title, onClick: noop }, { default: () => '保存' }) };
const ButtonsH = { setup: () => () => h('div', window.ids.map((item) => h(ButtonRow, { key: item.i, index: item.i, title: 'a' }))) };
export const vueRows = () => renderToString(createSSRApp(Rows));
export const vueRowsH = () => renderToString(createSSRApp(RowsH));
export const vueButtons = () => renderToString(createSSRApp(Buttons));
export const vueButtonsH = () => renderToString(createSSRApp(ButtonsH));`;
const vueServer = await build({
  stdin: { contents: vueSource, resolveDir: here('.'), loader: 'js' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['vue', 'vue/server-renderer'],
  plugins: [ssrPlugin],
  define: { 'process.env.NODE_ENV': '"production"' },
});

const plainSource = `import { For, merge, read, renderToString, sig } from 'hilt';
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
}
function Base({ children, ...rest }) { return <button {...merge(rest, { class: 'base', 'data-part': 'root' })}>{children}</button>; }
function Mid({ size = 'md', children, ...rest }) { return <Base {...merge(rest, { class: () => 'btn btn-' + read(size) })}>{children}</Base>; }
const noop = () => {};
function ButtonRow({ index, title }) { return <Mid id={'b' + index} size="md" title={title} onClick={noop}>保存</Mid>; }
function Buttons() { const title = sig('a'); return <div>{window.ids.map((item) => <ButtonRow index={item.i} title={title} />)}</div>; }
export const hiltRows = () => renderToString(() => <App />);
export const hiltButtons = () => renderToString(() => <Buttons />);
export const vnodesOnly = () => {
  const selected = sig.raw(null);
  const noop = () => {};
  return globalThis.ssrData.map((row) => (
    <tr class={() => (selected() === row.id ? 'danger' : '')}>
      <td>{row.id}</td>
      <td><a onClick={() => selected.set(row.id)}>{row.label}</a></td>
      <td><a class="remove" onClick={noop}>x</a></td>
    </tr>
  )).length;
};`;

// 下限：手写字符串，转义和 Vue 一样按值做
const escape = (text) => String(text).replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'));
const floor = () => {
  let out = '<table><tbody><!--[-->';
  for (const row of globalThis.ssrData) out += `<tr><td>${row.id}</td><td><a>${escape(row.label)}</a></td><td><a class="remove">x</a></td></tr>`;
  return `${out}<!--]--></tbody></table>`;
};

mkdirSync(here('./.gap'), { recursive: true });
writeFileSync(here('./.gap/vue.mjs'), vueServer.outputFiles[0].text);
// vue 是 external，走 node 的入口，按运行时的 NODE_ENV 选开发版或生产版。不设就量到开发版
process.env.NODE_ENV = 'production';
const { warn: vueWarn } = await import('vue');
if (vueWarn.name !== 'NOOP') throw new Error(`加载到了 Vue 开发版（warn 是 ${vueWarn.name}）`);
const vue = await import('./.gap/vue.mjs');
const hiltVariant = async (name, patches) => {
  const code = await plainBundle(`${plainSource}`, { server: true, ...(patches ? { plugins: [serverPatches(patches)] } : {}) });
  writeFileSync(here(`./.gap/${name}.mjs`), code);
  return import(`./.gap/${name}.mjs`);
};
const hilt = await hiltVariant('hilt');
const patchNames = arg('patches', '').split(',').filter(Boolean);
const fast = patchNames.length ? await hiltVariant('fast', patchNames) : undefined;

const run = async (table) => {
  const samples = Object.fromEntries(table.map(([name]) => [name, []]));
  const sizes = {};
  for (let i = -5; i < rounds; i++) {
    for (const [name, make] of i % 2 ? [...table].reverse() : table) {
      const start = performance.now();
      const html = await make();
      const elapsed = performance.now() - start;
      if (i >= 0) samples[name].push(elapsed);
      sizes[name] = typeof html === 'string' ? html.length : 0;
    }
  }
  console.log('| 版本 | 中位 ms | 最小 ms | 最大 ms | 每行 µs | HTML KB |\n| --- | --- | --- | --- | --- | --- |');
  for (const [name] of table) {
    const list = samples[name];
    const ms = median(list);
    console.log(`| ${name} | ${ms.toFixed(1)} | ${Math.min(...list).toFixed(1)} | ${Math.max(...list).toFixed(1)} | ${((ms / COUNT) * 1000).toFixed(2)} | ${(sizes[name] / 1024).toFixed(0)} |`);
  }
};

console.log(`## 1 万行列表（node ${process.version}，${rounds} 轮）\n`);
await run([
  ['手写字符串', floor],
  ['Vue 编译模板', vue.vueRows],
  ['Vue h()', vue.vueRowsH],
  ['hilt', hilt.hiltRows],
  ...(fast ? [['hilt 优化', fast.hiltRows]] : []),
  ['hilt 只建 VNode', hilt.vnodesOnly],
]);
console.log('\n## 1 万个三层按钮组件\n');
await run([
  ['Vue 编译模板', vue.vueButtons],
  ['Vue h()', vue.vueButtonsH],
  ['hilt', hilt.hiltButtons],
  ...(fast ? [['hilt 优化', fast.hiltButtons]] : []),
]);

if (process.argv.includes('--profile')) {
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 100 });
  for (const [label, make] of [['hilt 列表', hilt.hiltRows], ['hilt 按钮', hilt.hiltButtons]]) {
    await session.post('Profiler.start');
    for (let i = 0; i < 30; i++) make();
    const { profile } = await session.post('Profiler.stop');
    const self = new Map();
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    profile.samples.forEach((id, index) => {
      const { functionName, url, lineNumber } = byId.get(id).callFrame;
      const key = `${functionName || '(anonymous)'}${url.includes('.gap') ? `:${lineNumber + 1}` : ''}`;
      self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0));
    });
    // post 是 Profiler.stop 自己的耗时，不是被测代码
    self.delete('post');
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    console.log(`\n## ${label} CPU 自身耗时（30 次）\n`);
    for (const [key, time] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`${((time / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
  }
}
rmSync(here('./.gap'), { recursive: true, force: true });
