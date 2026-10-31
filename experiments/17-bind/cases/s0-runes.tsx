// 现状：符文 + _bindable / _bind
import { createContext, inject, provide } from '@hilt/runtime';

const Switch = _component(({ checked = _bindable(false), label, ...rest }: any) => (
  <label data-state={checked ? 'on' : 'off'}>
    <input type="checkbox" {...rest} checked={_bind(checked)} />
    {label}
  </label>
));

const TextInput = _component(({ value = _bindable(''), ...rest }: any) => <input {...rest} value={_bind(value)} />);
// 中间层要转交绑定：自己也得声明 _bindable，再 _bind 给下一层
const Field = _component(({ value = _bindable(''), label, ...rest }: any) => (
  <div>
    <span>{label}</span>
    <TextInput {...rest} value={_bind(value)} />
  </div>
));

const TabsContext: any = createContext(null);
const Tabs = _component(({ value = _bindable<string | undefined>(undefined), children }: any) => {
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
  const fahrenheit = _derived(celsius * 1.8 + 32);
  let group = _state(['a']);
  let trimmed = _state('');
  let tab = _state('a');
  const toggle = useToggle(false);
  (globalThis as any).api = {
    setOn: (next: boolean) => (on = next),
    setAllow: (next: boolean) => (allow = next),
    setTab: (next: string) => (tab = next),
  };
  return (
    <div>
      <Switch id="sw-bound" label="绑定" checked={_bind(on)} />
      <p id="sw-bound-state">{String(on)}</p>
      <Switch id="sw-free" label="自己持有" />
      <Switch
        id="sw-ctrl"
        label="受控"
        checked={controlled}
        onCheckedChange={(next: boolean) => {
          if (allow) controlled = next;
        }}
      />
      <p id="sw-ctrl-state">{String(controlled)}</p>
      <Field id="field" label="转交" value={_bind(text)} />
      <p id="field-state">{text}</p>
      <input id="city" value={_bind(form.address.city)} />
      <p id="city-state">{form.address.city}</p>
      <input id="temp" value={fahrenheit} onInput={(event: any) => (celsius = (Number(event.target.value) - 32) / 1.8)} />
      <p id="temp-state">{celsius}</p>
      <input id="g-a" type="checkbox" value="a" checked={_bind.group(group)} />
      <input id="g-b" type="checkbox" value="b" checked={_bind.group(group)} />
      <p id="g-state">{group.join(',')}</p>
      <input id="trim" value={_bind.trim(trimmed)} />
      <p id="trim-state">{`[${trimmed}]`}</p>
      <Tabs value={_bind(tab)}>
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
