// 不编译要付多少性能：node 18-plain/bench.mjs [--rounds=7]
// 同样的场景两种写法：标准 JSX + 运行时（本实验），编译器模板克隆（17-bind 方案二的函数信号）。每轮一个新页面。
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { heapAfterGc, launch, median, openPage } from '../lib/browser.mjs';
import { compile } from '../03-publish/packages/compiler/index.mjs';
import { bundle } from './bundle.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const rounds = Number(process.argv.find((arg) => arg.startsWith('--rounds='))?.slice(9) ?? 7);
const hiltPath = here('../17-bind/hilt.ts').replaceAll('\\', '/');

const plainSource = `import { flushSync, For, merge, model, mount, sig } from 'hilt';
function Switch({ checked, label, ...rest }) {
  const on = model(checked, false);
  return <label data-state={() => (on() ? 'on' : 'off')}><input type="checkbox" {...rest} checked={on} />{label}</label>;
}
function SwitchRow() { const on = sig(false); (window.setters ??= []).push(() => on.set(!on())); return <Switch label="x" checked={on} />; }
function Base({ children, ...rest }) { return <button {...merge(rest, { class: 'base', 'data-part': 'root' })}>{children}</button>; }
function Mid({ size, children, ...rest }) { return <Base {...merge(rest, { class: () => 'btn btn-' + (typeof size === 'function' ? size() : size) })}>{children}</Base>; }
const noop = () => {};
function ButtonRow({ index, title }) { return <Mid id={'b' + index} size="md" title={title} onClick={noop}>保存</Mid>; }
function Buttons() { const title = sig('a'); window.setAll = (next) => title.set(next); return <div>{window.ids.map((item) => <ButtonRow index={item.i} title={title} />)}</div>; }
function Rows() {
  const rows = sig([]);
  window.rowsApi = {
    create: (count) => rows.set(Array.from({ length: count }, (_, id) => ({ id, label: sig('row ' + id) }))),
    updateEvery: (step) => { const list = rows.peek(); for (let i = 0; i < list.length; i += step) list[i].label.set(list[i].label.peek() + '!'); },
    swap: () => { const list = [...rows.peek()]; const a = list[1]; list[1] = list[list.length - 2]; list[list.length - 2] = a; rows.set(list); },
    clear: () => rows.set([]),
  };
  return <table><tbody><For each={rows}>{(row) => <tr><td>{row.id}</td><td><a onClick={noop}>{row.label}</a></td></tr>}</For></tbody></table>;
}
window.flushSync = flushSync;
window.runSwitches = () => mount(() => <div>{window.ids.map(() => <SwitchRow />)}</div>, document.body);
window.runButtons = () => mount(() => <Buttons />, document.body);
window.runRows = () => mount(() => <Rows />, document.body);
`;
const compiledSource = `import { flushSync, For, mount, component } from '@hilt/runtime';
import { sig, sigModel } from '${hiltPath}';
import { omit2 } from '${hiltPath.replace('hilt.ts', 'hilt-signal.ts')}';
function Switch(props) { const checked = sigModel(props, 'checked', false); const rest = omit2(props, ['checked', 'label']); return <label data-state={checked() ? 'on' : 'off'}><input type="checkbox" {...rest} checked={checked} />{props.label}</label>; }
const SwitchRow = () => { const on = sig(false); (window.setters ??= []).push(() => on.set(!on())); return <Switch label="x" checked={on} />; };
const Base = (props) => <button class="base" data-part="root" {...omit2(props, ['children'])}>{props.children}</button>;
const Mid = (props) => <Base class={'btn btn-' + props.size} {...omit2(props, ['size', 'children'])}>{props.children}</Base>;
const noop = () => {};
const ButtonRow = (props) => <Mid id={'b' + props.index} size="md" title={props.title()} onClick={noop}>保存</Mid>;
const Buttons = () => { const title = sig('a'); window.setAll = (next) => title.set(next); return <div>{window.ids.map((item) => <ButtonRow index={item.i} title={title} />)}</div>; };
const Rows = () => {
  const rows = sig([]);
  window.rowsApi = {
    create: (count) => rows.set(Array.from({ length: count }, (_, id) => ({ id, label: sig('row ' + id) }))),
    updateEvery: (step) => { const list = rows(); for (let i = 0; i < list.length; i += step) list[i].label.set(list[i].label() + '!'); },
    swap: () => { const list = [...rows()]; const a = list[1]; list[1] = list[list.length - 2]; list[list.length - 2] = a; rows.set(list); },
    clear: () => rows.set([]),
  };
  return <table><tbody>{rows().map((row) => <tr><td>{row.id}</td><td><a onClick={noop}>{row.label()}</a></td></tr>)}</tbody></table>;
};
window.flushSync = flushSync;
window.runSwitches = () => mount(() => component(() => <div>{window.ids.map(() => <SwitchRow />)}</div>, {}), document.body);
window.runButtons = () => mount(() => component(Buttons, {}), document.body);
window.runRows = () => mount(() => component(Rows, {}), document.body);
`;

const runesSource = `import { flushSync, mount, signal } from '@hilt/runtime';
const Switch = _component(({ checked = _bindable(false), label, ...rest }) => (
  <label data-state={checked ? 'on' : 'off'}><input type="checkbox" {...rest} checked={_bind(checked)} />{label}</label>
));
const SwitchRow = _component(() => { let on = _state(false); (window.setters ??= []).push(() => (on = !on)); return <Switch label="x" checked={_bind(on)} />; });
const Switches = _component(() => <div>{window.ids.map(() => <SwitchRow />)}</div>);
const Base = _component(({ children, ...rest }) => <button class="base" data-part="root" {...rest}>{children}</button>);
const Mid = _component(({ size = 'md', children, ...rest }) => <Base class={'btn btn-' + size} {...rest}>{children}</Base>);
const noop = () => {};
const ButtonRow = _component(({ index, title }) => <Mid id={'b' + index} size="md" title={title} onClick={noop}>保存</Mid>);
const Buttons = _component(() => { let title = _state('a'); window.setAll = (next) => (title = next); return <div>{window.ids.map((item) => <ButtonRow index={item.i} title={title} />)}</div>; });
const Rows = _component(() => {
  let rows = _state.raw([]);
  window.rowsApi = {
    create: (count) => (rows = Array.from({ length: count }, (_, id) => ({ id, label: signal('row ' + id) }))),
    updateEvery: (step) => { for (let i = 0; i < rows.length; i += step) rows[i].label.value += '!'; },
    swap: () => { const list = [...rows]; const a = list[1]; list[1] = list[list.length - 2]; list[list.length - 2] = a; rows = list; },
    clear: () => (rows = []),
  };
  return <table><tbody>{rows.map((row) => <tr><td>{row.id}</td><td><a onClick={noop}>{row.label.value}</a></td></tr>)}</tbody></table>;
});
window.flushSync = flushSync;
window.runSwitches = () => mount(() => <Switches />, document.body);
window.runButtons = () => mount(() => <Buttons />, document.body);
window.runRows = () => mount(() => <Rows />, document.body);
`;

async function compiledBundle(source, options) {
  const compiled = await compile(source, here('./bench-case.tsx'), options);
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
const VARIANTS = [
  ['编译器模板', await compiledBundle(runesSource, {})],
  ['标准 JSX', await bundle(plainSource, { minify: true })],
];
const browser = await launch();
const timed = (body) => `(() => { const start = performance.now(); ${body}; window.flushSync(); return performance.now() - start; })()`;
const PLANS = [
  { title: '一万个可绑定开关', heap: '创建', setup: 'window.ids = Array.from({ length: 10000 }, (_, i) => ({ i }))', steps: [['创建', 'window.runSwitches()'], ['全部切换', 'for (const set of window.setters) set()']] },
  { title: '三层按钮一万个（class 合并、响应式 title、事件）', heap: '创建', setup: 'window.ids = Array.from({ length: 10000 }, (_, i) => ({ i }))', steps: [['创建', 'window.runButtons()'], ['改 title（全部更新）', "window.setAll('b')"]] },
  {
    title: '行列表',
    setup: '0',
    steps: [['挂载', 'window.runRows()'], ['建 1000 行', 'window.rowsApi.create(1000)'], ['每 10 行改文字', 'window.rowsApi.updateEvery(10)'], ['交换两行', 'window.rowsApi.swap()'], ['清空', 'window.rowsApi.clear()'], ['建 10000 行', 'window.rowsApi.create(10000)'], ['每 10 行改文字（一万行）', 'window.rowsApi.updateEvery(10)']],
  },
];
console.log(VARIANTS.map(([name, code]) => `${name}：${(code.length / 1024).toFixed(1)} KB，gzip ${(gzipSync(code).length / 1024).toFixed(1)} KB`).join('；'));
for (const plan of PLANS) {
  const samples = {};
  for (let round = 0; round < rounds; round++) {
    for (const [name, code] of round % 2 ? [...VARIANTS].reverse() : VARIANTS) {
      const page = await openPage(browser, code);
      await page.evaluate(plan.setup);
      const base = plan.heap ? await heapAfterGc(page) : 0;
      for (const [label, body] of plan.steps) {
        const ms = await page.evaluate(timed(body));
        ((samples[name] ??= {})[label] ??= []).push(ms);
        if (plan.heap === label) (samples[name][`${label} 每个 KB`] ??= []).push(((await heapAfterGc(page)) - base) / 1024 / 10000);
      }
      await page.close();
    }
  }
  console.log(`\n### ${plan.title}\n\n| 操作 | 编译器模板 | 标准 JSX | 倍数 |\n| --- | --- | --- | --- |`);
  for (const label of Object.keys(samples['标准 JSX'])) {
    const a = median(samples['编译器模板'][label]);
    const b = median(samples['标准 JSX'][label]);
    console.log(`| ${label} | ${a.toFixed(2)} | ${b.toFixed(2)} | ${(b / a).toFixed(2)} |`);
  }
}
await browser.close();

// 转换成本
console.log('\n### 单个文件的转换（18-plain/cases/app.tsx，50 轮中位数）\n');
const appSource = await readFile(here('./cases/app.tsx'), 'utf8');
const measure = async (run) => {
  const list = [];
  for (let i = -10; i < 50; i++) {
    const start = performance.now();
    await run();
    if (i >= 0) list.push(performance.now() - start);
  }
  return median(list).toFixed(2);
};
console.log(`esbuild 转 JSX：${await measure(() => transform(appSource, { loader: 'tsx', jsx: 'automatic', jsxImportSource: 'hilt' }))} ms`);
console.log(`Babel 编译器（只转 JSX 和列表）：${await measure(() => compile(appSource, here('./cases/app.tsx')))} ms`);
