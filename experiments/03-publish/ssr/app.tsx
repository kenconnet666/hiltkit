// 同一份组件：服务端渲染成字符串，客户端接管。覆盖各种容易让节点对不上的写法。
import { createContext, For, inject, provide } from '@hilt/runtime';
import * as css from '@hilt/css';


const styles = css.create({
  base: { padding: '4px', color: { default: 'rgb(255, 0, 0)', ':hover': 'rgb(0, 0, 255)' } },
  width: (width: string) => ({ width }),
});

const BaseButton = _component(({ children, ...rest }) => (
  <button class="base" data-part="root" {...rest}>
    {children}
  </button>
));

const Button = _component(({ loading, children, onClick, ...rest }) => {
  let clicks = _state(0);
  return (
    <BaseButton
      class="btn"
      type="button"
      data-clicks={clicks}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) clicks++;
      }}
      {...rest}
      aria-busy={loading ? 'true' : undefined}
    >
      {loading ? <span class="spinner">…</span> : null}
      {children}
    </BaseButton>
  );
});

const Switch = _component(({ checked = _bindable(false), label, ...rest }) => (
  <label class="switch" {...rest}>
    <input type="checkbox" checked={_bind(checked)} />
    <span data-state={checked ? 'on' : 'off'}>{label}</span>
  </label>
));

const Box = _component(({ width, children, ...rest }) => (
  <div class="box" sx={[styles.base, styles.width(width)]} {...rest}>
    {children}
  </div>
));

const Theme = createContext('fallback');
const Consumer = _component(({ id }) => <em id={id}>{inject(Theme)}</em>);
const Provider = _component(({ value, children }) => {
  provide(Theme, value);
  return <div class="provider">{children}</div>;
});

export const App = _component(({ initial }) => {
  let count = _state(initial.count);
  let on = _state(false);
  let loading = _state(false);
  let show = _state(true);
  let late = _state(false);
  let width = _state('10px');
  let empty = _state('');
  let items = _state(initial.items);
  const doubled = _derived(count * 2);

  if (typeof window !== 'undefined') {
    (window as any).api = {
      setCount: (next: number) => (count = next),
      setLoading: (next: boolean) => (loading = next),
      setShow: (next: boolean) => (show = next),
      setLate: (next: boolean) => (late = next),
      setWidth: (next: string) => (width = next),
      setEmpty: (next: string) => (empty = next),
      push: (name: string) => (items = [...items, { id: items.length + 1, name }]),
      swap: () => (items = [...items].reverse()),
      clear: () => (items = []),
      read: () => ({ on, count, loading }),
    };
  }

  return (
    <main id="root" data-count={count}>
      <p id="text">
        前 {count} 中 {doubled} 后
      </p>
      <p id="adjacent">{count}{doubled}</p>
      <p id="empty">[{empty}]</p>
      <p id="zero">{0}</p>
      <Button id="btn" class="user" title="标题" loading={loading} onClick={() => count++}>
        保存 {count}
      </Button>
      <Switch id="sw" checked={_bind(on)} label="开关" />
      <p id="state">{on ? '开' : '关'}</p>
      {show ? <b id="branch">分支 {count}</b> : <i id="other">另一个</i>}
      {show && <u id="and">且</u>}
      <>
        <span id="frag1">片段</span>
        {count}
        <span id="frag2">片段2</span>
      </>
      <Box id="box" width={width}>
        样式
      </Box>
      <Provider value="dark">
        <Consumer id="eager" />
        {late ? <Consumer id="late" /> : null}
      </Provider>
      <ul id="list">
        <For each={items}>{(item: { name: string }) => <li>{item.name}</li>}</For>
      </ul>
      <section id="tail">
        <For each={items}>{(item: { name: string }) => <a>{item.name}</a>}</For>
        结尾 {count}
      </section>
    </main>
  );
});

export const initial = { count: 1, items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] };
export { css };
