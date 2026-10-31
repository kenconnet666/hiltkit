// 符文：_state、_state.raw、_state.snapshot、_derived、_derived.by、_effect、_untrack。
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

export const Runes = _component(() => {
  // ---- _state ----
  let count = _state(0);
  let name = _state('a');
  let open = _state(false);
  let maybe = _state<string>();
  const list = _state<string[]>([]);
  const form = _state({ name: '', rows: [{ qty: 1 }] });
  assertType<Equal<typeof count, number>>();
  assertType<Equal<typeof open, boolean>>();
  assertType<Equal<typeof maybe, string | undefined>>();

  count = 1;
  count++;
  name = name + 'b';
  form.rows.push({ qty: 2 });
  form.name = 'x';
  list.push('a');
  // @ts-expect-error 类型不对
  count = 'x';
  // @ts-expect-error 没有初始值时可能是 undefined
  const text: string = maybe;
  void text;
  maybe = 'y';

  // 布尔不会被收窄成 false：之后的比较不报“没有重叠”
  if (open === true) open = false;
  if (open) open = !open;

  // ---- _state.raw / snapshot ----
  const big = _state.raw<readonly number[]>([]);
  let el = _state.raw<HTMLElement | null>(null);
  const copy: { name: string } = _state.snapshot(form);
  // @ts-expect-error raw 的数组类型保持 readonly
  big.push(1);
  el = document.body;
  void copy;

  // ---- _derived：表达式；let 可写 ----
  let doubled = _derived(count * 2);
  const label = _derived(open ? 'on' : 'off');
  assertType<Equal<typeof doubled, number>>();
  doubled = 5;
  // @ts-expect-error 类型不对
  doubled = 'x';
  // @ts-expect-error 函数要写成 _derived.by（常见误写）
  const wrong = _derived(() => count * 2);
  void [wrong, label];

  // ---- _derived.by ----
  const total = _derived.by(() => {
    let sum = 0;
    for (const row of form.rows) sum += row.qty;
    return sum;
  });
  assertType<Equal<typeof total, number>>();

  // ---- _effect ----
  _effect(() => {
    document.title = name;
  });
  _effect(() => {
    const id = setInterval(() => {}, 1000);
    return () => clearInterval(id);
  });
  _effect.pre(() => {
    void count;
  });
  const stop: () => void = _effect.root(() => {});
  // @ts-expect-error 返回清理函数以外的值（表达式体箭头函数把 push 的结果当返回值）
  _effect(() => list.push('a'));
  void stop;

  // ---- _untrack ----
  const now: number = _untrack(count);
  void now;

  return <div>{count}{name}{maybe}</div>;
});
