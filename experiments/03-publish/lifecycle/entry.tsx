// 生命周期语义：卸载、context、批处理、effect 抛错。
import { createContext, effect, flushSync, For, inject, mount, provide, signal } from '@hilt/runtime';

const log = { childRuns: 0, childCleanups: 0, rowRuns: 0, rowCleanups: 0, batchRuns: 0, sumRuns: 0, afterThrow: 0, childrenBuilt: 0 };
(window as any).log = log;

const Theme = createContext('fallback');

let tick = _state(0);
let show = _state(true);
let lateShow = _state(false);
const rows = _state([{ id: 1 }, { id: 2 }, { id: 3 }]);

const Child = _component(() => {
  _effect(() => {
    tick;
    log.childRuns++;
    return () => log.childCleanups++;
  });
  return <span id="child">child</span>;
});

const Row = _component(({ row }) => {
  _effect(() => {
    tick;
    log.rowRuns++;
    return () => log.rowCleanups++;
  });
  return <li>{row.id}</li>;
});

// _effect 第一次执行时：ref 已拿到，元素已挂到文档上；函数体比它先跑完
const Probe = _component(() => {
  let el = _state.raw<HTMLElement | null>(null);
  log.order = ['body'];
  _effect(() => {
    log.order.push('effect');
    log.connected = el?.isConnected ?? 'no element';
  });
  log.order.push('body-end');
  return <b id="probe" ref={el}>探针</b>;
});

const Consumer = _component(({ id }) => <span id={id}>{inject(Theme)}</span>);

const Provider = _component(({ value, children }) => {
  provide(Theme, value);
  return <div class="provider">{children}</div>;
});

// 批处理与读后即写
let a = _state(1);
let b = _state(2);
const sum = _derived(a + b);
_effect(() => {
  sum;
  log.sumRuns++;
});

// children 读两次
const Twice = _component(({ children }) => (
  <div id="twice">
    <p>{children}</p>
    <p>{children}</p>
  </div>
));
const Counted = _component(() => {
  log.childrenBuilt++;
  return <b>x</b>;
});

// effect 抛错不牵连同一轮的其他 effect
const boom = signal(0);
const errors: string[] = [];
window.addEventListener('error', (event) => {
  errors.push(event.message);
  event.preventDefault();
});
effect(() => {
  if (boom.value === 1) throw new Error('boom');
});
effect(() => {
  void boom.value;
  log.afterThrow++;
});

(window as any).api = {
  setTick: (next: number) => (tick = next),
  setShow: (next: boolean) => (show = next),
  setLateShow: (next: boolean) => (lateShow = next),
  removeRow: () => rows.pop(),
  batch: () => {
    a = 10;
    b = 20;
    a = 100;
    return sum; // 同一轮里读派生值要是新的
  },
  boom: (next: number) => (boom.value = next),
  errors,
  flushSync,
};

const App = _component(() => (
  <main>
    {show ? <Child /> : null}
    <ul id="rows">
      <For each={rows}>{(row: { id: number }) => <Row row={row} />}</For>
    </ul>
    <Provider value="dark">
      <Consumer id="eager" />
      {lateShow ? <Consumer id="late" /> : null}
    </Provider>
    <Consumer id="outside" />
    <Probe />
    <Twice>
      <Counted />
    </Twice>
  </main>
));

mount(() => <App />, document.body);
