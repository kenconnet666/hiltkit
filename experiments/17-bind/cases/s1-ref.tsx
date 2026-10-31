// 方案一：没有符文。显式的壳（ref、computed）+ schema 声明 props。编译器只管 JSX。
import { createContext, inject, provide } from '@hilt/runtime';
import { bound, component, computed, fields, member, prop, ref, state, trimmed, writable, type ReadRef, type Ref } from '../hilt';

const Switch = component({ checked: bound(false), label: prop<string>() }, (props, rest) => (
  <label data-state={props.checked.value ? 'on' : 'off'}>
    <input type="checkbox" {...rest} checked={props.checked} />
    {props.label}
  </label>
));

const TextInput = component({ value: bound('') }, (props, rest) => <input {...rest} value={props.value} />);
// 中间层不用声明 value：它就是 rest 里的一个普通属性，壳原样往下传
const Field = component({ label: prop<string>() }, (props, rest) => (
  <div>
    <span>{props.label}</span>
    <TextInput {...rest} />
  </div>
));

interface TabsApi {
  current: ReadRef<string | undefined>;
  select(next: string): void;
  register(tab: string): void;
}
const TabsContext = createContext<TabsApi | null>(null);
const Tabs = component({ value: bound<string | undefined>(undefined), children: prop<unknown>() }, (props) => {
  const registered = ref<string[]>([]);
  provide(TabsContext, {
    current: computed(() => props.value.value ?? registered.value[0]),
    select: (next) => (props.value.value = next),
    register: (tab) => (registered.value = [...registered.value, tab]),
  });
  return <div>{props.children}</div>;
});
const Tab = component({ value: prop.required<string>(), prefix: prop('') }, (props) => {
  const tabs = inject(TabsContext)!;
  tabs.register(props.value);
  return (
    <button id={`${props.prefix}-${props.value}`} aria-selected={tabs.current.value === props.value ? 'true' : 'false'} onClick={() => tabs.select(props.value)}>
      {props.value}
    </button>
  );
});
const TabPanel = component({ id: prop.required<string>() }, (props) => {
  const tabs = inject(TabsContext)!;
  return <p id={props.id}>{tabs.current.value}</p>;
});

function useToggle(initial: boolean) {
  const on = ref(initial);
  return { on, toggle: () => (on.value = !on.value) };
}

export const App = component({}, () => {
  const on = ref(false);
  const controlled = ref(false);
  const allow = ref(false);
  const text = ref('');
  const form = state({ address: { city: '北京' } });
  const $ = fields(form);
  const celsius = ref(0);
  const fahrenheit = writable(
    () => celsius.value * 1.8 + 32,
    (next) => (celsius.value = (Number(next) - 32) / 1.8),
  );
  const group = ref<string[]>(['a']);
  const raw = ref('');
  const tab = ref('a');
  const toggle = useToggle(false);
  (globalThis as any).api = {
    setOn: (next: boolean) => (on.value = next),
    setAllow: (next: boolean) => (allow.value = next),
    setTab: (next: string) => (tab.value = next),
  };
  return (
    <div>
      <Switch id="sw-bound" label="绑定" checked={on} />
      <p id="sw-bound-state">{String(on.value)}</p>
      <Switch id="sw-free" label="自己持有" />
      <Switch
        id="sw-ctrl"
        label="受控"
        checked={writable(
          () => controlled.value,
          (next) => {
            if (allow.value) controlled.value = next;
          },
        )}
      />
      <p id="sw-ctrl-state">{String(controlled.value)}</p>
      <Field id="field" label="转交" value={text} />
      <p id="field-state">{text.value}</p>
      <input id="city" value={$.address.city} />
      <p id="city-state">{form.address.city}</p>
      <input id="temp" value={fahrenheit} />
      <p id="temp-state">{celsius.value}</p>
      <input id="g-a" type="checkbox" checked={member(group, 'a')} />
      <input id="g-b" type="checkbox" checked={member(group, 'b')} />
      <p id="g-state">{group.value.join(',')}</p>
      <input id="trim" value={trimmed(raw)} />
      <p id="trim-state">{`[${raw.value}]`}</p>
      <Tabs value={tab as Ref<string | undefined>}>
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
      <p id="toggle-state">{String(toggle.on.value)}</p>
    </div>
  );
});
