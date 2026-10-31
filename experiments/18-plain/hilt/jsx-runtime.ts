// 标准 JSX 入口：tsconfig 写 "jsx": "react-jsx"、"jsxImportSource": "hilt"，esbuild、oxc、Vite 都认，不需要插件。
import { VNode } from './index';
import type { IntrinsicElements as Intrinsics } from './types/elements';

export const jsx = (type: unknown, props: unknown): VNode => new VNode(type, props);
export const jsxs = jsx;
/** 开发模式的 JSX 多传源码位置，调试内核靠它把元素和组件定位回文件 */
export const jsxDEV = (type: unknown, props: unknown, _key?: unknown, _isStatic?: unknown, source?: unknown): VNode => {
  const node = new VNode(type, props);
  (node as { source?: unknown }).source = source;
  return node;
};
export const Fragment = (props: { children?: unknown }): unknown => props.children;

// 类型在 types/ 下（元素属性、事件、SVG、CSS），这里是对外的入口
export type { Child } from './types/value';
export type { Attr, Bindable, BoolAttr, Booleanish, Live, Ref, WriteAs } from './types/value';
export type { ClassValue, InlineStyle, StyleAttr } from './types/attributes';
export type { EventHandler } from './types/events';
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
} from './types/elements';

export namespace JSX {
  export type Element = VNode;
  export type ElementType = keyof IntrinsicElements | ((props: any) => unknown);
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  /** 标准 JSX 把 key 拿走给框架用，到不了 props */
  export interface IntrinsicAttributes {
    key?: string | number | symbol;
  }
  export type IntrinsicElements = Intrinsics;
}
