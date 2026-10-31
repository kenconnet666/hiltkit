// 调试工具的测试页面：组件树、列表、合并、双向绑定、问题场景都在这里。
import { derived, effect, For, merge, mount, read, sig, type Sig } from 'hiltkit';

function Label({ text }: { text: () => string }) {
  return <span class="label">{text}</span>;
}
export function Counter({ start = 0 }: { start?: number }) {
  const count = sig(start);
  const doubled = derived(() => count() * 2);
  return (
    <section id="counter">
      <button id="inc" onClick={() => count.inc()} data-count={count}>
        加一
      </button>
      <Label text={() => `双倍 ${doubled()}`} />
    </section>
  );
}
function Base({ children, ...rest }: any) {
  return <button {...merge(rest, { class: 'base' })}>{children}</button>;
}
function Mid({ size = 'md', children, ...rest }: any) {
  return <Base {...merge(rest, { class: () => `btn-${read(size)}` })}>{children}</Base>;
}
function Branch() {
  const open = sig(true);
  return (
    <div id="branch">
      <button id="flip" onClick={() => open.toggle()}>
        切换
      </button>
      {() => (open() ? <Label text={() => '开'} /> : null)}
    </div>
  );
}
function Rows() {
  const rows = sig.raw([1, 2, 3].map((id) => ({ id })));
  (window as any).removeRow = () => rows.update((list) => list.slice(1));
  return (
    <ul id="rows">
      <For each={rows}>
        {(row) => (
          <li>
            <Label text={() => `行 ${row.id}`} />
          </li>
        )}
      </For>
    </ul>
  );
}
function Secrets() {
  const form = sig({
    username: 'ada',
    password: 'hunter2',
    profile: { apiKey: 'k-123', city: 'Paris' },
  });
  const pin = sig('1234');
  (window as any).secretForm = form;
  return (
    <form id="secret">
      <input id="pw" type="password" value={pin} />
      <output id="city">
        {() => `${form().username} ${form().password.length} ${form().profile.city}`}
      </output>
    </form>
  );
}
/** 写在组件体里的 {count()}：只取一次，HILT001 要抓到 */
function Frozen() {
  const count = sig(7);
  (window as any).frozen = count;
  return <p id="frozen">{count()}</p>;
}
/** 写了和原来一样显示的内容：绑定重跑了但页面没变 */
function Wasteful() {
  const tick = sig(0);
  (window as any).tick = tick;
  return (
    <p id="wasteful" title={() => (tick() >= 0 ? 'same' : 'other')}>
      白跑
    </p>
  );
}
function Chain() {
  const source = sig(1);
  const mirror = sig(0);
  (window as any).source = source;
  effect(() => mirror.set(source() * 10));
  return <p id="chain">{mirror}</p>;
}
function Broken() {
  const on = sig(false);
  (window as any).breakIt = () => on.set(true);
  effect(() => {
    if (on()) throw new Error('故意抛错');
  });
  return <i id="broken" />;
}
function Bound({ value }: { value: Sig<string> }) {
  return <input id="bound" value={value} />;
}
function App() {
  const name = sig('初始');
  (window as any).nameSig = name;
  return (
    <main>
      <Counter start={1} />
      <Mid id="merged" size="lg" class="from-user" title="标题">
        按钮
      </Mid>
      <Branch />
      <Rows />
      <Secrets />
      <Frozen />
      <Wasteful />
      <Chain />
      <Broken />
      <Bound value={name} />
    </main>
  );
}
/** 大页面：输出不能随组件数膨胀 */
function Item({ index }: { index: number }) {
  return <li>{index}</li>;
}
export function startMany(count: number) {
  const host = document.body.appendChild(document.createElement('div'));
  host.id = 'many';
  const ids = Array.from({ length: count }, (_, index) => index);
  mount(
    () => (
      <ul>
        {ids.map((index) => (
          <Item index={index} />
        ))}
      </ul>
    ),
    host,
  );
}
export function start() {
  const host = document.body.appendChild(document.createElement('div'));
  host.id = 'app';
  (window as any).unmount = mount(() => <App />, host);
}
