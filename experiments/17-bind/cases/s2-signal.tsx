// 方案二：函数形态的信号（Angular 的写法）：on() 读，on.set(v) 写，传 on 本身就是传壳。普通函数 + 接口。
import { createContext, inject, provide } from '@hilt/runtime';
import { derived, omit2, sig, sigModel, sigWritable, type ReadSignal, type Signal } from '../hilt-signal';

interface SwitchProps {
  checked?: boolean | Signal<boolean>;
  label?: string;
  [other: string]: unknown;
}
function Switch(props: SwitchProps) {
  const checked = sigModel(props, 'checked', false);
  const rest = omit2(props, ['checked', 'label']);
  return (
    <label data-state={checked() ? 'on' : 'off'}>
      <input type="checkbox" {...rest} checked={checked} />
      {props.label}
    </label>
  );
}
function TextInput(props: { value?: string | Signal<string>; [other: string]: unknown }) {
  const value = sigModel(props, 'value', '');
  return <input {...omit2(props, ['value'])} value={value} />;
}
function Field(props: { label?: string; [other: string]: unknown }) {
  return (
    <div>
      <span>{props.label}</span>
      <TextInput {...omit2(props, ['label'])} />
    </div>
  );
}

interface TabsApi {
  current: ReadSignal<string | undefined>;
  select(next: string): void;
  register(tab: string): void;
}
const TabsContext = createContext<TabsApi | null>(null);
function Tabs(props: { value?: string | Signal<string | undefined>; children?: unknown }) {
  const value = sigModel<string | undefined>(props, 'value', undefined);
  const registered = sig<string[]>([]);
  provide(TabsContext, {
    current: derived(() => value() ?? registered()[0]),
    select: (next) => value.set(next),
    register: (tab) => registered.update((list) => [...list, tab]),
  });
  return <div>{props.children}</div>;
}
function Tab(props: { value: string; prefix: string }) {
  const tabs = inject(TabsContext)!;
  tabs.register(props.value);
  return (
    <button id={`${props.prefix}-${props.value}`} aria-selected={tabs.current() === props.value ? 'true' : 'false'} onClick={() => tabs.select(props.value)}>
      {props.value}
    </button>
  );
}
function TabPanel(props: { id: string }) {
  const tabs = inject(TabsContext)!;
  return <p id={props.id}>{tabs.current()}</p>;
}

function useToggle(initial: boolean) {
  const on = sig(initial);
  return { on, toggle: () => on.update((value) => !value) };
}

export function App() {
  const on = sig(false);
  const controlled = sig(false);
  const allow = sig(false);
  const text = sig('');
  const city = sig('北京');
  const celsius = sig(0);
  const fahrenheit = sigWritable(
    () => celsius() * 1.8 + 32,
    (next: number | string) => celsius.set((Number(next) - 32) / 1.8),
  );
  const group = sig<string[]>(['a']);
  const member = (item: string) =>
    sigWritable(
      () => group().includes(item),
      (next: boolean) => group.update((list) => (next ? [...list, item] : list.filter((other) => other !== item))),
    );
  const raw = sig('');
  const trimmed = sigWritable(() => raw(), (next: string) => raw.set(next.trim()));
  const tab = sig<string | undefined>('a');
  const toggle = useToggle(false);
  (globalThis as any).api = { setOn: on.set, setAllow: allow.set, setTab: tab.set };
  return (
    <div>
      <Switch id="sw-bound" label="绑定" checked={on} />
      <p id="sw-bound-state">{String(on())}</p>
      <Switch id="sw-free" label="自己持有" />
      <Switch
        id="sw-ctrl"
        label="受控"
        checked={sigWritable(
          () => controlled(),
          (next: boolean) => {
            if (allow()) controlled.set(next);
          },
        )}
      />
      <p id="sw-ctrl-state">{String(controlled())}</p>
      <Field id="field" label="转交" value={text} />
      <p id="field-state">{text()}</p>
      <input id="city" value={city} />
      <p id="city-state">{city()}</p>
      <input id="temp" value={fahrenheit as never} />
      <p id="temp-state">{celsius()}</p>
      <input id="g-a" type="checkbox" checked={member('a')} />
      <input id="g-b" type="checkbox" checked={member('b')} />
      <p id="g-state">{group().join(',')}</p>
      <input id="trim" value={trimmed} />
      <p id="trim-state">{`[${raw()}]`}</p>
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
      <p id="toggle-state">{String(toggle.on())}</p>
    </div>
  );
}
