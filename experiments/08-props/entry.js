// 父传子的几种形态。手写编译产物的形状，只有传参方式不同：5 个 prop，3 个静态、2 个响应式，子组件把它们写到元素上。
import { computed, flushSync, renderEffect, scope, signal } from '../01-reactive/core.mjs';

const template = document.createElement('div');
template.append(document.createElement('span'));

function write(el, name, value) {
  el.setAttribute(name, value);
}

// 子组件共用的 DOM 部分：各方案只有“怎么读 prop”不同
function leaf(readA, readB, readC, readX, readY) {
  const el = template.cloneNode(true);
  write(el, 'data-a', readA);
  write(el, 'data-b', readB);
  write(el, 'data-c', readC);
  renderEffect(() => write(el, 'title', readX()));
  renderEffect(() => write(el.firstChild, 'data-y', readY()));
  return el;
}

class LiftedProps {
  constructor(a, b, c, x, y) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.$x = x;
    this.$y = y;
  }
  get x() {
    return this.$x.value;
  }
  get y() {
    return this.$y.value;
  }
}

const VARIANTS = {
  // 1. 解构直读：调用方生成 getter 对象，子组件读 props.x（编译器把解构变量改写成这个）
  'getter 字面量': (i, x, y) => {
    const props = {
      a: 'a',
      b: i,
      c: 'c',
      get x() {
        return x.value;
      },
      get y() {
        return y.value;
      },
    };
    return leaf(props.a, props.b, props.c, () => props.x, () => props.y);
  },
  // 1'. 同样的写法，编译器把 getter 提升成类（实例化实验里的优化）
  'getter 提升成类': (i, x, y) => {
    const props = new LiftedProps('a', i, 'c', x, y);
    return leaf(props.a, props.b, props.c, () => props.x, () => props.y);
  },
  // 2. 函数 prop：<X x={() => s} />，子组件 x()
  '函数 prop': (i, x, y) => {
    const props = { a: 'a', b: i, c: 'c', x: () => x.value, y: () => y.value };
    return leaf(props.a, props.b, props.c, props.x, props.y);
  },
  // 3. 传 signal：<X x={s} />，子组件 x.value
  '传 signal': (i, x, y) => {
    const props = { a: 'a', b: i, c: 'c', x, y };
    return leaf(props.a, props.b, props.c, () => props.x.value, () => props.y.value);
  },
  // 3'. 传 signal，但值是表达式：<X x={s + 1} /> 只能先包成 computed
  '传 signal（表达式要包 computed）': (i, x, y) => {
    const props = { a: 'a', b: i, c: 'c', x: computed(() => x.value + 1), y: computed(() => y.value + 1) };
    return leaf(props.a, props.b, props.c, () => props.x.value, () => props.y.value);
  },
  // 1''. 解构直读，值是表达式：getter 里直接算，不多一个节点
  'getter（表达式）': (i, x, y) => {
    const props = {
      a: 'a',
      b: i,
      c: 'c',
      get x() {
        return x.value + 1;
      },
      get y() {
        return y.value + 1;
      },
    };
    return leaf(props.a, props.b, props.c, () => props.x, () => props.y);
  },
};

function mountAll(name, count) {
  const host = document.createElement('div');
  document.body.append(host);
  const shared = signal(0);
  const own = [];
  const make = VARIANTS[name];
  const dispose = scope(() => {
    for (let i = 0; i < count; i++) {
      const x = signal(i);
      own.push(x);
      host.append(make(i, x, shared));
    }
  });
  return { host, shared, own, dispose };
}

window.bench = (name, count) => {
  const start = performance.now();
  const app = mountAll(name, count);
  const mount = performance.now() - start;
  let t = performance.now();
  for (let i = 0; i < 1000; i++) {
    app.own[(i * 7919) % count].value = -i - 1;
    flushSync();
  }
  const one = performance.now() - t;
  t = performance.now();
  app.shared.value = 1;
  flushSync();
  const all = performance.now() - t;
  app.dispose();
  app.host.remove();
  return { mount, one, all };
};
window.hold = (name, count) => {
  window.__keep = mountAll(name, count);
};
window.names = Object.keys(VARIANTS);
