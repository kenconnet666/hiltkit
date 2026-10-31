/**
 * JSX 类型入口（tsconfig 的 jsxImportSource 指向本包时由 TypeScript 读取）。
 * 同时加载符文的全局声明，所以只要配置了 jsxImportSource 就能直接用 _state 等。
 */
import type {} from '@hilt/runtime/runes';
import type { Bound, JsxElement } from '@hilt/runtime/core';
import type { IntrinsicElements as Intrinsics, IntrinsicTag } from '@hilt/runtime/elements';

/**
 * 组件调用侧可绑定的 prop 名：有配套 `onXxxChange` 回调、且 xxx 本身也是 P 的成员。
 *   - 先用模式交叉筛出以 Change 结尾的回调键（一次性筛掉一千多个事件键，不逐个做条件类型）；
 *   - 再对这几个键逐个检查 xxx 是不是 P 的成员：原生的 onChange（xxx 为空）、onSelectionChange、onVolumeChange
 *     对应的 selection、volume 不是成员，被筛掉；`on:名字` 的模式索引签名与模式相交后得到的 `on:${string}Change`
 *     推出的 xxx 是个模式、也不是成员。
 * 这一步为空时 BoundProps 原样返回 P，不映射 P 的全部键（转发了 HtmlProps 的组件有一千多个键）。
 */
type BindableKeys<P> = (keyof P & `on${string}Change`) extends infer Callback
  ? Callback extends `on${infer Name}Change`
    ? Uncapitalize<Name> extends keyof P
      ? Uncapitalize<Name>
      : never
    : never
  : never;
/** 组件调用侧的 props：可绑定的 prop 额外收 `_bind(…)` 的结果 */
type BoundProps<P> = [BindableKeys<P>] extends [never]
  ? P
  : { [K in keyof P]: K extends BindableKeys<P> ? P[K] | Bound<NonNullable<P[K]>> : P[K] };

export declare namespace JSX {
  interface Element extends JsxElement {}
  /** 子节点对应的 prop 名：JSX 内容就是 children prop */
  interface ElementChildrenAttribute {
    children: {};
  }
  type ElementType = IntrinsicTag | keyof Intrinsics | ((props: never) => JsxElement);
  type IntrinsicElements = Intrinsics;
  interface IntrinsicAttributes {
    key?: string | number | symbol;
  }
  /** 原生元素传进来的 C 是属性类型本身（不是函数），只有组件才做 _bind 映射——否则 <input> 这种联合属性表会报 TS2590 */
  type LibraryManagedAttributes<C, P> = C extends (...args: never[]) => unknown ? BoundProps<P> : P;
}
