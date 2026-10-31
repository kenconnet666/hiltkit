// 深入验证：重跑次数、摘下方法、行内提示、边界、传送、服务、懒加载、动态键、销毁
import { Boundary, createContext, createService, derived, dynamic, effect, For, inject, lazy, onCleanup, Portal, provide, sig, useId, when, type Child } from 'hilt';

import { create, createTheme, defineMarker, defineVars, provideStyles, recipe, relation, themeBootClasses, themeBootScript, useRecipe } from 'hilt/css';

export const log: Record<string, any> = { component: 0, arrow: 0, memo: 0, branch: 0, memoRead: 0, cleanups: [], effects: [], service: 0, lazyEffects: 0, lazyClicks: 0 };

// ---- 重跑次数：你问的那个例子 ----
export function Counter() {
  log.component++;
  const count = sig(0);
  const other = sig(0);
  const double = derived(() => {
    log.memo++;
    return count() * 2;
  });
  (globalThis as any).counter = { add: () => count.inc(), other: () => other.inc() };
  return (
    <div>
      <p id="arrow">
        {() => {
          log.arrow++;
          return count() * 2;
        }}
      </p>
      <i id="memo-a">{double}</i>
      <i id="memo-b">{double}</i>
      <b id="other">{other}</b>
      <section id="branch">
        {when(
          () => count() > 2,
          () => {
            log.branch++;
            return <u id="big">大</u>;
          },
          () => <u id="small">小</u>,
        )}
      </section>
    </div>
  );
}

// ---- 方法摘下来用 ----
export function Detached() {
  const on = sig(false);
  const count = sig(0);
  return (
    <div>
      <button id="detached-toggle" onClick={on.toggle}>切换</button>
      <span id="detached-on">{() => String(on())}</span>
      <button id="detached-inc" onClick={() => count.inc()}>加</button>
      <span id="detached-count">{count}</span>
      <input id="detached-set" onInput={(event) => count.set(Number(event.currentTarget.value))} />
    </div>
  );
}

// ---- 列表行里写了 {count()}：开发期也要提示 ----
export function RowWarning() {
  const count = sig(1);
  const rows = sig([1]);
  return <ul><For each={rows}>{() => <li>{count()}</li>}</For></ul>;
}

// ---- 错误边界 ----
function Bomb({ armed }: { armed: () => boolean }) {
  if (armed()) throw new Error('渲染炸了');
  return <span id="bomb-safe">安全</span>;
}
function LateBomb({ tick }: { tick: () => number }) {
  return <span id="late-bomb">{() => {
    if (tick() === 2) throw new Error('更新炸了');
    return tick();
  }}</span>;
}
export function Boundaries() {
  const armed = sig(true);
  const tick = sig(1);
  (globalThis as any).boundaryApi = { setTick: tick.set, disarm: () => armed.set(false) };
  return (
    <div>
      <Boundary fallback={(error, retry) => <button id="render-fallback" onClick={retry}>{error.message}</button>}>
        <div><div><Bomb armed={armed} /></div></div>
      </Boundary>
      <Boundary fallback={(error, retry) => <button id="update-fallback" onClick={retry}>{error.message}</button>}>
        <LateBomb tick={tick} />
      </Boundary>
      <p id="boundary-sibling">旁边</p>
    </div>
  );
}

// ---- 传送 ----
const Theme = createContext('none');
function Leaf({ id }: { id: string }) {
  return <i id={id}>{inject(Theme)}</i>;
}
export function Portals() {
  const open = sig(true);
  const label = sig('一');
  provide(Theme, 'portal-theme');
  (globalThis as any).portalApi = { setOpen: open.set, setLabel: label.set };
  return <div>{when(open, () => <Portal><div id="portaled">{label}<Leaf id="portal-leaf" /></div></Portal>)}</div>;
}

// ---- 服务 ----
const Auth = createService(() => {
  log.service++;
  const user = sig('匿名');
  return { user, login: (name: string) => user.set(name) };
});
function ShowUser({ id }: { id: string }) {
  const auth = Auth.use();
  return <b id={id}>{auth.user}</b>;
}
function Mocked({ children }: { children?: Child }) {
  Auth.provide({ user: sig('替身'), login: () => {} });
  return children;
}
export function Services() {
  const auth = Auth.use();
  (globalThis as any).serviceApi = { login: auth.login };
  return (
    <div>
      <ShowUser id="user-a" />
      <ShowUser id="user-b" />
      <Mocked><ShowUser id="user-mock" /></Mocked>
    </div>
  );
}

// ---- 动态键 ----
export function DynamicKeys() {
  const mode = sig<'a' | 'b'>('a');
  (globalThis as any).dynamicApi = { setMode: mode.set };
  const a = { title: 'A', 'data-a': '1' };
  const b = { title: 'B', 'data-b': '2' };
  return <div id="dyn" class="fixed" {...dynamic(() => (mode() === 'a' ? a : b))} />;
}

// ---- 销毁 ----
function Tracked({ name }: { name: string }) {
  onCleanup(() => log.cleanups.push(name));
  effect(() => {
    log.effects.push(`run:${name}`);
    return () => log.effects.push(`stop:${name}`);
  });
  return <b id={`tracked-${name}`}>{name}</b>;
}
export function Lifetimes() {
  const show = sig(true);
  const items = sig(['a', 'b']);
  (globalThis as any).lifetimeApi = { setShow: show.set, drop: () => items.update((list) => list.slice(1)) };
  return (
    <div>
      {when(show, () => <Tracked name="branch" />)}
      <For each={items}>{(item) => <Tracked name={item} />}</For>
    </div>
  );
}

// ---- 懒加载 ----
function Heavy({ id }: { id: string }) {
  const uid = useId();
  const clicks = sig(0);
  effect(() => {
    log.lazyEffects++;
  });
  return (
    <button id={id} data-uid={uid} onClick={() => (clicks.inc(), log.lazyClicks++)}>
      {() => `点了 ${clicks()}`}
    </button>
  );
}
const LoadLazy = lazy(() => Promise.resolve({ default: Heavy }), { hydrate: 'load' });
const IdleLazy = lazy(() => Promise.resolve({ default: Heavy }), { hydrate: 'idle' });
const VisibleLazy = lazy(() => Promise.resolve({ default: Heavy }), { hydrate: 'visible' });
const TouchLazy = lazy(() => new Promise<{ default: typeof Heavy }>((resolve) => setTimeout(() => resolve({ default: Heavy }), 30)), { hydrate: 'interaction' });
export function Lazies() {
  const after = useId();
  return (
    <div>
      <LoadLazy id="lazy-load" />
      <IdleLazy id="lazy-idle" />
      <VisibleLazy id="lazy-visible" />
      <TouchLazy id="lazy-touch" />
      <p id="lazy-after" data-uid={after}>后面</p>
    </div>
  );
}

// ---- 字段壳：fields、at、sig.raw 的错误路径 ----
export function Fields() {
  const form = sig({ name: 'a', age: 1, address: { city: '北京' } as { city: string } | null });
  const { name, age } = form.fields();
  const city = form.at((f) => f.address!.city);
  const empty = sig<{ a: number } | null>(null);
  const list = sig.raw([{ n: 1 }]);
  const box = sig.raw({ a: { b: 1 } });
  const attempt = (fn: () => unknown) => {
    try {
      fn();
      return 'no error';
    } catch (error) {
      return (error as Error).message;
    }
  };
  (window as any).fieldApi = {
    form: () => JSON.parse(JSON.stringify(form())),
    setName: name.set,
    setDirect: (next: string) => (form().name = next),
    incAge: age.inc,
    setCity: city.set,
    dropAddress: () => (form().address = null),
    keys: () => Object.keys(form.fields()),
    sameField: () => form.fields().name !== undefined,
    identity: () => form.at((f) => f) === form,
    emptyRead: () => String(empty.fields().a()),
    emptyWrite: () => attempt(() => empty.fields().a.set(1)),
    pathCalc: () => attempt(() => form.at((f) => f.age + 1)),
    pathCall: () => attempt(() => form.at((f) => (f.name as any).trim())),
    rawField: () => attempt(() => list.at((f) => f.length).set(0)),
    rawNested: () => attempt(() => box.at((f) => f.a).at((a) => a.b).set(2)),
    rawFields: () => attempt(() => box.fields().a.set({ b: 2 })),
    rawPush: () => list().push({ n: 2 }),
    rawReplace: () => list.set([...list.peek()]),
  };
  return (
    <div>
      <input id="f-name" value={name} />
      <input id="f-city" value={city} />
      <b id="f-name-text">{name}</b>
      <b id="f-age-text">{age}</b>
      <b id="f-city-text">{() => String(city())}</b>
      <b id="f-raw-len">{() => list().length}</b>
    </div>
  );
}

// ---- 样式的其余导出：主题层定制、关系选择器、防闪烁脚本 ----
const themedBox = recipe({
  name: 'ThemedBox',
  parts: ['root'],
  base: { root: { color: 'rgb(1, 2, 3)' } },
  variants: { size: { sm: { root: { width: '10px' } } } },
});
const themedLayer = { ThemedBox: { base: { root: { color: 'rgb(4, 5, 6)' } }, variants: { size: { xl: { root: { width: '40px' } } } } } } as const;
function ThemedInner() {
  const parts = useRecipe(themedBox, { size: 'xl' as 'sm' });
  return <div id="themed" {...parts.root} />;
}
function Themed() {
  provideStyles(themedLayer);
  return <ThemedInner />;
}
const card = defineMarker('fixture-card');
const related = create({ label: { color: { default: 'rgb(0, 0, 0)', [relation.ancestor(':hover', card)]: 'rgb(7, 8, 9)' as const } } });
export function StyleExtras() {
  return (
    <div>
      <Themed />
      <div {...themedBox().root} id="unthemed" />
      <div id="card" sx={card}>
        <span id="related" sx={related.label}>标签</span>
      </div>
    </div>
  );
}
const palette = defineVars('fixture-palette', { fg: 'red' });
const themes = { light: createTheme(palette, { fg: 'black' }), dark: createTheme(palette, { fg: 'white' }) };
export const boot = { script: themeBootScript({ themes }), classes: themeBootClasses(themes) };
