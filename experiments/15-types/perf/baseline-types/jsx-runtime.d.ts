/**
 * JSX 类型入口（tsconfig 的 jsxImportSource 指向本包时由 TypeScript 读取）。
 * 同时加载符文的全局声明，所以只要配置了 jsxImportSource 就能直接用 _state 等。
 */
import type {} from '@hilt/runtime/runes';
import type { Bound, JsxElement } from '@hilt/runtime/core';
import type { IntrinsicElements as Intrinsics, IntrinsicTag } from '@hilt/runtime/elements';

/** 有配套 `onXxxChange` 回调的 prop（登记为可绑定），名字是 xxx */
type BindableName<K> = K extends `on${infer Name}Change` ? Uncapitalize<Name> : never;
/**
 * 组件调用侧的 props：可绑定的 prop 额外收 `_bind(…)` 的结果。
 * 只在 props 里真有 `onXxxChange` 时才做映射（先用模式交叉筛一遍键，没有就原样返回，不增加成本）。
 */
type BoundProps<P> = [keyof P & `on${string}Change`] extends [never]
  ? P
  : { [K in keyof P]: K extends BindableName<keyof P & `on${string}Change`> ? P[K] | Bound<NonNullable<P[K]>> : P[K] };

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
