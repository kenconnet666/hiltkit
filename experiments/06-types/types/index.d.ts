/**
 * 框架入口：组件作者用到的类型与少量函数（符文是全局的，不从这里导入）。
 */
import type {} from './runes';
import type { Children, JsxElement } from 'exp06/core';
import type { IntrinsicProps, IntrinsicTag } from 'exp06/elements';

export type { Children, JsxElement, Ref } from 'exp06/core';
export type { JSX } from 'exp06/jsx-runtime';
export { css } from 'exp06/styles';
export type { SxStyles, CompiledStyles } from 'exp06/styles';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** 连字符属性（aria-*、data-*）：JSX 对不在类型里的连字符属性不报错，所以不能只靠 Omit，要显式标成 never */
type HyphenKeys<M extends string> = Extract<M, `${string}-${string}`>;

/**
 * 原生元素部件的 props：该元素的属性（含 sx、ref、children）去掉组件受管的属性。
 * `PartProps<'button', 'role' | 'aria-busy'>`；部件不要 children 时写进受管：`PartProps<'svg', 'children'>`。
 * 对 <input> 这种按 type 分支的标签结果是联合类型，所以用 `type` 而不是 `interface ... extends`。
 */
export type PartProps<Tag extends IntrinsicTag, Managed extends string = never> = DistributiveOmit<
  IntrinsicProps<Tag>,
  Managed
> & { [K in HyphenKeys<Managed>]?: never };

/**
 * 可双向绑定的 prop：`Bindable<'value', T>` 展开成 `{ _value?: T; onValueChange?: (next: T) => void }`。
 * 回调写成方法签名（参数双向协变）：绑定 `readonly string[]` 的变量时，处理 `string[]` 的回调也能传。
 */
export type Bindable<Name extends string, T> = {
  [K in `_${Name}`]?: T;
} & {
  [K in `on${Capitalize<Name>}Change`]?: { bivarianceHack(next: T): void }['bivarianceHack'];
};

/** 列表渲染：`<For each={list}>{(item, i) => …}</For>` */
export declare function For<T>(props: {
  each: readonly T[] | null | undefined;
  fallback?: JsxElement;
  children: (item: T, index: number) => Children;
}): JsxElement;

export interface Context<T> {
  provide(value: T): void;
  use(): T;
}
export declare function createContext<T>(): Context<T>;
