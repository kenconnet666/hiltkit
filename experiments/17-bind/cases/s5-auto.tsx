// 方案五：符文写状态，不写 .value，也不写 _bind / _ref。
// 规则：JSX 属性上写一个能写回的位置（let 变量、深代理字段、_model），写权限就一起传；写表达式就是单向。
// 子组件声明 _model 才会写；没声明的 prop 只读。壳藏在编译产物里，只有传给辅助函数时才用 _ref 取出来。
import { createContext, inject, provide } from '@hilt/runtime';
import { member, trimmed } from '../hilt';

interface SwitchProps {
  checked?: boolean;
  label?: string;
  [other: string]: unknown;
}
const Switch = _component(({ checked = _model(false), label, ...rest }: SwitchProps) => (
  <label data-state={checked ? 'on' : 'off'}>
    <input type="checkbox" {...rest} checked={checked} />
    {label}
  </label>
));

const TextInput = _component(({ value = _model(''), ...rest }: { value?: string; [other: string]: unknown }) => <input {...rest} value={value} />);
const Field = _component(({ label, ...rest }: { label?: string; value?: string; [other: string]: unknown }) => (
  <div>
    <span>{label}</span>
    <TextInput {...rest} />
  </div>
));
// 什么都不声明，直接落到原生元素
const Bare = _component(({ ...rest }: { value?: string; id?: string }) => <input {...rest} />);
// 中间层点名转交：没声明 _model，写 value={value}
const Forward = _component(({ value, id }: { value?: string; id?: string }) => <TextInput id={id} value={value} />);
const Plain = _component(({ text, id }: { text?: string; id?: string }) => <b id={id}>{text}</b>);

const TabsContext: any = createContext(null);
const Tabs = _component(({ value = _model<string | undefined>(undefined), children }: { value?: string; children?: unknown }) => {
  let registered = _state<string[]>([]);
  const current = _derived(value ?? registered[0]);
  provide(TabsContext, {
    current,
    select: (next: string) => (value = next),
    register: (tab: string) => (registered = [...registered, tab]),
  });
  return <div>{children}</div>;
});
const Tab = _component(({ value, prefix }: any) => {
  const tabs: any = inject(TabsContext);
  tabs.register(value);
  return <button id={`${prefix}-${value}`} aria-selected={tabs.current === value ? 'true' : 'false'} onClick={() => tabs.select(value)}>{value}</button>;
});
const TabPanel = _component(({ id }: any) => {
  const tabs: any = inject(TabsContext);
  return <p id={id}>{tabs.current}</p>;
});

function useToggle(initial: boolean) {
  let on = _state(initial);
  return { on, toggle: () => (on = !on) };
}

export const App = _component(() => {
  let on = _state(false);
  let controlled = _state(false);
  let allow = _state(false);
  let text = _state('');
  const form = _state({ address: { city: '北京' } });
  let celsius = _state(0);
  let fahrenheit = _writable(
    () => celsius * 1.8 + 32,
    (next) => (celsius = (Number(next) - 32) / 1.8),
  );
  let guarded = _writable(
    () => controlled,
    (next) => {
      if (allow) controlled = next;
    },
  );
  let group = _state<string[]>(['a']);
  let raw = _state('');
  let tab = _state<string | undefined>('a');
  const toggle = useToggle(false);
  let direct = _state('');
  let forward = _state('');
  let base = _state('x');
  const upper = _derived(base.toUpperCase());
  let optout = _state('初值');
  let shown = _state('原值');
  const never = _derived(false);
  (globalThis as any).api = {
    setOn: (next: boolean) => (on = next),
    setAllow: (next: boolean) => (allow = next),
    setTab: (next: string) => (tab = next),
    setDerivedBase: (next: string) => (base = next),
    setSnapshotText: (next: string) => (shown = next),
  };
  return (
    <div>
      <Switch id="sw-bound" label="绑定" checked={on} />
      <p id="sw-bound-state">{String(on)}</p>
      <Switch id="sw-free" label="自己持有" />
      <Switch id="sw-ctrl" label="受控" checked={guarded} />
      <p id="sw-ctrl-state">{String(controlled)}</p>
      <Field id="field" label="转交" value={text} />
      <p id="field-state">{text}</p>
      <input id="city" value={form.address.city} />
      <p id="city-state">{form.address.city}</p>
      <input id="temp" value={fahrenheit} />
      <p id="temp-state">{celsius}</p>
      <input id="g-a" type="checkbox" checked={member(_ref(group), 'a')} />
      <input id="g-b" type="checkbox" checked={member(_ref(group), 'b')} />
      <p id="g-state">{group.join(',')}</p>
      <input id="trim" value={trimmed(_ref(raw))} />
      <p id="trim-state">{`[${raw}]`}</p>
      <Tabs value={tab}>
        <Tab prefix="tab" value="a" />
        <Tab prefix="tab" value="b" />
        <TabPanel id="panel" />
      </Tabs>
      <Tabs>
        <Tab prefix="free" value="x" />
        <Tab prefix="free" value="y" />
        <TabPanel id="free-panel" />
      </Tabs>
      <button id="toggle" onClick={toggle.toggle}>切换</button>
      <p id="toggle-state">{String(toggle.on)}</p>

      <Bare id="direct" value={direct} />
      <p id="direct-state">{direct}</p>
      <Forward id="forward" value={forward} />
      <p id="forward-state">{forward}</p>
      <input id="readonly" value={upper} />
      <p id="readonly-state">{base}</p>
      <input id="optout" value={`${optout}`} />
      <p id="optout-state">{optout}</p>
      <Plain id="plain-label" text={shown} />
      <Switch id="sw-derived" label="只读来源" checked={never} />
      <p id="sw-derived-state">{String(never)}</p>
    </div>
  );
});
