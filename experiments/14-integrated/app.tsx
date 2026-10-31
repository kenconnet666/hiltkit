// 集成用例：内核、深代理、属性、样式、水合都用同一份运行时。同一份组件既在浏览器里挂载，也在服务端渲染再接管。
import { Boundary, createContext, flushSync, inject, lazy, onCleanup, Portal, provide, useId, warnings } from '@hilt/runtime';
import { create, recipe } from '@hilt/css';

export const log: any = { cleanups: [], effects: [], text: 0, renders: {} };
const bump = (name: string) => (log.renders[name] = (log.renders[name] ?? 0) + 1);

// ---- context：组件不占节点，指针要跟着树走 ----
const Theme = createContext('none');
const Leaf = _component(({ id }: any) => <i id={id}>{inject(Theme)}</i>);
/** 直接返回 children 的 provider：内容之后才求值，也要看得到 */
const BareProvider = _component(({ value, children }: any) => {
  provide(Theme, value);
  return children;
});
const WrapProvider = _component(({ value, children }: any) => {
  provide(Theme, value);
  return <section>{children}</section>;
});
export const ContextCase = _component(() => {
  let late = _state(false);
  const rows = _state([1, 2]);
  (globalThis as any).contextApi = { showLate: () => (late = true), addRow: () => rows.push(rows.length + 1) };
  return (
    <div>
      <WrapProvider value="wrap">
        <Leaf id="ctx-wrap" />
        {late && <Leaf id="ctx-late" />}
        <ul>{rows.map((row) => <li><Leaf id={`ctx-row-${row}`} /></li>)}</ul>
      </WrapProvider>
      <BareProvider value="bare">
        <Leaf id="ctx-bare" />
      </BareProvider>
      <Leaf id="ctx-sibling" />
    </div>
  );
});

// ---- 销毁：组件不占节点，onCleanup 和 _effect 要跟着所在分支走 ----
const Tracked = _component(({ name, during }: any) => {
  during?.();
  onCleanup(() => log.cleanups.push(name));
  _effect(() => {
    log.effects.push(`run:${name}`);
    return () => log.effects.push(`stop:${name}`);
  });
  return <b id={`tracked-${name}`}>{name}</b>;
});
export const LifetimeCase = _component(() => {
  let show = _state(true);
  let quick = _state(false);
  const items = _state(['a', 'b']);
  (globalThis as any).lifetimeApi = {
    hide: () => (show = false),
    show: () => (show = true),
    drop: () => items.shift(),
    // 挂上的同一轮里又撤掉：_effect 还没轮到第一次执行就该作废
    flicker: () => (quick = true),
  };
  return (
    <div>
      {show && <Tracked name="branch" />}
      {quick && <Tracked name="quick" during={() => (quick = false)} />}
      {items.map((item) => <Tracked name={item} />)}
    </div>
  );
});

// ---- 外层条件先于内层：内层不会读到已经不成立的数据 ----
const Profile = _component(({ user }: any) => <em id="profile">{user.name}</em>);
export const GlitchCase = _component(() => {
  let user = _state<any>({ name: 'n1' });
  (globalThis as any).glitchApi = { clear: () => (user = null), set: (name: string) => (user = { name }) };
  return <div>{user ? <Profile user={user} /> : <span id="no-user">无</span>}</div>;
});

// ---- 深代理 + 列表 + 绑定：改一个字段只更新一处 ----
export const DeepCase = _component(() => {
  const todos = _state([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: true }]);
  let filter = _state('all');
  const visible = _derived(filter === 'all' ? todos : todos.filter((todo) => !todo.done));
  (globalThis as any).deepApi = {
    rename: (index: number, title: string) => (todos[index].title = title),
    toggle: (index: number) => (todos[index].done = !todos[index].done),
    add: (title: string) => todos.push({ id: todos.length + 1, title, done: false }),
    setFilter: (next: string) => (filter = next),
    snapshot: () => _state.snapshot(todos),
  };
  return (
    <div>
      <ul id="todos">
        {visible.map((todo) => (
          <li key={todo.id} data-done={todo.done}>
            <input type="checkbox" checked={_bind(todo.done)} />
            <span>{todo.title}</span>
          </li>
        ))}
      </ul>
      <p id="empty">{visible.length ? visible.map((todo) => <u>{todo.id}</u>) : <span>空</span>}</p>
    </div>
  );
});

// ---- 属性：编译路径和 spread 路径写出来要一样 ----
const styles = create({
  root: { padding: '3px', color: { default: 'rgb(255, 0, 0)', ':hover': 'rgb(0, 0, 255)' } },
  active: { fontWeight: 700 },
  bar: (width: string) => ({ width }),
});
const CASES: any[] = [
  ['div', { title: 'a' }],
  ['div', { title: '' }],
  ['div', { title: 0 }],
  ['div', { 'aria-expanded': false }],
  ['div', { 'aria-expanded': true }],
  ['div', { 'data-x': null }],
  ['div', { 'data-x': undefined }],
  ['div', { hidden: true }],
  ['div', { hidden: false }],
  ['div', { hidden: '' }],
  ['div', { hidden: 'until-found' }],
  ['button', { disabled: true }],
  ['button', { disabled: false }],
  ['div', { class: 'a b' }],
  ['div', { class: ['a', false, ['b', { c: true, d: false }]] }],
  ['div', { class: '' }],
  ['div', { style: 'color: red; margin: 1px' }],
  ['div', { style: { color: 'red', marginTop: '2px', '--x': '1' } }],
  ['div', { style: { color: 'red !important' } }],
  ['input', { value: 'a' }],
  ['input', { type: 'number', value: 0 }],
  ['input', { type: 'range', min: 100, max: 200, value: 150 }],
  ['input', { type: 'checkbox', checked: true }],
  ['input', { type: 'checkbox', checked: false }],
  ['a', { href: '/x' }],
  ['a', { href: 'javascript:alert(1)' }],
  ['a', { href: ' JaVa\tScript:alert(1)' }],
  ['a', { onclick: 'alert(1)' }],
  ['div', { translate: true }],
  ['div', { translate: false }],
  ['label', { for: 'x' }],
  ['img', { src: '/a.png', alt: 'x', loading: 'lazy' }],
];
const staticKeys = (props: any) => ({ ...props });
/** 同一组属性走两条路：spread（运行时）和 JSX（编译器）。JSX 这条在 cases 里按键展开成真实写法 */
export const AttrSpread = _component(({ index }: any) => {
  const [tag, props] = CASES[index];
  const bag = staticKeys(props);
  if (tag === 'div') return <div {...bag} />;
  if (tag === 'button') return <button {...bag} />;
  if (tag === 'input') return <input {...bag} />;
  if (tag === 'a') return <a {...bag} />;
  if (tag === 'label') return <label {...bag} />;
  return <img {...bag} />;
});
export const attrCount = CASES.length;
export const attrCompiled = [
  () => <div title="a" />,
  () => <div title="" />,
  () => <div title={0} />,
  () => <div aria-expanded={false} />,
  () => <div aria-expanded={true} />,
  () => <div data-x={null} />,
  () => <div data-x={undefined} />,
  () => <div hidden={true} />,
  () => <div hidden={false} />,
  () => <div hidden="" />,
  () => <div hidden="until-found" />,
  () => <button disabled={true} />,
  () => <button disabled={false} />,
  () => <div class="a b" />,
  () => <div class={['a', false, ['b', { c: true, d: false }]]} />,
  () => <div class="" />,
  () => <div style="color: red; margin: 1px" />,
  () => <div style={{ color: 'red', marginTop: '2px', '--x': '1' }} />,
  () => <div style={{ color: 'red !important' }} />,
  () => <input value="a" />,
  () => <input type="number" value={0} />,
  () => <input type="range" min={100} max={200} value={150} />,
  () => <input type="checkbox" checked={true} />,
  () => <input type="checkbox" checked={false} />,
  () => <a href="/x" />,
  () => <a href="javascript:alert(1)" />,
  () => <a href={' JaVa\tScript:alert(1)'} />,
  () => <a onclick="alert(1)" />,
  () => <div translate={true} />,
  () => <div translate={false} />,
  () => <label htmlFor="x" />,
  () => <img src="/a.png" alt="x" loading="lazy" />,
];

// ---- 水合：属性、样式、绑定、select、textarea、id、懒加载放在一起 ----
const LazyCard = lazy(() => Promise.resolve({ default: _component(() => {
  const id = useId();
  return <p id="lazy-card" data-uid={id}>懒</p>;
}) }), { hydrate: 'idle' });
const Labelled = _component(({ label }: any) => {
  const id = useId();
  return (
    <div>
      <label for={id}>{label}</label>
      <input id={id} data-testid={label} />
    </div>
  );
});
export const HydrateCase = _component(() => {
  let on = _state(true);
  let width = _state('10px');
  let text = _state('初值');
  let pick = _state('b');
  const list = _state(['x', 'y']);
  (globalThis as any).hydrateApi = { setOn: (next: boolean) => (on = next), setWidth: (next: string) => (width = next), setPick: (next: string) => (pick = next), add: (item: string) => list.push(item) };
  const s = button({ size: on ? 'lg' : 'sm' });
  return (
    <main id="hydrate-root" class={['root', on && 'on']} style={{ '--h': '1' }} sx={[styles.root, on && styles.active, styles.bar(width)]} data-on={on}>
      <input id="h-text" value={_bind(text)} />
      <textarea id="h-area" value={text} />
      <select id="h-select" value={_bind(pick)}>
        {list.map((item) => <option value={item}>{item}</option>)}
        <option value="b">b</option>
      </select>
      <input id="h-check" type="checkbox" checked={on} />
      <button {...s.root} id="h-recipe" disabled={!on}>按钮</button>
      <Labelled label="第一个" />
      <LazyCard />
      <Labelled label="第二个" />
      <div id="h-html" innerHTML="<b>内</b>" />
      <svg id="h-svg" viewBox="0 0 10 10"><path d={on ? 'M0 0' : 'M1 1'} class="p" /></svg>
      {on ? <span id="h-yes">开</span> : <span id="h-no">关</span>}
    </main>
  );
});
const button = recipe({
  name: 'Button',
  parts: ['root'],
  variants: { size: { sm: { root: { fontSize: '12px' } }, lg: { root: { fontSize: '16px' } } } },
});

// ---- 错误边界 ----
const Bomb = _component(({ armed }: any) => {
  if (armed) throw new Error('渲染炸了');
  return <span id="bomb-safe">安全</span>;
});
const LateBomb = _component(({ tick }: any) => <span id="late-bomb">{check(tick)}</span>);
const check = (tick: number) => {
  if (tick === 2) throw new Error('更新炸了');
  return tick;
};
const Deep = _component(({ children }: any) => <div><div>{children}</div></div>);
export const BoundaryCase = _component(() => {
  let armed = _state(true);
  let tick = _state(1);
  (globalThis as any).boundaryApi = { setTick: (next: number) => (tick = next), disarm: () => (armed = false) };
  return (
    <div>
      <Boundary fallback={(error: Error, retry: () => void) => <button id="render-fallback" onClick={retry}>{error.message}</button>}>
        <Deep><Bomb armed={armed} /></Deep>
      </Boundary>
      <Boundary fallback={(error: Error, retry: () => void) => <button id="update-fallback" onClick={retry}>{error.message}</button>}>
        <LateBomb tick={tick} />
      </Boundary>
      <p id="boundary-sibling">旁边</p>
    </div>
  );
});

// ---- 传送 ----
export const PortalCase = _component(() => {
  let open = _state(true);
  let label = _state('一');
  (globalThis as any).portalApi = { setOpen: (next: boolean) => (open = next), setLabel: (next: string) => (label = next) };
  return (
    <WrapProvider value="portal-theme">
      {open && (
        <Portal>
          <div id="portaled">{label}<Leaf id="portal-leaf" /></div>
        </Portal>
      )}
    </WrapProvider>
  );
});

// ---- 诊断 ----
export const WarnCase = _component(() => {
  let n = _state(1);
  const copy = n; // 组件体顶层读响应式数据：只拿到当前值
  return <i>{copy}</i>;
});
export { flushSync, warnings };
void bump;
