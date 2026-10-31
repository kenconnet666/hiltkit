/** 与具体元素无关的基础类型：JSX 表达式的结果、子节点、ref */
declare const ELEMENT: unique symbol;

/** JSX 表达式的结果。不透明：字符串、数字不能冒充它（icon?: JSX.Element 传 "x" 会报错） */
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
 * ref 的取值：`ref={el}`（el 是 `_state<HTMLInputElement | null>(null)` 这类变量，编译器负责回填）
 * 或回调 `ref={(el) => {}}`
 */
export type Ref<El> = El | null | undefined | ((el: El) => void);
