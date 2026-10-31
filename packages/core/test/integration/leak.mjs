// 内存泄漏和 deep 成本。node test/integration/leak.mjs
import { heapAfterGc, launch, median, openPage } from './browser.mjs';
import { bundle } from './bundle.mjs';

const code = await bundle(
  `import { Boundary, derived, effect, flushSync, For, merge, model, mount, onCleanup, Portal, provide, createContext, inject, sig, when, read } from 'hiltkit';
import { create, recipe } from 'hiltkit/css';
const styles = create({ root: { padding: '1px' }, on: { color: 'red' }, bar: (width) => ({ width }) });
const Theme = createContext('x');
function Child({ tick, ...rest }) {
  const theme = inject(Theme);
  const ref = sig(null);
  const on = model(undefined, false);
  onCleanup(() => {});
  effect(() => { void read(tick); return () => {}; });
  return (
    <section ref={ref} {...merge(rest, { class: 'c' })} sx={[styles.root, () => on() && styles.on, () => styles.bar(read(tick) + 'px')]} data-theme={theme}>
      <input value={on} type="checkbox" checked={on} />
      {() => (read(tick) % 3 ? <b>{tick}</b> : <i>{tick}</i>)}
    </section>
  );
}
function Provider({ children }) { provide(Theme, 'y'); return children; }
const CASES = {
  cycleBranch() { const show = sig(true); const tick = sig(0); window.step = () => { show.toggle(); tick.inc(); }; return <div>{when(show, () => <Provider><Child tick={tick} onClick={() => {}} /></Provider>)}</div>; },
  cycleList() { const rows = sig([]); window.step = () => rows.set(rows.peek().length ? [] : Array.from({ length: 100 }, (_, id) => ({ id }))); return <ul><For each={rows} by={(row) => row.id}>{(row) => <li><Child tick={() => row().id} /></li>}</For></ul>; },
  cycleRows() { let next = 0; const rows = sig(Array.from({ length: 20 }, () => ({ id: next++ }))); window.step = () => rows.update((list) => [...list.slice(1), { id: next++ }]); return <ul><For each={rows}>{(row) => <li><Child tick={row.id} /></li>}</For></ul>; },
  cycleBoundary() { const armed = sig(true); let retry; const Bomb = () => { if (armed()) throw new Error('炸'); return <b>好</b>; }; window.step = () => { armed.toggle(); retry?.(); }; return <div><Boundary fallback={(error, again) => { retry = again; return <p>{error.message}</p>; }}><Child tick={1} /><Bomb /></Boundary></div>; },
  cyclePortal() { const open = sig(false); window.step = () => open.toggle(); return <div>{when(open, () => <Portal><Child tick={2} /></Portal>)}</div>; },
  cycleDeep() { const data = sig({ list: [{ x: 1 }], name: 'a' }); const name = data.at((f) => f.name); let n = 0; window.step = () => { data().list = [{ x: ++n }]; name.set('n' + n); }; return <p>{name}{() => data().list[0].x}</p>; },
};
let run;
window.flushSync = flushSync;
window.api = {
  setup(name) {
    if (name === 'cycleApp') {
      const host = document.createElement('div'); document.body.append(host);
      run = (times) => { for (let i = 0; i < times; i++) { const stop = mount(() => CASES.cycleBranch(), host); flushSync(); stop(); host.textContent = ''; } };
      return;
    }
    mount(() => CASES[name](), document.body);
    run = (times) => { for (let i = 0; i < times; i++) { window.step(); flushSync(); } };
  },
  run: (times) => run(times),
  sections: () => document.querySelectorAll('section').length,
  // deep 的成本：一万个对象，字段读写
  deepCost(count, kind) {
    const start = performance.now();
    const made = [];
    for (let i = 0; i < count; i++) {
      if (kind === 'deep') { const form = sig({ name: 'a', age: 1 }); made.push(form); }
      else made.push({ name: sig('a'), age: sig(1) });
    }
    window.kept = made;
    return performance.now() - start;
  },
  deepUpdate(kind) {
    const start = performance.now();
    for (const item of window.kept) { if (kind === 'deep') item().name = 'b'; else item.name.set('b'); }
    flushSync();
    return performance.now() - start;
  },
};`,
  { minify: false },
);

const browser = await launch();
let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};
const only = process.argv[2];
for (const [label, name] of [
  ['挂载再卸载整个应用', 'cycleApp'],
  ['条件分支反复切换', 'cycleBranch'],
  ['列表反复建满再清空', 'cycleList'],
  ['列表行逐个替换', 'cycleRows'],
  ['错误边界反复抛错再重试', 'cycleBoundary'],
  ['传送反复开关', 'cyclePortal'],
  ['深代理反复写入', 'cycleDeep'],
].filter(([, n]) => !only || n === only)) {
  const page = await openPage(browser, code);
  await page.evaluate(`window.api.setup('${name}')`);
  await page.evaluate('window.api.run(50)');
  const base = await heapAfterGc(page);
  const series = [];
  for (let batch = 0; batch < 12; batch++) {
    await page.evaluate('window.api.run(200)');
    series.push(Math.round(((await heapAfterGc(page)) - base) / 1024));
  }
  const peak = (from, to) => Math.max(...series.slice(from, to));
  const perCycle = (peak(9, 12) - peak(6, 9)) / 600;
  const sections = await page.evaluate('window.api.sections()');
  check(
    `${label}：后半段每轮增长 ${perCycle.toFixed(3)} KB（${series.join(', ')}），残留 section ${sections}`,
    perCycle < 0.02 && sections < 50,
    series,
  );
  await page.close();
}
console.log(
  '\n### 默认深代理的成本（1 万个对象，每个 2 个字段，取用 1 个）\n\n| 方式 | 创建 ms | 每个 KB | 全部写 1 个字段 ms |\n| --- | --- | --- | --- |',
);
for (const kind of ['sig', 'deep']) {
  const create = [];
  const heap = [];
  const update = [];
  for (let round = 0; round < 5; round++) {
    const page = await openPage(browser, code);
    const base = await heapAfterGc(page);
    create.push(await page.evaluate((k) => window.api.deepCost(10000, k), kind));
    heap.push(((await heapAfterGc(page)) - base) / 1024 / 10000);
    update.push(await page.evaluate((k) => window.api.deepUpdate(k), kind));
    await page.close();
  }
  console.log(
    `| ${kind === 'deep' ? 'sig({...})' : '每个字段 sig'} | ${median(create).toFixed(1)} | ${median(heap).toFixed(2)} | ${median(update).toFixed(1)} |`,
  );
}
await browser.close();
console.log(failed ? `\n${failed} 条失败` : '\n全部通过');
if (failed) process.exitCode = 1;
