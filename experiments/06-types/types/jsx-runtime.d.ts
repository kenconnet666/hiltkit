/**
 * JSX 类型入口（tsconfig 的 jsxImportSource 指向本包时由 TypeScript 读取）。
 * 同时加载符文的全局声明，所以只要配置了 jsxImportSource 就能直接用 _state 等。
 */
import type {} from './runes';
import type { JsxElement } from 'exp06/core';
import type { IntrinsicProps, IntrinsicTag } from 'exp06/elements';

export declare namespace JSX {
  interface Element extends JsxElement {}
  /** 子节点对应的 prop 名：JSX 内容就是 children prop */
  interface ElementChildrenAttribute {
    children: {};
  }
  type IntrinsicElements = { [Tag in IntrinsicTag]: IntrinsicProps<Tag> };
  interface IntrinsicAttributes {
    key?: string | number | symbol;
  }
}
