// 优化 8 的验证：对象字面量里的 getter 对隐藏类、分配、读取的影响；原型 getter 的类作对照。
//   node 07-instance/shape.mjs
import { chromium } from 'playwright';
import { heapAfterGc, median } from '../lib/browser.mjs';

const browser = await chromium.launch({
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc --allow-natives-syntax'],
});
const N = 50_000;

// 在页面里执行的代码：定义几种 props 对象的构造方式
const setup = `
  const cell = { value: 1 };
  const sameMap = new Function('a', 'b', 'return %HaveSameMap(a, b)');
  const sameMapAcrossShapes = (a, b) => sameMap(a, b);
  window.sameMapAcrossShapes = sameMapAcrossShapes;
  // 编译产物现在的写法：getter 是对象字面量里的访问器，闭包每实例新建
  const literalAccessor = (c) => ({
    get title() { return c.value; },
    get loading() { return c.value; },
    get 'data-computed'() { return 'x'; },
    'aria-label': 'x',
    class: 'user',
    'data-id': 1,
  });
  // shape：访问器在原型上，实例只有数据字段
  class Shaped {
    constructor(c) { this.c = c; this['aria-label'] = 'x'; this.class = 'user'; this['data-id'] = 1; }
    get title() { return this.c.value; }
    get loading() { return this.c.value; }
    get 'data-computed'() { return 'x'; }
  }
  // 对照：同样的键，纯数据
  const literalData = (c) => ({ title: c.value, loading: c.value, 'data-computed': 'x', 'aria-label': 'x', class: 'user', 'data-id': 1 });
  const literalDataReordered = (c) => ({ loading: c.value, title: c.value, 'data-computed': 'x', 'aria-label': 'x', class: 'user', 'data-id': 1 });
  const sharedGetter = function () { return 1; };
  const definedShared = (c) => {
    const o = { class: 'user' };
    Object.defineProperty(o, 'title', { get: sharedGetter, enumerable: true, configurable: true });
    return o;
  };
  window.kinds = {
    'literal 访问器（每实例新闭包）': literalAccessor,
    'class 原型访问器': (c) => new Shaped(c),
    '数据字面量': literalData,
    '数据字面量（键顺序不同）': literalDataReordered,
    'defineProperty 共享 getter 函数': definedShared,
  };
  window.cell = cell;
`;

const names = [
  'literal 访问器（每实例新闭包）',
  'class 原型访问器',
  '数据字面量',
  '数据字面量（键顺序不同）',
  'defineProperty 共享 getter 函数',
];
const out = {};
for (const name of names) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: setup });
  const timing = await page.evaluate(
    ([name, N]) => {
      const make = window.kinds[name];
      const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const times = [];
      for (let round = 0; round < 7; round++) {
        gc();
        const t0 = performance.now();
        const items = new Array(N);
        for (let i = 0; i < N; i++) items[i] = make(window.cell);
        times.push(performance.now() - t0);
        window.__tmp = items;
      }
      window.__tmp = undefined;
      const items = new Array(N);
      for (let i = 0; i < N; i++) items[i] = make(window.cell);
      let sink = 0;
      const timeIt = (rounds, fn) => {
        const ts = [];
        for (let r = 0; r < rounds; r++) {
          const t0 = performance.now();
          fn();
          ts.push(performance.now() - t0);
        }
        return median(ts);
      };
      const read = timeIt(7, () => { for (let r = 0; r < 20; r++) for (let i = 0; i < N; i++) sink += items[i].title ? 1 : 0; });
      const keys = timeIt(5, () => { for (let i = 0; i < N; i++) sink += Object.keys(items[i]).length; });
      const desc = timeIt(5, () => { for (let i = 0; i < N; i++) sink += Object.getOwnPropertyDescriptor(items[i], 'title') ? 1 : 0; });
      const inOp = timeIt(5, () => { for (let i = 0; i < N; i++) sink += 'title' in items[i] ? 1 : 0; });
      void sink;
      return {
        same: window.sameMapAcrossShapes(items[0], items[1]),
        create: median(times),
        read,
        keys,
        desc,
        inOp,
      };
    },
    [name, N],
  );
  await page.close();
  // 堆：新页面，GC 前后差
  const heapPage = await browser.newPage();
  await heapPage.setContent('<!doctype html><html><body></body></html>');
  await heapPage.addScriptTag({ content: setup });
  const empty = await heapAfterGc(heapPage);
  await heapPage.evaluate(([name, N]) => { const make = window.kinds[name]; const items = new Array(N); for (let i = 0; i < N; i++) items[i] = make(window.cell); window.__keep = items; }, [name, N]);
  const used = await heapAfterGc(heapPage);
  await heapPage.close();
  out[name] = {
    '同一张 Map（%HaveSameMap）': timing.same,
    '创建 ms / 万个': +((timing.create / N) * 10000).toFixed(2),
    '堆 B / 个（GC 后）': Math.round((used - empty) / N),
    '读 title ms / 百万次': +((timing.read / (N * 20)) * 1e6).toFixed(1),
    'Object.keys ms / 万次': +((timing.keys / N) * 10000).toFixed(2),
    'getOwnPropertyDescriptor ms / 万次': +((timing.desc / N) * 10000).toFixed(2),
    "'title' in o ms / 万次": +((timing.inOp / N) * 10000).toFixed(2),
  };
}
const metrics = Object.keys(out[names[0]]);
console.log(['指标', ...names].join(' | '));
for (const metric of metrics) console.log([metric, ...names.map((n) => out[n][metric])].join(' | '));
await browser.close();
