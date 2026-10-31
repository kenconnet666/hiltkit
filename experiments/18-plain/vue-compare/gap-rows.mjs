// 拆开长列表创建的差距：手写 DOM（下限）、Vue 3.5、Vapor、hilt、hilt 各项优化。
// node 18-plain/vue-compare/gap-rows.mjs [--rounds=11] [--only=名字,名字] [--profile]。各版本交替跑，串行。
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launch, median } from '../../lib/browser.mjs';
import { buildOptions } from '../../05-compare/lib/esbuild-plugin.mjs';
import { ALIAS } from '../bundle.mjs';
import { clientPatches } from './gap-patches.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const arg = (key, fallback) => process.argv.find((item) => item.startsWith(`--${key}=`))?.split('=')[1] ?? fallback;
const rounds = Number(arg('rounds', 11));
const only = arg('only', '').split(',').filter(Boolean);
const profileOn = process.argv.includes('--profile');

const COMMON = { bundle: true, write: false, format: 'iife', target: 'es2022', conditions: ['browser', 'production'], define: { 'process.env.NODE_ENV': '"production"' } };
const hiltBuild = (patches = []) => ({ jsx: 'automatic', jsxImportSource: 'hilt', alias: ALIAS, plugins: [clientPatches(patches)] });
const fromFile = (path, options) => ({ entryPoints: [path], ...options });
const fromText = (contents, options = {}) => ({ stdin: { contents, resolveDir: here('../../05-compare/rows'), loader: 'js' }, ...options });

const floorHead = `import { makeBench } from './data.js';
const table = document.body.appendChild(document.createElement('table'));
const body = table.appendChild(document.createElement('tbody'));
const noop = () => {};
const clear = () => { body.textContent = ''; };`;
const floorCreate = `${floorHead}
const el = (tag) => document.createElement(tag);
window.bench = makeBench({ clear, create(data) { for (const row of data) {
  const tr = el('tr'), a = el('td'), b = el('td'), c = el('td'), l = el('a'), x = el('a');
  a.textContent = row.id; l.textContent = row.label; l.addEventListener('click', noop); b.appendChild(l);
  x.className = 'remove'; x.textContent = 'x'; x.addEventListener('click', noop); c.appendChild(x);
  tr.appendChild(a); tr.appendChild(b); tr.appendChild(c); body.appendChild(tr);
} } });`;
const floorClone = `${floorHead}
const t = document.createElement('template');
t.innerHTML = '<tr><td> </td><td><a> </a></td><td><a class="remove">x</a></td></tr>';
const proto = t.content.firstChild;
window.bench = makeBench({ clear, create(data) { for (const row of data) {
  const tr = proto.cloneNode(true), a = tr.firstChild, b = a.nextSibling, l = b.firstChild, x = b.nextSibling.firstChild;
  a.firstChild.data = row.id; l.firstChild.data = row.label; l.addEventListener('click', noop); x.addEventListener('click', noop);
  body.appendChild(tr);
} } });`;

const rowsEntry = here('./rows.tsx');
/** 正式包 packages/core：同一份用例，只换实现 */
const CORE_ALIAS = {
  'hilt/jsx-runtime': here('../../../packages/core/src/jsx-runtime.ts'),
  'hilt/jsx-dev-runtime': here('../../../packages/core/src/jsx-dev-runtime.ts'),
  'hilt/css': here('../../../packages/core/src/css/index.ts'),
  hilt: here('../../../packages/core/src/index.ts'),
};
const VARIANTS = [
  ['手写 createElement', fromText(floorCreate)],
  ['手写 cloneNode', fromText(floorClone)],
  ['Vapor', fromFile(here('../../05-compare/rows/vue/entry-vapor.js'), buildOptions('vapor36'))],
  ['Vue 3.5', fromFile(here('../../05-compare/rows/vue/entry-vdom35.js'), buildOptions('vdom35'))],
  ['hilt', fromFile(rowsEntry, hiltBuild())],
  ['hilt +委托', fromFile(rowsEntry, hiltBuild(['delegate']))],
  ['hiltkit 正式包', fromFile(rowsEntry, { jsx: 'automatic', jsxImportSource: 'hilt', alias: CORE_ALIAS })],
].filter(([name]) => !only.length || only.includes(name));

const bundles = [];
for (const [name, options] of VARIANTS) {
  const minified = await build({ ...COMMON, minify: true, ...options });
  const readable = await build({ ...COMMON, minify: false, ...options });
  bundles.push({ name, code: minified.outputFiles[0].text, readable: readable.outputFiles[0].text });
}

const browser = await launch();
const open = async (code, before) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (error) => console.log('pageerror', error.message));
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  if (before) await page.evaluate(before);
  await page.addScriptTag({ content: code });
  return page;
};
const warmup = (page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 5; i++) {
      await window.bench.create(1000);
      document.body.offsetHeight;
      await window.bench.clear();
    }
  });

const samples = Object.fromEntries(bundles.map(({ name }) => [name, { script: [], total: [] }]));
for (let round = 0; round < rounds; round++) {
  for (const { name, code } of round % 2 ? [...bundles].reverse() : bundles) {
    const page = await open(code);
    await warmup(page);
    const [total, script] = await page.evaluate(async () => {
      const start = performance.now();
      await window.bench.create(10000);
      const scripted = performance.now();
      document.body.offsetHeight;
      return [performance.now() - start, scripted - start];
    });
    samples[name].script.push(script);
    samples[name].total.push(total);
    await page.close();
  }
}
console.log(`## 创建 1 万行（Chromium，每轮新页面，交替，${rounds} 轮）\n`);
console.log('| 版本 | 脚本中位 ms | 脚本最小 | 脚本最大 | 含布局中位 ms | 含布局最小 | 含布局最大 |\n| --- | --- | --- | --- | --- | --- | --- |');
for (const { name } of bundles) {
  const { script, total } = samples[name];
  console.log(`| ${name} | ${median(script).toFixed(0)} | ${Math.min(...script).toFixed(0)} | ${Math.max(...script).toFixed(0)} | ${median(total).toFixed(0)} | ${Math.min(...total).toFixed(0)} | ${Math.max(...total).toFixed(0)} |`);
}

// 每行调了多少次 DOM：页面脚本加载前包一层计数
const countCalls = () => {
  window.calls = {};
  const wrap = (owner, name) => {
    const original = owner[name];
    owner[name] = function (...args) {
      window.calls[name] = (window.calls[name] ?? 0) + 1;
      return original.apply(this, args);
    };
  };
  for (const name of ['createElement', 'createElementNS', 'createTextNode', 'createComment', 'createDocumentFragment']) wrap(Document.prototype, name);
  for (const name of ['insertBefore', 'appendChild', 'cloneNode']) wrap(Node.prototype, name);
  for (const name of ['setAttribute', 'append', 'prepend']) wrap(Element.prototype, name);
  wrap(EventTarget.prototype, 'addEventListener');
  for (const [owner, name] of [[Node.prototype, 'textContent'], [Element.prototype, 'className'], [CharacterData.prototype, 'data'], [Node.prototype, 'nodeValue']]) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    Object.defineProperty(owner, name, {
      ...descriptor,
      set(value) {
        window.calls[`${name}=`] = (window.calls[`${name}=`] ?? 0) + 1;
        descriptor.set.call(this, value);
      },
    });
  }
};
console.log('\n## 每行的 DOM 调用次数（建 1000 行）\n');
for (const { name, code } of bundles) {
  const page = await open(code, countCalls);
  const calls = await page.evaluate(async () => {
    window.calls = {};
    await window.bench.create(1000);
    return window.calls;
  });
  await page.close();
  const total = Object.values(calls).reduce((a, b) => a + b, 0);
  console.log(`- ${name}：共 ${(total / 1000).toFixed(1)}；${Object.entries(calls).sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key} ${(count / 1000).toFixed(1)}`).join('，')}`);
}

if (profileOn) {
  const NATIVE = new Set(['createElement', 'createElementNS', 'createTextNode', 'createComment', 'createDocumentFragment', 'insertBefore', 'appendChild', 'cloneNode', 'setAttribute', 'addEventListener', 'textContent', 'set textContent', 'set className', 'set data', 'get data', 'firstChild', 'nextSibling', 'get firstChild', 'get nextSibling', 'get parentNode', 'previousSibling', 'get previousSibling', 'append', 'importNode', 'removeAttribute', 'set nodeValue', 'lastChild', 'get lastChild', 'set innerHTML']);
  console.log('\n## CPU 分布（未压缩产物，建 1 万行 3 次的平均，ms）');
  for (const { name, readable } of bundles) {
    const page = await open(readable);
    await warmup(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    const self = new Map();
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.bench.clear());
      await cdp.send('Profiler.start');
      await page.evaluate(() => window.bench.create(10000));
      const { profile } = await cdp.send('Profiler.stop');
      const byId = new Map(profile.nodes.map((node) => [node.id, node]));
      profile.samples.forEach((id, index) => {
        const key = byId.get(id).callFrame.functionName || '(anonymous)';
        self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000 / 3);
      });
    }
    await page.close();
    self.delete('(idle)');
    self.delete('(root)');
    // (program) 是浏览器自己的时间（布局、协议），各版本都约 700 ms，和被测脚本无关
    self.delete('(program)');
    let dom = 0;
    let gc = 0;
    let js = 0;
    for (const [key, time] of self) {
      if (NATIVE.has(key)) dom += time;
      else if (key === '(garbage collector)') gc += time;
      else js += time;
    }
    console.log(`\n### ${name}：DOM ${dom.toFixed(0)}，GC ${gc.toFixed(0)}，JS ${js.toFixed(0)}\n`);
    for (const [key, time] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`${time.toFixed(1).padStart(7)}  ${key}`);
  }
}
await browser.close();
