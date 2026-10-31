/**
 * 第 7 条：符文的类型与误用拦截。
 */
import { createContext, For, type JSX } from 'exp06';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

declare function naiveState<T>(initial: T): T;

export const Demo = _component<{ initial?: number }>(({ initial = 0 }) => {
  // ---- _state ----
  let count = _state(0);
  assertType<Equal<typeof count, number>>();
  count = count + 1;
  count++;
  // @ts-expect-error 类型是 number，不能赋字符串
  count = 'x';

  const form = _state({ name: '', tags: ['a'] });
  assertType<Equal<typeof form, { name: string; tags: string[] }>>();
  form.name = 'x';
  form.tags.push('b');
  // @ts-expect-error const 不能整体替换（TS 自己报）
  form = { name: '', tags: [] };

  interface Row {
    id: number;
  }
  let big = _state.raw<Row[]>([]);
  assertType<Equal<typeof big, Row[]>>();
  big = [...big, { id: 1 }];

  const plain = _state.snapshot(form);
  assertType<Equal<typeof plain, { name: string; tags: string[] }>>();

  // 没有初始值：诚实地带 undefined
  let maybe = _state<string>();
  assertType<Equal<typeof maybe, string | undefined>>();
  let el = _state<HTMLInputElement | null>(null);
  assertType<Equal<typeof el, HTMLInputElement | null>>();

  // 字面量：let 拓宽成 number，显式类型实参保留联合
  let mode = _state<'a' | 'b'>('a');
  mode = 'b';
  // @ts-expect-error 'c' 不在联合里
  mode = 'c';
  let flag = _state(false);
  assertType<Equal<typeof flag, boolean>>();
  if (flag === true) flag = false; // 没有被收窄成 false
  // 对照：不加 boolean 重载的朴素声明会被赋值收窄成 false
  let naive = naiveState(false);
  // @ts-expect-error 朴素声明下 naive 被收窄成 false，比较报“没有重叠”
  if (naive === true) naive = false;

  // ---- _derived ----
  const total = _derived(count + 1);
  assertType<Equal<typeof total, number>>();
  const doubled = _derived.by(() => {
    return count * 2;
  });
  assertType<Equal<typeof doubled, number>>();
  const label = _derived.by(() => (count > 1 ? 'many' : 'few'));
  assertType<Equal<typeof label, 'many' | 'few'>>();
  // let 可以临时覆盖
  let likes = _derived(count);
  likes = likes + 1;
  // @ts-expect-error 常见误写：把函数传给 _derived（应该用 _derived.by）
  const wrong = _derived(() => count * 2);
  // 对象/数组派生
  const upper = _derived(form.tags.map((t) => t.toUpperCase()));
  assertType<Equal<typeof upper, string[]>>();
  // 派生函数值要走 .by
  const handler = _derived.by(() => (count > 1 ? () => 1 : () => 2));
  handler();

  // ---- _effect ----
  _effect(() => {
    console.log(count);
  });
  _effect(() => {
    const id = setInterval(() => {}, 1000);
    return () => clearInterval(id);
  });
  _effect(() => console.log(count)); // 表达式体返回 void：允许
  // @ts-expect-error 返回非函数的值
  _effect(() => 1);
  // @ts-expect-error 异步函数返回 Promise，清理函数永远拿不到
  _effect(async () => {});
  // @ts-expect-error 条件返回：有的分支返回 number
  _effect(() => (count > 1 ? 1 : undefined));
  // @ts-expect-error 表达式体的 push 返回 number（妥协：要写成块体）
  _effect(() => form.tags.push('x'));
  _effect.pre(() => {});
  const stop = _effect.root(() => {
    _effect(() => {});
  });
  stop();

  // ---- _untrack ----
  const start = _untrack(count);
  assertType<Equal<typeof start, number>>();
  let collapsed = _state(_untrack(initial) > 0);

  // ---- 其他 ----
  const ThemeContext = createContext<{ dark: boolean }>();
  ThemeContext.provide({ dark: true });
  // @ts-expect-error provide 的参数类型
  ThemeContext.provide({ dark: 1 });
  const theme = ThemeContext.use();
  assertType<Equal<typeof theme, { dark: boolean }>>();

  const list = _state([{ id: 1, name: 'a' }]);
  return (
    <ul>
      <For each={list}>{(item, i) => <li>{item.name + i.toFixed()}</li>}</For>
      <For each={list} fallback={<i>空</i>}>
        {(item) => <li key={item.id}>{item.id}</li>}
      </For>
      {/* @ts-expect-error each 必须是数组 */}
      <For each={count}>{() => <li />}</For>
      {list.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
      {/* @ts-expect-error 回调参数 item 的类型来自 each，这里 name 不存在 */}
      <For each={list}>{(item) => <li>{item.nam}</li>}</For>
      {collapsed && <b>{String(likes + total + doubled + start)}</b>}
      {big.length > 0 && label}
    </ul>
  );
});

// 返回值必须是 JSX 元素
// @ts-expect-error 组件必须返回 JSX 元素（错误报在参数上，不是 return 语句上）
export const Bad = _component<{}>(() => {
  return 'text';
});

export type { JSX };
