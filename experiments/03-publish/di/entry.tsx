// 依赖注入：context、服务的语义。
import { component, createContext, createService, flushSync, inject, mount, provide } from '@hilt/runtime';

const log: Record<string, any> = { cartBuilt: 0, cartEffect: 0, cleanup: 0, loggerBuilt: 0, neverBuilt: 0 };
(window as any).log = log;
(window as any).flushSync = flushSync;

// 服务：普通函数，符文直接用，返回值是活对象
const Logger = createService(() => {
  log.loggerBuilt++;
  return { lines: [] as string[] };
});
const Cart = createService(() => {
  log.cartBuilt++;
  const logger = Logger.use(); // 服务依赖服务
  let items = _state<string[]>([]);
  const count = _derived(items.length);
  _effect(() => {
    count;
    log.cartEffect++;
  });
  return {
    items,
    count,
    add(item: string) {
      logger.lines.push(item);
      items = [...items, item];
    },
  };
});
createService(() => {
  log.neverBuilt++; // 没人用就不创建
});
const Never = createService(() => {
  log.neverBuilt++;
  return {};
});
void Never;

const Theme = createContext('fallback');

const Badge = _component(({ id }) => {
  const cart = Cart.use();
  return <b id={id}>{cart.count}</b>;
});
const AddButton = _component(({ id }) => {
  const cart = Cart.use();
  return <button id={id} onClick={() => cart.add('x')}>加</button>;
});

// 第一个调用者卸载后，服务还在
const Transient = _component(() => {
  Cart.use();
  return <i id="transient">临时</i>;
});

// 子树自己一份
const Scoped = _component(({ children }) => {
  Cart.provide();
  return <section id="scoped">{children}</section>;
});
// 测试替身
const Faked = _component(({ children }) => {
  Cart.provide({ items: [], count: 99, add() {} });
  return <section id="faked">{children}</section>;
});

const Theming = _component(({ value, children }) => {
  provide(Theme, value);
  return <div>{children}</div>;
});
const ThemeRead = _component(({ id }) => <em id={id}>{inject(Theme)}</em>);

// 活对象穿过 context：写 provide 不用手写 getter
const Tone = createContext<{ tone: string } | null>(null);
const ToneProvider = _component(({ tone, children }) => {
  provide(Tone, { tone });
  return <div>{children}</div>;
});
const ToneRead = _component(({ id }) => {
  const value = inject(Tone)!;
  return <em id={id}>{value.tone}</em>;
});

let tone = _state('red');
let showTransient = _state(true);
let lateSibling = _state(false);
(window as any).setTone = (next: string) => (tone = next);
(window as any).setTransient = (next: boolean) => (showTransient = next);
(window as any).setLate = (next: boolean) => (lateSibling = next);

const App = _component(() => (
  <main>
    {showTransient ? <Transient /> : null}
    <Badge id="a" />
    <AddButton id="add" />
    <Scoped>
      <Badge id="s" />
      <AddButton id="addS" />
    </Scoped>
    <Faked>
      <Badge id="f" />
    </Faked>
    <Theming value="outer">
      <ThemeRead id="t1" />
      <Theming value="inner">
        <ThemeRead id="t2" />
      </Theming>
      <ThemeRead id="t3" />
    </Theming>
    <ThemeRead id="t4" />
    <ToneProvider tone={tone}>
      <ToneRead id="tone" />
    </ToneProvider>
    {lateSibling ? <ThemeRead id="late" /> : null}
  </main>
));

(window as any).dispose = mount(() => component(App, {}), document.body);

// 两个应用实例各一份
(window as any).mountSecond = () => {
  const host = document.createElement('div');
  host.id = 'second';
  document.body.append(host);
  return mount(() => component(Badge, { id: 'second-badge' }), host);
};
(window as any).logger = () => log;
