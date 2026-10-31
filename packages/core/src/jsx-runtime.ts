// 标准 JSX 入口：tsconfig 写 "jsx": "react-jsx"、"jsxImportSource": "hiltkit"，esbuild、oxc、Vite 都认。
import type { VNode } from './index';

export const jsx = (type: VNode['type'], props: VNode['props']): VNode => ({ type, props });
export const jsxs = jsx;
export const Fragment = (props: { children?: unknown }): unknown => props.children;

export namespace JSX {
  export type Element = VNode;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  // 骨架占位：框架迁入时换成完整的元素类型
  export interface IntrinsicElements {
    [tag: string]: Record<string, unknown>;
  }
}
