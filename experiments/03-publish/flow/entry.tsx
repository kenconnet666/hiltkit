// 父传子、子传父的各种形态。
import { component, flushSync, mount } from '@hilt/runtime';

const log: Record<string, any> = { bodyRuns: 0, slotBuilt: 0, unreadProp: 0, renderRuns: 0, leafReads: 0, inner: [], depth: 0 };
(window as any).log = log;
(window as any).flushSync = flushSync;

const expensive = () => {
  log.unreadProp++;
  return 'x';
};

// ---- 父传子 ----
const Leaf = _component(({ value, unused, size = 'md', icon = size === 'md' ? '中' : '大' }) => {
  log.bodyRuns++;
  // unused 只解构、没有读：不求值
  return (
    <p id="leaf" data-size={size}>
      {icon}:{value}
    </p>
  );
});
// 中间层不碰 value，只转交
const Pass1 = _component(({ ...rest }) => <Leaf {...rest} />);
const Pass2 = _component(({ ...rest }) => <Pass1 {...rest} />);

// 槽：普通 prop，读的时候才创建；作用域槽：参数是活的
const Slotted = _component(({ header, children, item, open }) => {
  let hover = _state(0);
  (window as any).setHover = (next: number) => (hover = next);
  return (
    <section id="slotted">
      {open ? <header id="slot-header">{header}</header> : null}
      <div id="slot-item">{item({ hover })}</div>
      {children}
    </section>
  );
});
const SlotContent = _component(() => {
  log.slotBuilt++;
  return <em>头</em>;
});

// ---- 子传父：回调跨组件层 ----
const Inner = _component(({ onPick, ...rest }) => (
  <button
    id="pick"
    {...rest}
    onClick={() => {
      onPick?.('v');
    }}
  >
    选
  </button>
));
// 组件内部写了 onPick，使用方也写了：两个都要执行，和元素上的事件同一条规则
const Mid = _component(({ ...rest }) => (
  <Inner
    onPick={(value: string) => {
      log.inner.push(`mid:${value}`);
    }}
    {...rest}
  />
));

// ---- 双向绑定 ----
const Input = _component(({ value = _bindable(''), ...rest }) => (
  <input {...rest} value={_bind(value)} />
));
// 中间层不声明，靠 rest 转交
const Forward = _component(({ ...rest }) => <Input {...rest} />);
// 中间层声明了，再绑给下一层
const Rebind = _component(({ value = _bindable(''), ...rest }) => {
  log.rebind = () => value;
  return <Input value={_bind(value)} {...rest} />;
});

// ---- 子暴露能力给父：ref 是普通 prop ----
const Dialog = _component(({ ref, ...rest }) => {
  let open = _state(false);
  ref?.({ open, show: () => (open = true), hide: () => (open = false) });
  return <div {...rest} data-open={open ? 'yes' : 'no'}>对话框</div>;
});
// 不声明 ref：跟着 rest 落到主元素
const TextBox = _component(({ ...rest }) => <input class="text" {...rest} />);

// ---- 控制器：父级创建，交给子，两边用同一份 ----
function useCounter() {
  let count = _state(0);
  return { count, inc: () => count++ };
}
const CounterView = _component(({ controller }) => <button id="ctrl" onClick={controller.inc}>{controller.count}</button>);

const App = _component(() => {
  let value = _state('a');
  let unrelated = _state(0);
  let size = _state<string | undefined>(undefined);
  let open = _state(false);
  let text = _state('t');
  let forwarded = _state('f');
  let rebound = _state('r');
  const form = _state({ name: 'n' });
  const rows = _state([{ qty: 1 }, { qty: 2 }]);
  let number = _state(5);
  let dialog = _state<any>(null);
  let box = _state<HTMLElement | null>(null);
  let showBox = _state(true);
  const counter = useCounter();

  (window as any).api = {
    setValue: (next: string) => (value = next),
    setUnrelated: (next: number) => (unrelated = next),
    setSize: (next: string | undefined) => (size = next),
    setOpen: (next: boolean) => (open = next),
    setShowBox: (next: boolean) => (showBox = next),
    read: () => ({ text, forwarded, rebound, name: form.name, qty: rows[1].qty, number, box: box?.tagName ?? null, count: counter.count, unrelated }),
    dialog: () => dialog,
  };

  return (
    <main data-unrelated={unrelated}>
      <Pass2 value={value} unused={expensive()} size={size} />
      <Slotted open={open} header={<SlotContent />} item={(scope: { hover: number }) => <i id="scoped">{scope.hover}</i>}>
        <u id="slot-children">内容</u>
      </Slotted>
      <Mid onPick={(picked: string) => log.inner.push(`user:${picked}`)} />
      <Input id="direct" value={_bind(text)} />
      <Forward id="forward" value={_bind(forwarded)} />
      <Rebind id="rebind" value={_bind(rebound)} />
      <Input id="field" value={_bind(form.name)} />
      <Input id="cell" value={_bind(rows[1].qty)} />
      <Input id="transform" value={String(number)} onValueChange={(next: string) => (number = Number(next))} />
      <Input id="free" />
      <Dialog id="dialog" ref={dialog} />
      {showBox ? <TextBox id="box" ref={box} /> : null}
      <CounterView controller={counter} />
    </main>
  );
});

mount(() => component(App, {}), document.body);
