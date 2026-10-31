// 方案三：保留符文写本地状态，跨组件传真实的壳。_ref(x) 取壳，_model 声明可绑定的 prop。
import { createContext, inject, provide } from '@hilt/runtime';
import { member, trimmed, writable, type Model } from '../hilt';

interface SwitchProps {
  checked?: Model<boolean>;
  label?: string;
  [other: string]: unknown;
}
const Switch = _component(({ checked: source, label, ...rest }: SwitchProps) => {
  let checked = _model(source, false);
  return (
    <label data-state={checked ? 'on' : 'off'}>
      <input type="checkbox" {...rest} checked={_ref(checked)} />
      {label}
    </label>
  );
});

const TextInput = _component(({ value: source, ...rest }: { value?: Model<string>; [other: string]: unknown }) => {
  let value = _model(source, '');
  return <input {...rest} value={_ref(value)} />;
});
// 中间层不用声明：壳在 rest 里原样往下传
const Field = _component(({ label, ...rest }: any) => (
  <div>
    <span>{label}</span>
    <TextInput {...rest} />
  </div>
));

const TabsContext: any = createContext(null);
const Tabs = _component(({ value: source, children }: any) => {
  let value = _model<string | undefined>(source, undefined);
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
  const fahrenheit = writable(
    () => celsius * 1.8 + 32,
    (next: number) => (celsius = (Number(next) - 32) / 1.8),
  );
  let group = _state<string[]>(['a']);
  let raw = _state('');
  let tab = _state('a');
  const toggle = useToggle(false);
  (globalThis as any).api = {
    setOn: (next: boolean) => (on = next),
    setAllow: (next: boolean) => (allow = next),
    setTab: (next: string) => (tab = next),
  };
  return (
    <div>
      <Switch id="sw-bound" label="绑定" checked={_ref(on)} />
      <p id="sw-bound-state">{String(on)}</p>
      <Switch id="sw-free" label="自己持有" />
      <Switch
        id="sw-ctrl"
        label="受控"
        checked={writable(
          () => controlled,
          (next: boolean) => {
            if (allow) controlled = next;
          },
        )}
      />
      <p id="sw-ctrl-state">{String(controlled)}</p>
      <Field id="field" label="转交" value={_ref(text)} />
      <p id="field-state">{text}</p>
      <input id="city" value={_ref(form.address.city)} />
      <p id="city-state">{form.address.city}</p>
      <input id="temp" value={fahrenheit} />
      <p id="temp-state">{celsius}</p>
      <input id="g-a" type="checkbox" checked={member(_ref(group), 'a')} />
      <input id="g-b" type="checkbox" checked={member(_ref(group), 'b')} />
      <p id="g-state">{group.join(',')}</p>
      <input id="trim" value={trimmed(_ref(raw))} />
      <p id="trim-state">{`[${raw}]`}</p>
      <Tabs value={_ref(tab)}>
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
    </div>
  );
});
