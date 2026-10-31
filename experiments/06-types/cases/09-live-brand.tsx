/**
 * 第 9 条：用品牌类型提示“活对象”——一个可行的窄用途方案，以及它拦不住的东西。
 * 全部用本文件内的局部声明，不污染全局符文。
 */

declare const LIVE: unique symbol;
/** 对象状态带上“活代理”标记；原始值不加（number & 品牌在算术、赋值上都没有收益） */
type Live<T> = T extends object ? T & { readonly [LIVE]?: 'live' } : T;
/** 要求“不是活代理”的参数类型：活对象的标记是 'live'，不满足 undefined */
type Plain<T> = T & { readonly [LIVE]?: undefined };
/** 去掉标记 */
type Unlive<T> = Omit<T, typeof LIVE> extends infer R ? (T extends Live<infer U> ? U : R) : never;

declare function stateLive<T>(initial: T): Live<T>;
declare function stateLive(initial: boolean): boolean;
declare function snapshotLive<T>(value: T): Unlive<T>;
/** 代表 structuredClone / postMessage / IndexedDB.put：传进去的 Proxy 会在运行时抛 DataCloneError */
declare function cloneStrict<T>(value: Plain<T>): T;

interface Form {
  name: string;
  tags: string[];
}

export const Brand = _component<{}>(() => {
  const form = stateLive<Form>({ name: '', tags: [] });
  let count = stateLive(0);
  const list = stateLive([1, 2, 3]);

  // ---- 日常使用不受影响 ----
  form.name = 'x';
  form.tags.push('a');
  count = count + 1;
  const total: number = count;
  const sum: number = list.reduce((a, b) => a + b, 0);
  const asForm: Form = form; // 活对象仍可当普通 Form 传
  JSON.stringify(form);
  list.map((n) => n * 2);
  list.length;
  void [total, sum, asForm];

  // ---- 拦得住：把活代理直接交给要求纯数据的 API ----
  // @ts-expect-error 活代理不能传给 structuredClone 一类的 API（运行时会抛 DataCloneError）：先 _state.snapshot
  cloneStrict(form);
  // @ts-expect-error 数组状态同理
  cloneStrict(list);
  cloneStrict(snapshotLive(form));
  cloneStrict({ name: 'x', tags: [] });
  cloneStrict(count); // 原始值没有标记，本来就安全

  // ---- 拦不住（假阴性）：标记只在最外层 ----
  const wrapped = { form }; // 对象里装着活代理
  cloneStrict(wrapped); // 运行时会抛，类型不报
  cloneStrict(form.tags); // 嵌套的数组也是代理，类型不报
  cloneStrict([form]); // 数组里装着活代理，类型不报
  const { name, tags } = form; // 解构：类型层完全无从得知
  cloneStrict(tags); // tags 是代理，类型不报
  const spreaded = { ...form }; // 展开：浅拷贝，嵌套仍是代理；标记还留在类型上
  void [name, spreaded];

  // ---- 代价：悬停与错误信息里多出标记 ----
  // @ts-expect-error 故意赋错，看类型怎么显示
  const shown: 5 = form;
  void shown;

  return <i />;
});
