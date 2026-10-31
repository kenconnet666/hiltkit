/**
 * 与具体元素无关的基础类型：JSX 表达式的结果、子节点、ref、双向绑定的标记。
 */
declare const ELEMENT: unique symbol;
declare const BOUND: unique symbol;
declare const NUMBER_MODIFIER: unique symbol;
declare const GROUP_MODIFIER: unique symbol;

/** JSX 表达式的结果。不透明：字符串、数字不能冒充它（`icon?: JsxElement` 传 "x" 会报错） */
export interface JsxElement {
  readonly [ELEMENT]: true;
}

/** 子节点：元素、文本、假值（便于 cond && <X/>）、数组（list.map 的结果） */
export type Children =
  | JsxElement
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Children[];

/**
 * `_bind(x)` 的结果：只有声明了“可绑定”的 prop 才收它（见 BindableProps）。
 * 函数类型的属性在 strictFunctionTypes 下是逆变，所以 T 在这里不变：
 * `string` 变量绑不到 `'sm' | 'md'` 的 prop 上（子组件会写入任意字符串），反过来也不行。
 */
export interface Bound<T> {
  readonly [BOUND]: (value: T) => T;
}
/** `_bind.number(x)` 的结果：文本输入框的值是字符串，加了 .number 才能绑数字变量 */
export interface NumberBound extends Bound<number> {
  readonly [NUMBER_MODIFIER]: true;
}
/** `_bind.group(list)` 的结果：复选框、单选框的 checked 按“值是否在组里”读写 */
export interface GroupBound extends Bound<boolean> {
  readonly [GROUP_MODIFIER]: true;
}

/** ref：回调，元素挂载时收到元素，卸载时收到 null */
export type Ref<El> = (el: El | null) => void;

declare const HINT: unique symbol;
/**
 * 拼写提示：React 的写法（className）在这里不存在，属性的类型换成 `WriteAs<'class'>`，
 * 报错信息里会直接出现 “not assignable to type 'WriteAs<"class">'”，悬停时 @deprecated 也给出正确写法。
 */
export interface WriteAs<Name extends string> {
  readonly [HINT]: Name;
}
