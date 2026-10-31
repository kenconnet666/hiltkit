// 标准 JSX 入口：tsconfig 写 "jsx": "react-jsx"、"jsxImportSource": "hilt"，esbuild、oxc、Vite 都认，不需要插件。
import { VNode, type Prop, type ReadSig, type Sig } from './index';

export const jsx = (type: unknown, props: unknown): VNode => new VNode(type, props);
export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = (props: { children?: unknown }): unknown => props.children;

/** 能放进 JSX 内容的东西。函数 = 活的一段 */
export type Child = string | number | boolean | null | undefined | VNode | Node | ChildFn | ChildList;
interface ChildFn {
  (): Child;
}
interface ChildList extends ReadonlyArray<Child> {}
type Attr<T> = Prop<T>;
type ClassValue = string | false | null | undefined | ClassFn | ClassList | { [name: string]: Attr<unknown> };
interface ClassFn {
  (): ClassValue;
}
interface ClassList extends ReadonlyArray<ClassValue> {}

type ElementEvents<E> = {
  [K in keyof GlobalEventHandlersEventMap as `on${Capitalize<K>}` | `on${Capitalize<K>}Capture` | `on${Capitalize<K>}Once`]?: (event: GlobalEventHandlersEventMap[K] & { currentTarget: E }) => void;
};
export type HtmlProps<K extends keyof HTMLElementTagNameMap> = Attrs<HTMLElementTagNameMap[K]> & (K extends keyof TagAttrs ? TagAttrs[K] : unknown);
interface Attrs<E> extends ElementEvents<E> {
  id?: Attr<string | undefined>;
  class?: ClassValue;
  style?: Attr<string | object | undefined>;
  sx?: unknown;
  title?: Attr<string | undefined>;
  role?: Attr<string | undefined>;
  hidden?: Attr<boolean | string | undefined>;
  tabindex?: Attr<number | string | undefined>;
  /** Sig 不变，这里只写不读：能收下这个元素的壳都行 */
  ref?: { set(value: E | null): void } | (((el: E | null) => void) & { set?: undefined });
  children?: Child;
  key?: unknown;
  innerHTML?: Attr<string>;
  [data: `data-${string}`]: unknown;
  [aria: `aria-${string}`]: unknown;
}
interface FormAttrs {
  name?: Attr<string | undefined>;
  type?: Attr<string | undefined>;
  disabled?: Attr<boolean | undefined>;
  required?: Attr<boolean | undefined>;
  readonly?: Attr<boolean | undefined>;
  placeholder?: Attr<string | undefined>;
  min?: Attr<number | string | undefined>;
  max?: Attr<number | string | undefined>;
  /** 传 Sig 双向，传值或只读函数单向 */
  value?: Attr<string | number | undefined>;
  checked?: Attr<boolean | undefined>;
}
interface TagAttrs {
  input: FormAttrs;
  textarea: FormAttrs;
  select: FormAttrs;
  button: { type?: Attr<string>; disabled?: Attr<boolean | undefined> };
  label: { for?: Attr<string | undefined> };
  a: { href?: Attr<string | undefined>; target?: Attr<string | undefined> };
  img: { src?: Attr<string | undefined>; alt?: Attr<string | undefined>; loading?: Attr<string | undefined> };
  option: { value?: Attr<string | undefined>; selected?: Attr<boolean | undefined> };
}
type SvgElements = {
  [K in keyof SVGElementTagNameMap]: Attrs<SVGElementTagNameMap[K]> & { [attr: string]: unknown };
};
type HtmlElements = { [K in keyof HTMLElementTagNameMap]: HtmlProps<K> };

export namespace JSX {
  export type Element = VNode;
  export type ElementType = keyof IntrinsicElements | ((props: any) => unknown);
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export interface IntrinsicElements extends HtmlElements, Omit<SvgElements, keyof HtmlElements> {}
}
