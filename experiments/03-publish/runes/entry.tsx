// 候选规则的验证：活对象、ref={el}、组件体顶层读的诊断。
import { createContext, effect, flushSync, inject, mount, provide, warnings } from '@hilt/runtime';

const log: Record<string, any> = {};
(window as any).log = log;
(window as any).warnings = warnings;
(window as any).flushSync = flushSync;

// ---- 组合式函数：普通函数，符文可以直接用，返回值就是活的 ----
function useCounter(start: number) {
  let count = _state(start);
  const doubled = _derived(count * 2);
  return { count, doubled, inc: () => count++ };
}

// 两种传参：读取函数（现在的约定）和活对象（候选）。各两个 effect 读不同字段，数改一个字段重跑几次
function useByRead(read: () => { size: string; tone: string }, name: string) {
  log[`${name}.size`] = 0;
  log[`${name}.tone`] = 0;
  effect(() => {
    read().size;
    log[`${name}.size`]++;
  });
  effect(() => {
    read().tone;
    log[`${name}.tone`]++;
  });
}
function useByLive(options: { size: string; tone: string }, name: string) {
  log[`${name}.size`] = 0;
  log[`${name}.tone`] = 0;
  effect(() => {
    options.size;
    log[`${name}.size`]++;
  });
  effect(() => {
    options.tone;
    log[`${name}.tone`]++;
  });
}

const Theme = createContext<{ color: string } | null>(null);

const Consumer = _component(() => {
  const theme = inject(Theme)!;
  return <span id="ctx">{theme.color}</span>;
});

const Comp = _component(({ size = 'md', tone, children }) => {
  useByRead(() => ({ size, tone }), 'read');
  useByLive({ size, tone }, 'live');

  let color = _state('red');
  provide(Theme, { color });
  (window as any).setColor = (next: string) => (color = next);

  // 组合式函数的返回值
  const counter = useCounter(1);
  (window as any).counter = counter;
  log.counterSeen = 0;
  effect(() => {
    log.counterSeen = counter.count;
  });

  // 嵌套函数里的字面量：调用时的快照，不是活的
  let shot = _state(1);
  const pending: { shot: number }[] = [];
  (window as any).fire = () => pending.push({ shot });
  (window as any).pending = pending;
  (window as any).setShot = (next: number) => (shot = next);

  // _state 的参数是初始值：不活，也不报诊断
  let form = _state({ size });
  (window as any).readForm = () => form;

  // const 派生：活，但没有 setter
  const label = _derived(`${size}!`);
  (window as any).derivedBag = { label };

  // 元素引用：不用第二个符文
  let el = _state.raw<HTMLElement | null>(null);
  log.elSeen = null;
  effect(() => {
    log.elSeen = el?.tagName ?? null;
  });

  return (
    <section id="comp" ref={el} data-size={size}>
      <Consumer />
      {children}
    </section>
  );
});

const Bad = _component(() => {
  const counter = useCounter(5);
  const { count } = counter; // 解构：只拿到当前值，诊断要能查到，哪怕 useCounter 在别的文件
  return <i id="bad">{count}</i>;
});

const Good = _component(() => {
  const counter = useCounter(5);
  const initial = _untrack(counter.count); // 明确只要初始值：不报
  return <i id="good">{initial}{counter.count}</i>;
});

let size = _state('sm');
let tone = _state('blue');
(window as any).setSize = (next: string) => (size = next);
(window as any).setTone = (next: string) => (tone = next);

const App = _component(() => (
  <main>
    <Comp size={size} tone={tone}>
      内容
    </Comp>
  </main>
));

mount(() => <App />, document.body);
(window as any).mountGood = () => {
  const before = warnings.length;
  mount(() => <Good />, document.body);
  return warnings.length - before;
};
(window as any).mountBad = () => {
  const before = warnings.length;
  mount(() => <Bad />, document.body);
  return warnings.length - before;
};
