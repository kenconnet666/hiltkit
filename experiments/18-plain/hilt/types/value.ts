// 属性取值的基础类型。规则只有一条，和运行时一致：传函数是活的，传值只取一次，Sig 才能写回。
import type { Prop, ReadOnly, VNode } from '../index';

/** 能放进 JSX 内容的东西。函数 = 活的一段 */
export type Child = string | number | boolean | null | undefined | VNode | Node | ChildFn | ChildList;
interface ChildFn {
  (): Child;
}
interface ChildList extends ReadonlyArray<Child> {}

/** 普通属性：值，或返回这个值的函数（读取函数、derived、Sig 都行）。函数里 `cond && 'x'` 的 false 不是合法返回 */
export type Attr<T> = Prop<T>;

/** 把一张属性表的每个取值都换成 `Attr<…>`：属性表里只写静态取值，活的版本统一在这里派生 */
export type Live<T> = { [K in keyof T]: Attr<T[K]> };

/**
 * 可写回的属性（input 的 value、checked）：读出 R，写回的永远是 W。
 *   - 传值或只读函数（derived、普通箭头函数）：单向；
 *   - 传 Sig：双向。Sig 在写入端逆变、读取端协变，所以 `Sig<'a' | 'b'>` 绑不到文本框（会被写入任意字符串），
 *     `Sig<number>` 绑不到只写字符串的 `W = string` 上，`Sig<boolean>` 读出来就不是 R。
 * W 是联合时分配：`Bindable<string | number | undefined, string | number>` 收 `Sig<string>`、`Sig<number>`、`Sig<string | undefined>`。
 */
export type Bindable<R, W extends R = R> = R | ReadOnly<R> | (W extends unknown ? WriteBack<R, W> : never);
/** set 写成属性（不是方法）：属性里的函数类型在 strictFunctionTypes 下参数逆变，方法是双变的 */
interface WriteBack<R, W> {
  (): R;
  readonly set: (value: W) => void;
}

/**
 * 布尔属性：true 写出空属性，false 移除。不收字符串：`disabled="false"` 是真值，容易写错；
 * 空字符串 `disabled=""` 虽然 HTML 里为真，但在 JS 里是假值，组件把 prop 转给原生元素又自己读它时会判反，所以也不收
 */
export type BoolAttr = boolean;
/** 枚举型属性里的“真/假”：false 写成字符串 "false"（aria-*、draggable 需要） */
export type Booleanish = boolean | 'true' | 'false';

declare const HINT: unique symbol;
/**
 * 拼写提示：React 的写法（className）在这里不存在，属性的类型换成 `WriteAs<'class'>`，
 * 报错信息里会直接出现 “not assignable to type 'WriteAs<"class">'”，悬停时 @deprecated 也给出正确写法。
 */
export interface WriteAs<Name extends string> {
  readonly [HINT]: Name;
}

/** ref：Sig 或回调。元素挂载时收到元素，卸载时收到 null。Sig 在这里只写不读，所以能收下这个元素的壳都行（`Sig<HTMLElement | null>` 可以给 div）。set 写成属性（参数逆变）而不是方法（双变）：不收 null 的 `Sig<HTMLDivElement>`、别的元素的 Sig 都会被拒 */
export type Ref<El> = { readonly set: (value: El | null) => void } | (((el: El | null) => void) & { set?: undefined });
