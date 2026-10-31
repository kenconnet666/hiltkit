// 实验一：响应式内核选型。每个库单独一个进程跑，避免互相污染 JIT。
//   node --expose-gc 01-reactive/bench.mjs            跑全部并汇总
//   node --expose-gc 01-reactive/bench.mjs alien      只跑一个（内部用）
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deepState } from './deep-state.mjs';

const ADAPTERS = {
  // 自建薄内核（alien-signals/system + 两个队列 + 微任务批处理 + 错误隔离 + owner）
  async core() {
    const c = await import('./core.mjs');
    return {
      signal: (v) => {
        const s = c.signal(v);
        return {
          get: () => s.value,
          set: (n) => {
            s.value = n;
          },
        };
      },
      computed: (fn) => {
        const node = c.computed(fn);
        return () => node.value;
      },
      effect: (fn) =>
        c.renderEffect(() => {
          fn();
        }),
      root: (fn) => c.scope(fn),
      flush: c.flushSync,
    };
  },
  // 同上，但测的是编译产物会直接写的形状：x.value，不经过适配层的闭包
  async coreDirect() {
    const c = await import('./core.mjs');
    return {
      signal: (v) => {
        const s = c.signal(v);
        return {
          node: s,
          get: () => s.value,
          set: (n) => {
            s.value = n;
          },
        };
      },
      computed: (fn) => {
        const node = c.computed(fn);
        return () => node.value;
      },
      effect: (fn) => c.renderEffect(fn),
      root: (fn) => c.scope(fn),
      flush: c.flushSync,
    };
  },
  async alien() {
    const a = await import('alien-signals');
    return {
      signal: (v) => {
        const s = a.signal(v);
        return { get: s, set: s };
      },
      computed: (fn) => a.computed(fn),
      effect: (fn) => a.effect(fn),
      root: (fn) => a.effectScope(fn),
      flush() {},
    };
  },
  async vue35() {
    const r = await import('@vue/reactivity');
    return vueAdapter(r);
  },
  async vue36() {
    const r = await import('vue-reactivity-36');
    return vueAdapter(r);
  },
  async preact() {
    const p = await import('@preact/signals-core');
    return {
      signal: (v) => {
        const s = p.signal(v);
        return { get: () => s.value, set: (n) => (s.value = n) };
      },
      computed: (fn) => {
        const c = p.computed(fn);
        return () => c.value;
      },
      effect: (fn) => p.effect(fn),
      // preact 没有作用域：手动收集
      root: (fn) => {
        const stops = [];
        const prev = current;
        current = stops;
        fn();
        current = prev;
        return () => stops.forEach((stop) => stop());
      },
      flush() {},
    };
  },
  async solid2() {
    const s = await import('@solidjs/signals');
    return {
      signal: (v) => {
        const [get, set] = s.createSignal(v);
        return { get, set: (n) => set(() => n) };
      },
      computed: (fn) => s.createMemo(fn),
      // 渲染 effect：同 alien、Vue 的同步 effect 最接近
      effect: (fn) =>
        s.createRenderEffect(
          () => fn(),
          () => {},
        ),
      root: (fn) => {
        let dispose;
        s.createRoot((d) => {
          dispose = d;
          fn();
        });
        s.flush();
        return dispose;
      },
      flush: s.flush,
    };
  },
};
let current;

function vueAdapter(r) {
  return {
    signal: (v) => {
      const s = r.shallowRef(v);
      return { get: () => s.value, set: (n) => (s.value = n) };
    },
    computed: (fn) => {
      const c = r.computed(fn);
      return () => c.value;
    },
    effect: (fn) => r.effect(fn),
    root: (fn) => {
      const scope = r.effectScope(true);
      scope.run(fn);
      return () => scope.stop();
    },
    flush() {},
    reactive: r.reactive,
  };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const time = (fn) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

const CASES = {
  // 挂载类：组件树创建时的成本
  // 持有引用，否则 JIT 会把没人用的创建整个优化掉
  'create 100k signal': (r) => () => {
    const keep = new Array(100_000);
    for (let i = 0; i < 100_000; i++) keep[i] = r.signal(i);
    globalThis.__keep = keep;
  },
  'create 100k computed': (r) => () => {
    const s = r.signal(0);
    const keep = new Array(100_000);
    const dispose = r.root(() => {
      for (let i = 0; i < 100_000; i++) keep[i] = r.computed(() => s.get());
    });
    globalThis.__keep = keep;
    dispose?.();
  },
  'create+dispose 100k effect': (r) => () => {
    const s = r.signal(0);
    const dispose = r.root(() => {
      for (let i = 0; i < 100_000; i++) {
        r.effect(() => {
          s.get();
        });
      }
    });
    r.flush();
    dispose();
  },
  // 更新类：一个绑定一个 effect 时最常见的形状
  'fanout 1->10k x100': (r) => {
    const s = r.signal(0);
    let sink = 0;
    const dispose = r.root(() => {
      for (let i = 0; i < 10_000; i++) {
        r.effect(() => {
          sink += s.get();
        });
      }
    });
    r.flush();
    let n = 0;
    return Object.assign(
      () => {
        for (let i = 0; i < 100; i++) {
          s.set(++n);
          r.flush();
        }
      },
      { dispose, sink },
    );
  },
  'chain 1000 x1000': (r) => {
    const s = r.signal(0);
    let sink = 0;
    const dispose = r.root(() => {
      let last = s.get;
      for (let i = 0; i < 1000; i++) {
        const prev = last;
        last = r.computed(() => prev() + 1);
      }
      r.effect(() => {
        sink += last();
      });
    });
    r.flush();
    let n = 0;
    return Object.assign(
      () => {
        for (let i = 0; i < 1000; i++) {
          s.set(++n);
          r.flush();
        }
      },
      { dispose },
    );
  },
  'diamond 1000 x1000': (r) => {
    const s = r.signal(0);
    let sink = 0;
    const dispose = r.root(() => {
      const mids = [];
      for (let i = 0; i < 1000; i++) mids.push(r.computed(() => s.get() + i));
      const sum = r.computed(() => mids.reduce((total, mid) => total + mid(), 0));
      r.effect(() => {
        sink += sum();
      });
    });
    r.flush();
    let n = 0;
    return Object.assign(
      () => {
        for (let i = 0; i < 1000; i++) {
          s.set(++n);
          r.flush();
        }
      },
      { dispose },
    );
  },
  // 条件切换依赖：v-if / 三元里最常见
  'dynamic deps 1000 effects x200': (r) => {
    const cond = r.signal(true);
    const a = r.signal(1);
    const b = r.signal(2);
    let sink = 0;
    const dispose = r.root(() => {
      for (let i = 0; i < 1000; i++) {
        r.effect(() => {
          sink += cond.get() ? a.get() : b.get();
        });
      }
    });
    r.flush();
    let flag = true;
    return Object.assign(
      () => {
        for (let i = 0; i < 200; i++) {
          cond.set((flag = !flag));
          r.flush();
        }
      },
      { dispose },
    );
  },
};

/** 每个 signal + effect 对占多少内存：细粒度框架每个绑定就是一对 */
function memoryPerBinding(r) {
  const N = 100_000;
  const keep = [];
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  const dispose = r.root(() => {
    for (let i = 0; i < N; i++) {
      const s = r.signal(i);
      // 只留节点：编译产物里 signal 就是这个节点，不会多一个适配层对象
      keep.push(s.node ?? s);
      if (s.node) {
        const node = s.node;
        r.effect(() => {
          node.value;
        });
      } else {
        r.effect(() => {
          s.get();
        });
      }
    }
  });
  r.flush();
  globalThis.gc();
  const bytes = (process.memoryUsage().heapUsed - before) / N;
  dispose();
  return Math.round(bytes);
}

async function runOne(name) {
  const r = await ADAPTERS[name]();
  const result = {};
  for (const [label, setup] of Object.entries(CASES)) {
    // 前两轮只热身
    const rounds = [];
    for (let round = 0; round < 7; round++) {
      const run = setup(r);
      const ms = time(run);
      run.dispose?.();
      if (round >= 2) rounds.push(ms);
    }
    result[label] = +median(rounds).toFixed(2);
  }
  result['bytes per signal+effect'] = memoryPerBinding(r);
  if (r.reactive) result.deep = deepBench(r.reactive, r);
  if (name === 'alien') result.deep = deepBench(deepState, r);
  console.log(JSON.stringify(result));
}

/** 深层代理：_state({...}) 的成本。1 万个对象的数组，每个对象一个 effect 读两个属性 */
function deepBench(reactive, r) {
  const build = () =>
    reactive({
      rows: Array.from({ length: 10_000 }, (_, id) => ({ id, label: `row ${id}`, done: false })),
    });
  const create = median(
    Array.from({ length: 5 }, () => {
      let state;
      const ms = time(() => {
        state = build();
        for (const row of state.rows) row.id;
      });
      return state ? ms : 0;
    }),
  );
  const state = build();
  let sink = 0;
  const dispose = r.root(() => {
    for (const row of state.rows) {
      r.effect(() => {
        sink += row.id;
        if (row.done) sink++;
      });
    }
  });
  r.flush();
  let flag = false;
  const update = median(
    Array.from({ length: 5 }, () =>
      time(() => {
        flag = !flag;
        for (const row of state.rows) row.done = flag;
        r.flush();
      }),
    ),
  );
  dispose();
  return { 'mount 10k row proxies': +create.toFixed(2), 'write 10k row.done': +update.toFixed(2) };
}

const only = process.argv[2]?.includes(',') ? undefined : process.argv[2];
const subset = process.argv[2]?.includes(',') ? process.argv[2].split(',') : undefined;
if (only) {
  await runOne(only);
} else {
  const self = fileURLToPath(import.meta.url);
  const table = {};
  for (const name of subset ?? Object.keys(ADAPTERS)) {
    const child = spawnSync(process.execPath, ['--expose-gc', self, name], { encoding: 'utf8' });
    if (child.status !== 0) {
      console.log(`${name} failed:\n${child.stderr.slice(0, 1500)}`);
      continue;
    }
    table[name] = JSON.parse(child.stdout.trim().split('\n').pop());
  }
  const names = Object.keys(table);
  const rows = Object.keys(table[names[0]]).filter((key) => key !== 'deep');
  console.log(['case', ...names].join(' | '));
  for (const row of rows) console.log([row, ...names.map((n) => table[n][row] ?? '-')].join(' | '));
  for (const n of names) if (table[n].deep) console.log(n, JSON.stringify(table[n].deep));
}
