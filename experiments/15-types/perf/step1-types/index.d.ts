/**
 * 框架入口：组件作者用到的类型与少量函数（符文是全局的，不从这里导入）。
 */
import type {} from '@hilt/runtime/runes';
import type { Children, JsxElement } from '@hilt/runtime/core';

export type { Bound, Children, JsxElement, Ref, WriteAs } from '@hilt/runtime/core';
export type { JSX } from '@hilt/runtime/jsx-runtime';
export type { BoolAttr, Booleanish, ClassValue, InlineStyle } from '@hilt/runtime/elements/attributes';
export type {
  CustomElementDefinition,
  CustomElements,
  ElementOf,
  HtmlProps,
  HtmlTag,
  IntrinsicProps,
  IntrinsicTag,
  SvgProps,
  SvgTag,
} from '@hilt/runtime/elements';
export type { EventHandler } from '@hilt/runtime/elements/events';

/**
 * 可双向绑定的 props：`interface Props extends BindableProps<{ value: string; open: boolean }> { … }`
 * 展开成 `{ value?: string; onValueChange?: (next: string) => void; open?: boolean; onOpenChange?: … }`。
 *
 * 类型层的“可绑定”约定：prop `x` 有配套的 `onXChange` 回调，才收 `x={_bind(…)}`；
 * 没有回调的 prop 收到 `_bind(…)` 是类型错误。写在函数体里的 `_bindable()` 默认值类型层读不到，
 * 所以 `onXChange` 是登记凭据：声明了 `_bindable` 的 prop 要在 Props 里补上回调（用本工具类型最省事）。
 * 回调写成方法签名（参数双向协变）：绑定 `readonly string[]` 的变量时，处理 `string[]` 的回调也能传。
 */
export type BindableProps<T extends object> = {
  [K in keyof T & string]?: T[K];
} & {
  [K in keyof T & string as `on${Capitalize<K>}Change`]?: { bivarianceHack(next: T[K]): void }['bivarianceHack'];
};

/** 列表渲染：`<For each={list}>{(item, i) => …}</For>` */
export declare function For<T>(props: {
  each: readonly T[] | null | undefined;
  fallback?: JsxElement;
  children: (item: T, index: number) => Children;
}): JsxElement;
