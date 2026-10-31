// 和 17-bind 同一组场景，这里没有任何编译魔法：普通函数组件 + 原生解构 + 标准 JSX
import { createContext, derived, For, inject, merge, model, provide, read, sig, useId, when, type Child, type Model, type Prop, type ReadSig } from 'hilt';
import type { HtmlProps } from 'hilt/jsx-runtime';
import { create } from 'hilt/css';

interface SwitchProps extends Omit<HtmlProps<'input'>, 'checked'> {
  checked?: Model<boolean>;
  label?: Prop<string>;
  onCheckedChange?: (on: boolean) => void;
}
function Switch({ checked, label, onCheckedChange, ...rest }: SwitchProps) {
  const on = model(checked, false, onCheckedChange);
  return (
    <label data-state={() => (on() ? 'on' : 'off')}>
      <input type="checkbox" {...rest} checked={on} />
      {label}
    </label>
  );
}

interface TextInputProps extends Omit<HtmlProps<'input'>, 'value'> {
  value?: Model<string>;
}
function TextInput({ value, ...rest }: TextInputProps) {
  const text = model(value, '');
  return <input {...rest} value={text} />;
}
function Field({ label, ...rest }: TextInputProps & { label?: Prop<string> }) {
  return (
    <div>
      <span>{label}</span>
      <TextInput {...rest} />
    </div>
  );
}

interface TabsApi {
  current: ReadSig<string | undefined>;
  select(next: string): void;
  register(tab: string): void;
}
const TabsContext = createContext<TabsApi | null>(null);
function Tabs({ value, children }: { value?: Model<string | undefined>; children?: Child }) {
  const selected = model(value, undefined);
  const registered = sig<string[]>([]);
  provide(TabsContext, {
    current: derived(() => selected() ?? registered()[0]),
    select: (next) => selected.set(next),
    register: (tab) => registered.update((list) => [...list, tab]),
  });
  return <div>{children}</div>;
}
function Tab({ value, prefix }: { value: string; prefix: string }) {
  const tabs = inject(TabsContext)!;
  tabs.register(value);
  return (
    <button id={`${prefix}-${value}`} aria-selected={() => (tabs.current() === value ? 'true' : 'false')} onClick={() => tabs.select(value)}>
      {value}
    </button>
  );
}
function TabPanel({ id }: { id: string }) {
  const tabs = inject(TabsContext)!;
  return <p id={id}>{tabs.current}</p>;
}

function useToggle(initial: boolean) {
  const on = sig(initial);
  return { on, toggle: () => on.toggle() };
}

// 属性合并、样式、列表、条件、id：组件库最常用的部分
const styles = create({
  root: { padding: '3px' },
  active: { fontWeight: 700 },
  bar: (width: string) => ({ width }),
});
function Button({ loading, children, ...rest }: HtmlProps<'button'> & { loading?: Prop<boolean> }) {
  return (
    <button
      {...merge(rest, {
        class: 'base',
        type: 'button',
        // 受管层排在后面先执行，preventDefault 之后使用方的 onClick 自动跳过
        onClick: (event: Event) => {
          if (read(loading)) event.preventDefault();
        },
      })}
      aria-busy={() => (read(loading) ? 'true' : 'false')}
    >
      {children}
    </button>
  );
}
function Labelled({ label }: { label: string }) {
  const id = useId();
  return (
    <div>
      <label for={id}>{label}</label>
      <input id={id} />
    </div>
  );
}

export function App() {
  const on = sig(false);
  const controlled = sig(false);
  const allow = sig(false);
  const text = sig('');
  const form = sig({ address: { city: '北京' } });
  const celsius = sig(0);
  const fahrenheit = derived(
    () => celsius() * 1.8 + 32,
    (next) => celsius.set((Number(next) - 32) / 1.8),
  );
  const group = sig<string[]>(['a']);
  const raw = sig('');
  const tab = sig<string | undefined>('a');
  const toggle = useToggle(false);
  const clicks = sig(0);
  const loading = sig(false);
  const active = sig(true);
  const width = sig('10px');
  const rows = sig([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
  const user = sig<{ name: string } | null>({ name: '张三' });
  const pick = sig('b');
  (globalThis as any).api = {
    setOn: (next: boolean) => on.set(next),
    setAllow: (next: boolean) => allow.set(next),
    setTab: (next: string) => tab.set(next),
    setLoading: (next: boolean) => loading.set(next),
    setActive: (next: boolean) => active.set(next),
    setWidth: (next: string) => width.set(next),
    addRow: (name: string) => rows.update((list) => [...list, { id: list.length + 1, name }]),
    renameFirst: (name: string) => rows.update((list) => [{ ...list[0]!, name }, ...list.slice(1)]),
    swapRows: () => rows.update((list) => [...list].reverse()),
    clearUser: () => user.set(null),
    setUser: (name: string) => user.set({ name }),
    setPick: (next: string) => pick.set(next),
  };
  return (
    <div>
      <Switch id="sw-bound" label="绑定" checked={on} />
      <p id="sw-bound-state">{() => String(on())}</p>
      <Switch id="sw-free" label="自己持有" />
      <Switch
        id="sw-ctrl"
        label="受控"
        checked={derived(
          () => controlled(),
          (next) => {
            if (allow()) controlled.set(next);
          },
        )}
      />
      <p id="sw-ctrl-state">{() => String(controlled())}</p>
      <Field id="field" label="转交" value={text} />
      <p id="field-state">{text}</p>
      <input id="city" value={form.at((f) => f.address.city)} />
      <p id="city-state">{() => form().address.city}</p>
      <input id="temp" value={fahrenheit} />
      <p id="temp-state">{celsius}</p>
      <input id="g-a" type="checkbox" checked={group.has('a')} />
      <input id="g-b" type="checkbox" checked={group.has('b')} />
      <p id="g-state">{() => group().join(',')}</p>
      <input id="trim" value={raw.trim()} />
      <p id="trim-state">{() => `[${raw()}]`}</p>
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
      <p id="toggle-state">{() => String(toggle.on())}</p>

      <Button id="merged" class="user" loading={loading} onClick={() => clicks.inc()}>保存</Button>
      <p id="clicks">{clicks}</p>
      <div id="styled" class={['x', () => active() && 'on']} sx={[styles.root, () => active() && styles.active, () => styles.bar(width())]} />
      <ul id="rows">
        <For each={rows} by={(row) => row.id}>
          {(row, index) => <li data-index={index}>{() => row().name}</li>}
        </For>
      </ul>
      <div id="who">{when(user, (u) => <b id="who-name">{() => u().name}</b>, () => <i id="who-none">无</i>)}</div>
      <select id="pick" value={pick}>
        <option value="a">a</option>
        <option value="b">b</option>
      </select>
      <textarea id="area" value={text} />
      <svg id="icon" viewBox="0 0 10 10"><path d={() => (on() ? 'M0 0' : 'M1 1')} /></svg>
      <Labelled label="一" />
      <Labelled label="二" />
    </div>
  );
}
