// 方案四：只有一个概念：状态都是对象的属性。没有 .value，没有符文；要传壳时用 fields(s).x（路径代理，同 easy-query 的 u.company.name）。
import { createContext, inject, provide } from '@hilt/runtime';
import { bound, component, computed, fields, member, prop, state, trimmed, writable } from '../hilt';

const Switch = component({ checked: bound(false), label: prop<string>() }, (props, rest) => (
  <label data-state={props.checked.value ? 'on' : 'off'}>
    <input type="checkbox" {...rest} checked={props.checked} />
    {props.label}
  </label>
));
const TextInput = component({ value: bound('') }, (props, rest) => <input {...rest} value={props.value} />);
const Field = component({ label: prop<string>() }, (props, rest) => (
  <div>
    <span>{props.label}</span>
    <TextInput {...rest} />
  </div>
));

const TabsContext = createContext<any>(null);
const Tabs = component({ value: bound<string | undefined>(undefined), children: prop<unknown>() }, (props) => {
  const local = state({ registered: [] as string[] });
  provide(TabsContext, {
    current: computed(() => props.value.value ?? local.registered[0]),
    select: (next: string) => (props.value.value = next),
    register: (tab: string) => local.registered.push(tab),
  });
  return <div>{props.children}</div>;
});
const Tab = component({ value: prop.required<string>(), prefix: prop('') }, (props) => {
  const tabs = inject(TabsContext);
  tabs.register(props.value);
  return (
    <button id={`${props.prefix}-${props.value}`} aria-selected={tabs.current.value === props.value ? 'true' : 'false'} onClick={() => tabs.select(props.value)}>
      {props.value}
    </button>
  );
});
const TabPanel = component({ id: prop.required<string>() }, (props) => {
  const tabs = inject(TabsContext);
  return <p id={props.id}>{tabs.current.value}</p>;
});

function useToggle(initial: boolean) {
  const self = state({ on: initial, toggle: () => (self.on = !self.on) });
  return self;
}

export const App = component({}, () => {
  const s = state({
    on: false,
    controlled: false,
    allow: false,
    text: '',
    address: { city: '北京' },
    celsius: 0,
    group: ['a'],
    raw: '',
    tab: 'a' as string | undefined,
  });
  const $ = fields(s);
  const fahrenheit = writable(
    () => s.celsius * 1.8 + 32,
    (next) => (s.celsius = (Number(next) - 32) / 1.8),
  );
  const toggle = useToggle(false);
  (globalThis as any).api = {
    setOn: (next: boolean) => (s.on = next),
    setAllow: (next: boolean) => (s.allow = next),
    setTab: (next: string) => (s.tab = next),
  };
  return (
    <div>
      <Switch id="sw-bound" label="绑定" checked={$.on} />
      <p id="sw-bound-state">{String(s.on)}</p>
      <Switch id="sw-free" label="自己持有" />
      <Switch
        id="sw-ctrl"
        label="受控"
        checked={writable(
          () => s.controlled,
          (next) => {
            if (s.allow) s.controlled = next;
          },
        )}
      />
      <p id="sw-ctrl-state">{String(s.controlled)}</p>
      <Field id="field" label="转交" value={$.text} />
      <p id="field-state">{s.text}</p>
      <input id="city" value={$.address.city} />
      <p id="city-state">{s.address.city}</p>
      <input id="temp" value={fahrenheit} />
      <p id="temp-state">{s.celsius}</p>
      <input id="g-a" type="checkbox" checked={member($.group, 'a')} />
      <input id="g-b" type="checkbox" checked={member($.group, 'b')} />
      <p id="g-state">{s.group.join(',')}</p>
      <input id="trim" value={trimmed($.raw)} />
      <p id="trim-state">{`[${s.raw}]`}</p>
      <Tabs value={$.tab}>
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
