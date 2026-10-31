// 成本对比：手写细粒度（每字段一个 signal）/ 本实验的 state（懒建 + Svelte 式即建）/ Vue 3.5 reactive / 无响应式基线
//   node --expose-gc 06-deep/bench.mjs            每个方案一个进程，汇总成表
//   node --expose-gc 06-deep/bench.mjs state      只跑一个方案（plain | manual | state | stateEager | vue），输出 JSON
// 数字只看量级：中位数、先热身；机器上有别的进程时会飘。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { effect, signal, flushSync, untrack } from '../03-publish/packages/runtime/reactive.js';
import { state, options } from '../03-publish/packages/runtime/state.js';
import { reactive, effect as vueEffect, stop as vueStop } from '@vue/reactivity';

const N = 10_000;
const PASSES = 100;
const ROUNDS = 7;
const WARMUP = 2;

const makeRaw = () => Array.from({ length: N }, (_, i) => ({ id: i, label: 'row ' + i, done: false }));

// 每个方案：build() 造 1 万行；read(row) 读三个字段；watch(row) 建一个读 id、done 的 effect 并返回销毁函数；markDone(row)；
// list 是 build 的结果，rows(list) 返回行的迭代方式
const ADAPTERS = {
  plain: {
    build: makeRaw,
    row: (list, i) => list[i],
    read: (r) => r.id + (r.done ? 1 : 0) + r.label.length,
    watch: () => () => {},
    write: (r) => void (r.done = true),
    flush() {},
  },
  manual: {
    build: () =>
      makeRaw().map((r) => ({ id: signal(r.id), label: signal(r.label), done: signal(r.done) })),
    row: (list, i) => list[i],
    read: (r) => r.id.value + (r.done.value ? 1 : 0) + r.label.value.length,
    watch: (r) =>
      effect(() => {
        r.id.value;
        r.done.value;
      }),
    write: (r) => void (r.done.value = true),
    flush: flushSync,
  },
  state: coreProxy(true),
  stateEager: coreProxy(false),
  vue: {
    build: () => reactive(makeRaw()),
    row: (list, i) => list[i],
    read: (r) => r.id + (r.done ? 1 : 0) + r.label.length,
    watch(r) {
      const runner = vueEffect(() => {
        r.id;
        r.done;
      });
      return () => vueStop(runner);
    },
    write: (r) => void (r.done = true),
    flush() {}, // Vue 的 effect 默认同步：写一次跑一次，没有批处理
  },
};
function coreProxy(lazy) {
  return {
    setup: () => (options.lazySignals = lazy),
    build: () => state(makeRaw()),
    row: (list, i) => list[i],
    read: (r) => r.id + (r.done ? 1 : 0) + r.label.length,
    watch: (r) =>
      effect(() => {
        r.id;
        r.done;
      }),
    write: (r) => void (r.done = true),
    flush: flushSync,
  };
}

const median = (values) => values.toSorted((a, b) => a - b)[values.length >> 1];
/** setup 不计时，run 计时；热身若干轮后取中位数（毫秒） */
function bench(setup, run, rounds = ROUNDS) {
  const times = [];
  for (let i = 0; i < rounds + WARMUP; i++) {
    const context = setup();
    const start = performance.now();
    run(context);
    const elapsed = performance.now() - start;
    if (i >= WARMUP) times.push(elapsed);
    context?.cleanup?.();
  }
  return median(times);
}

const heap = () => {
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed;
};
const keep = [];
/** 造 1 万行并保持存活（放在独立函数里：解释器栈帧里残留的旧引用会让前后对比失真） */
function buildKept(adapter, withEffects) {
  const list = adapter.build();
  const stops = [];
  for (let j = 0; j < N; j++) {
    const row = adapter.row(list, j);
    if (withEffects) stops.push(adapter.watch(row));
    else untrack(() => adapter.read(row)); // 读一遍：让懒代理、即建 signal 的方案把该建的建出来
  }
  keep.push(list, stops);
  return stops;
}
/** 每行字节数：只读 / 每行再挂一个 effect。一次采样一个函数调用，栈帧里不会残留上一次的引用 */
function sampleBytes(adapter, withEffects) {
  const before = heap();
  buildKept(adapter, withEffects);
  const after = heap();
  keep.length = 0; // 不显式销毁 effect：整批丢弃由 GC 回收
  return (after - before) / N;
}
function bytesPerRow(adapter, withEffects) {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const bytes = sampleBytes(adapter, withEffects);
    if (i >= 2) samples.push(bytes);
  }
  return median(samples);
}

function runOne(name) {
  const adapter = ADAPTERS[name];
  adapter.setup?.();
  const result = {};

  // A 创建 1 万行并全部读一遍（含懒代理 / 即建 signal 的首次成本）
  result.create = bench(() => null, () => keep.push(adapter.build()));
  keep.length = 0;
  result.firstRead = bench(
    () => ({ list: adapter.build() }),
    ({ list }) => {
      let sum = 0;
      for (let i = 0; i < N; i++) sum += adapter.read(adapter.row(list, i));
      return sum;
    },
  );

  // B 每行一个 effect 读 id、done；再把全部 done 写成 true（含 flush）
  result.watch = bench(
    () => {
      const list = adapter.build();
      const rows = Array.from({ length: N }, (_, i) => adapter.row(list, i));
      return { list, rows, stops: [] };
    },
    (ctx) => {
      for (const row of ctx.rows) ctx.stops.push(adapter.watch(row));
      ctx.done = true;
    },
  );
  result.write = bench(
    () => {
      const list = adapter.build();
      const rows = Array.from({ length: N }, (_, i) => adapter.row(list, i));
      const stops = rows.map((row) => adapter.watch(row));
      return { list, rows, cleanup: () => stops.forEach((stop) => stop()) };
    },
    (ctx) => {
      for (let i = 0; i < N; i++) adapter.write(adapter.row(ctx.list, i));
      adapter.flush();
    },
  );

  // C 不追踪地遍历 1 万行 ×100 遍
  const list = adapter.build();
  result.traverse = bench(
    () => null,
    () => {
      let sum = 0;
      for (let pass = 0; pass < PASSES; pass++) {
        for (let i = 0; i < N; i++) sum += adapter.read(adapter.row(list, i));
      }
      return sum;
    },
    5,
  );

  // D 内存：每行字节数（只读 / 每行挂 effect）
  result.bytesRead = bytesPerRow(adapter, false);
  if (name !== 'plain') result.bytesWatched = bytesPerRow(adapter, true);

  // E 数组整体操作（plain 用原数组，Vue 用 reactive，state 用改写后的方法；“经陷阱”= 不改写，等价于 Svelte 的路径）
  if (name !== 'manual') {
    const rows = adapter.build();
    const last = name === 'plain' ? rows[N - 1] : adapter.row(rows, N - 1);
    const lastRaw = typeof last === 'object' ? (name === 'vue' ? rawOf(last) : rawOfState(last)) : last;
    const search = (needle) => bench(() => null, () => {
      for (let i = 0; i < PASSES; i++) rows.includes(needle);
    });
    result.includes = search(lastRaw);
    result.mapAll = bench(() => null, () => {
      for (let i = 0; i < PASSES; i++) rows.map((r) => r.id);
    });
    if (name.startsWith('state')) {
      result.includesViaTraps = bench(() => null, () => {
        for (let i = 0; i < PASSES; i++) Array.prototype.includes.call(rows, lastRaw);
      });
      result.mapViaTraps = bench(() => null, () => {
        for (let i = 0; i < PASSES; i++) Array.prototype.map.call(rows, (r) => r.id);
      });
    }
  }
  return result;
}
import { raw as rawOfState } from '../03-publish/packages/runtime/state.js';
import { toRaw as rawOf } from '@vue/reactivity';

const NAMES = Object.keys(ADAPTERS);
const only = process.argv[2];
if (only) {
  if (!global.gc) throw new Error('需要 node --expose-gc');
  console.log(JSON.stringify(runOne(only)));
} else {
  const results = {};
  for (const name of NAMES) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), name], { encoding: 'utf8' });
    if (child.status !== 0) {
      console.error(name, '失败：', child.stderr);
      continue;
    }
    results[name] = JSON.parse(child.stdout.trim().split('\n').at(-1));
    console.log(`${name} done`);
  }
  const fmt = (v, digits = 1) => (v === undefined ? '-' : v.toFixed(digits));
  const rows = [
    ['创建 1 万行（ms）', 'create'],
    ['首次全读 1 万行（ms）', 'firstRead'],
    ['建 1 万个 effect（ms）', 'watch'],
    ['写全部 done + flush（ms）', 'write'],
    [`不追踪遍历 ×${PASSES}（ms）`, 'traverse'],
    ['字节/行 只读', 'bytesRead', 0],
    ['字节/行 每行一个 effect', 'bytesWatched', 0],
    [`includes 末尾元素 ×${PASSES}（ms）`, 'includes'],
    ['  同上，不改写方法（经陷阱）', 'includesViaTraps'],
    [`map(r=>r.id) 1 万行 ×${PASSES}（ms）`, 'mapAll'],
    ['  同上，不改写方法（经陷阱）', 'mapViaTraps'],
  ];
  console.log(`\n${'N=' + N}`.padEnd(40) + NAMES.map((n) => n.padStart(12)).join(''));
  for (const [label, key, digits] of rows) {
    console.log(label.padEnd(38) + NAMES.map((n) => fmt(results[n]?.[key], digits ?? 1).padStart(12)).join(''));
  }
  console.log('\nplain=无响应式；manual=每字段一个 signal；state=懒建；stateEager=任何读都建（Svelte 式）；vue=@vue/reactivity（effect 同步，无批处理）');
}
