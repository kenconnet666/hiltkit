// .map 自动成列表、_x ↔ onXChange、父级拒绝新值时自动退回。
import { flushSync, mount } from '@hilt/runtime';

const log: Record<string, any> = { rowBuilt: 0 };
(window as any).log = log;
(window as any).flushSync = flushSync;

const Row = _component(({ label, position }) => {
  log.rowBuilt++;
  return <li>{position}:{label}</li>;
});

const Toggle = _component(({ on = _bindable(false), ...rest }) => (
  <button {...rest} aria-pressed={on ? 'true' : 'false'} onClick={() => (on = !on)}>
    {on ? '开' : '关'}
  </button>
));

const App = _component(() => {
  // 没写 key：身份复用
  let plain = _state([{ name: 'a' }, { name: 'b' }]);
  // 写了 key：id 相同的行复用，数据跟着换
  let keyed = _state([{ id: 1, name: 'one' }, { id: 2, name: 'two' }]);
  let destructured = _state([{ id: 1, name: 'x' }]);

  let bound = _state(false);
  let locked = _state(false);
  let notified = _state(0);
  let allow = _state(false);

  (window as any).api = {
    swapPlain: () => (plain = [...plain].reverse()),
    addPlain: () => (plain = [...plain, { name: 'c' }]),
    setKeyed: (rows: any) => (keyed = rows),
    setDestructured: (rows: any) => (destructured = rows),
    plainFirst: () => plain[0],
    read: () => ({ bound, locked, notified }),
    setAllow: (next: boolean) => (allow = next),
  };

  return (
    <main>
      <ul id="plain">
        {plain.map((item, i) => <li>{i}:{item.name}</li>)}
      </ul>
      <ul id="keyed">
        {keyed.map((item, i) => <Row key={item.id} label={item.name} position={i} />)}
      </ul>
      <ul id="destructured">
        {destructured.map(({ name }) => <li key={name}>{name}</li>)}
      </ul>
      <Toggle id="bound" on={_bind(bound)} />
      <Toggle
        id="locked"
        on={locked}
        onOnChange={(next: boolean) => {
          notified++;
          if (allow) locked = next;
        }}
      />
      <Toggle id="free" />
    </main>
  );
});

mount(() => <App />, document.body);
