// 各体系的成本：一万个可绑定的开关（每个一份状态）。node 17-bind/bench.mjs [--rounds=7]
import { dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { heapAfterGc, launch, median, openPage } from '../lib/browser.mjs';
import { compile } from '../03-publish/packages/compiler/index.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const rounds = Number(process.argv.find((arg) => arg.startsWith('--rounds='))?.slice(9) ?? 7);
const hiltPath = here('./hilt.ts').replaceAll('\\', '/');

const COMMON = `import { flushSync, mount, component } from '@hilt/runtime';`;
const SOURCES = {
  '现状：符文 + _bindable / _bind': [false, `${COMMON}
const Switch = _component(({ checked = _bindable(false), label, ...rest }) => (
  <label data-state={checked ? 'on' : 'off'}><input type="checkbox" {...rest} checked={_bind(checked)} />{label}</label>
));
const Row = _component(() => { let on = _state(false); (window.setters ??= []).push(() => (on = !on)); return <Switch label="x" checked={_bind(on)} />; });
const App = _component(() => <div>{window.ids.map((id) => <Row />)}</div>);
window.run = () => mount(() => component(App, {}), document.body);`],
  '方案一：ref + schema': [true, `${COMMON} import { bound, component as define, prop, ref } from '${hiltPath}';
const Switch = define({ checked: bound(false), label: prop() }, (props, rest) => (
  <label data-state={props.checked.value ? 'on' : 'off'}><input type="checkbox" {...rest} checked={props.checked} />{props.label}</label>
));
const Row = () => { const on = ref(false); (window.setters ??= []).push(() => (on.value = !on.value)); return <Switch label="x" checked={on} />; };
const App = () => <div>{window.ids.map((id) => <Row />)}</div>;
window.run = () => mount(() => component(App, {}), document.body);`],
  '方案二：函数信号 + 接口': [true, `${COMMON} import { sig, sigModel } from '${hiltPath}'; import { omit2 } from '${hiltPath.replace('hilt.ts', 'hilt-signal.ts')}';
function Switch(props) { const checked = sigModel(props, 'checked', false); const rest = omit2(props, ['checked', 'label']); return <label data-state={checked() ? 'on' : 'off'}><input type="checkbox" {...rest} checked={checked} />{props.label}</label>; }
const Row = () => { const on = sig(false); (window.setters ??= []).push(() => on.set(!on())); return <Switch label="x" checked={on} />; };
const App = () => <div>{window.ids.map((id) => <Row />)}</div>;
window.run = () => mount(() => component(App, {}), document.body);`],
  '方案三：符文 + 真实的壳': [true, `${COMMON}
const Switch = _component(({ checked: source, label, ...rest }) => {
  let checked = _model(source, false);
  return <label data-state={checked ? 'on' : 'off'}><input type="checkbox" {...rest} checked={_ref(checked)} />{label}</label>;
});
const Row = _component(() => { let on = _state(false); (window.setters ??= []).push(() => (on = !on)); return <Switch label="x" checked={_ref(on)} />; });
const App = _component(() => <div>{window.ids.map((id) => <Row />)}</div>);
window.run = () => mount(() => component(App, {}), document.body);`],
  '方案五：符文 + 传变量即带写权限': [true, `@AUTO${COMMON}
const Switch = _component(({ checked = _model(false), label, ...rest }) => (
  <label data-state={checked ? 'on' : 'off'}><input type="checkbox" {...rest} checked={checked} />{label}</label>
));
const Row = _component(() => { let on = _state(false); (window.setters ??= []).push(() => (on = !on)); return <Switch label="x" checked={on} />; });
const App = _component(() => <div>{window.ids.map((id) => <Row />)}</div>);
window.run = () => mount(() => component(App, {}), document.body);`],
  '方案四：对象状态 + 路径代理': [true, `${COMMON} import { bound, component as define, fields, prop, state } from '${hiltPath}';
const Switch = define({ checked: bound(false), label: prop() }, (props, rest) => (
  <label data-state={props.checked.value ? 'on' : 'off'}><input type="checkbox" {...rest} checked={props.checked} />{props.label}</label>
));
const Row = () => { const s = state({ on: false }); const $ = fields(s); (window.setters ??= []).push(() => (s.on = !s.on)); return <Switch label="x" checked={$.on} />; };
const App = () => <div>{window.ids.map((id) => <Row />)}</div>;
window.run = () => mount(() => component(App, {}), document.body);`],
};

async function bundle(source, twoWay) {
  const autoBind = source.startsWith('@AUTO');
  const compiled = await compile(`${source.replace('@AUTO', '')}\nwindow.flushSync = flushSync;`, here('./bench-case.tsx'), twoWay ? { twoWayFrom: hiltPath, autoBind } : {});
  const result = await build({
    stdin: { contents: compiled.code, resolveDir: here('.'), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
    alias: { '@hilt/runtime': here('../03-publish/packages/runtime/index.js') },
  });
  return result.outputFiles[0].text;
}

const browser = await launch();
const built = [];
for (const [label, [twoWay, source]] of Object.entries(SOURCES)) built.push([label, await bundle(source, twoWay)]);
const samples = {};
for (let round = 0; round < rounds; round++) {
  for (const [label, code] of round % 2 ? [...built].reverse() : built) {
    const page = await openPage(browser, code);
    await page.evaluate(() => (window.ids = Array.from({ length: 10000 }, (_, i) => ({ i }))));
    const base = await heapAfterGc(page);
    const create = await page.evaluate(() => {
      const start = performance.now();
      window.run();
      window.flushSync();
      return performance.now() - start;
    });
    const heap = (await heapAfterGc(page)) - base;
    const update = await page.evaluate(() => {
      const start = performance.now();
      for (const set of window.setters) set();
      window.flushSync();
      return performance.now() - start;
    });
    const row = (samples[label] ??= { create: [], heap: [], update: [] });
    row.create.push(create);
    row.heap.push(heap);
    row.update.push(update);
    await page.close();
  }
}
console.log('| 方案 | 建 1 万个 ms | 每个 KB | 全部切换 ms | 产物 gzip KB |\n| --- | --- | --- | --- | --- |');
for (const [label, code] of built) {
  const row = samples[label];
  console.log(`| ${label} | ${median(row.create).toFixed(1)} | ${(median(row.heap) / 1024 / 10000).toFixed(2)} | ${median(row.update).toFixed(1)} | ${(gzipSync(code).length / 1024).toFixed(1)} |`);
}
await browser.close();
void dirname, readFile;
