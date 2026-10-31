// sig 默认深代理：值在读出时才代理，壳本身不变。node --expose-gc 18-plain/deep-default.mjs
import { effect, flushSync, signal } from '../03-publish/packages/runtime/reactive.js';
import { raw, snapshot, state } from '../03-publish/packages/runtime/state.js';

// 写入时包一层 state：原始值、类实例、Date 原样；普通对象、数组、Map、Set 才代理
const deepSig = (value) => {
  const cell = signal(state(value));
  const read = () => cell.value;
  read.set = (next) => (cell.value = state(next));
  return read;
};
const rawSig = (value) => {
  const cell = signal(value);
  const read = () => cell.value;
  read.set = (next) => (cell.value = next);
  return read;
};

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};

console.log('## 语义');
{
  const form = deepSig({ name: 'a', age: 1, address: { city: '北京' } });
  let cityRuns = 0;
  let ageRuns = 0;
  let cityValue;
  effect(() => {
    cityRuns++;
    cityValue = form().address.city;
  });
  effect(() => {
    ageRuns++;
    void form().age;
  });
  form().address.city = '上海';
  flushSync();
  check('改嵌套字段：只有读它的 effect 重跑', cityRuns === 2 && ageRuns === 1 && cityValue === '上海', { cityRuns, ageRuns, cityValue });
  form.set({ name: 'b', age: 2, address: { city: '广州' } });
  flushSync();
  check('整体替换：新对象也是深代理，依赖它的都重跑', cityRuns === 3 && ageRuns === 2 && cityValue === '广州', { cityRuns, ageRuns, cityValue });
  form().address.city = '深圳';
  flushSync();
  check('替换后的对象改字段也响应', cityRuns === 4 && cityValue === '深圳', { cityRuns, cityValue });
}
{
  const user = deepSig(null);
  let seen;
  effect(() => {
    seen = user()?.name;
  });
  user.set({ name: '张三' });
  flushSync();
  check('初始是 null，之后给对象：按值判断，所以也是深代理', seen === '张三');
  user().name = '李四';
  flushSync();
  check('之后改字段响应', seen === '李四', seen);
}
{
  const list = deepSig([{ id: 1 }]);
  let length;
  effect(() => {
    length = list().length;
  });
  list().push({ id: 2 });
  flushSync();
  check('数组原地 push 响应', length === 2, length);
  const first = list()[0];
  check('同一行多次读身份稳定', first === list()[0]);
}
{
  const n = deepSig(1);
  check('原始值没有代理成本：读出来就是值', n() === 1 && typeof n() === 'number');
  const date = new Date(0);
  const when = deepSig(date);
  check('Date、类实例不代理', when() === date);
  class Store {
    x = 1;
  }
  const store = new Store();
  check('类实例不代理', deepSig(store)() === store);
}
console.log('\n## 已知的坑');
{
  const original = { a: 1 };
  const box = deepSig(original);
  console.log(`  box() === original：${box() === original}（代理和原对象不相等）`);
  console.log(`  raw(box()) === original：${raw(box()) === original}`);
  let cloneError = '';
  try {
    structuredClone(box());
  } catch (error) {
    cloneError = error.name;
  }
  console.log(`  structuredClone(box())：${cloneError || '成功'}；structuredClone(snapshot(box()))：${typeof structuredClone(snapshot(box()))}`);
  console.log(`  JSON.stringify(box())：${JSON.stringify(box())}`);
  const copy = { ...box() };
  console.log(`  { ...box() }：取出的是普通对象 ${copy.a === 1}`);
  const { a } = box();
  console.log(`  const { a } = box()：a 是值 ${a}，之后不再跟随`);
}

console.log('\n## 成本（1 万个对象，每个 2 个字段，每个对象一个 effect 读 1 个字段）');
const gc = globalThis.gc ?? (() => {});
const heap = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
const VARIANTS = {
  '每个字段一个 sig': { make: () => ({ name: rawSig('a'), age: rawSig(1) }), read: (o) => o.name(), write: (o) => o.name.set('b') },
  '不代理，整体替换（sig.raw）': { make: () => rawSig({ name: 'a', age: 1 }), read: (o) => o().name, write: (o) => o.set({ ...o(), name: 'b' }) },
  'sig 默认深代理': { make: () => deepSig({ name: 'a', age: 1 }), read: (o) => o().name, write: (o) => (o().name = 'b') },
};
const COUNT = 10000;
console.log('\n| 方式 | 创建 ms | 每个 KB | 全部写一个字段 ms | 只读 100 万次 ms |\n| --- | --- | --- | --- | --- |');
for (let pass = 0; pass < 2; pass++) {
  for (const [label, variant] of Object.entries(VARIANTS)) {
    const created = [];
    const kb = [];
    const written = [];
    const reads = [];
    for (let round = 0; round < 7; round++) {
      const before = heap();
      const start = performance.now();
      const items = [];
      const stops = [];
      for (let i = 0; i < COUNT; i++) {
        const item = variant.make();
        items.push(item);
        stops.push(effect(() => void variant.read(item)));
      }
      created.push(performance.now() - start);
      kb.push((heap() - before) / 1024 / COUNT);
      const writeStart = performance.now();
      for (const item of items) variant.write(item);
      flushSync();
      written.push(performance.now() - writeStart);
      const readStart = performance.now();
      let sum = 0;
      for (let i = 0; i < 1_000_000; i++) sum += variant.read(items[i % COUNT]).length;
      reads.push(performance.now() - readStart);
      if (!sum) throw new Error('unused');
      for (const stop of stops) stop();
    }
    // 第一轮只热身，不打印
    if (pass) console.log(`| ${label} | ${median(created).toFixed(1)} | ${median(kb).toFixed(2)} | ${median(written).toFixed(1)} | ${median(reads).toFixed(1)} |`);
  }
}
console.log(failed ? `\n${failed} 条失败` : '\n语义全部通过');
if (failed) process.exitCode = 1;
