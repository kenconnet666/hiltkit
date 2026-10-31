/**
 * 原生元素的 props 汇总：标签 → 属性表，以及组件转发 rest 用的 HtmlProps / SvgProps。
 *
 * 一个标签的属性 = 全局属性（CommonAttrs + HtmlGlobalAttrs）+ 事件（currentTarget 是该元素）+ 标签专属属性。
 * 属性表是自写子集（见 html.d.ts / svg.d.ts），不依赖 @types/react；csstype 只用在样式取值上（见 css/）。
 */
import type { CommonAttrs, HtmlGlobalAttrs } from './attributes';
import type { EscapeEvents, EventAttrs } from '@hilt/runtime/elements/events';
import type { HtmlSpecific } from './html';
import type { SvgPresentation, SvgReactSpellings, SvgSpecific } from './svg';

export type HtmlTag = keyof HTMLElementTagNameMap;
export type SvgTag = keyof SVGElementTagNameMap;
export type IntrinsicTag = HtmlTag | SvgTag;

export type ElementOf<Tag> = Tag extends HtmlTag
  ? HTMLElementTagNameMap[Tag]
  : Tag extends SvgTag
    ? SVGElementTagNameMap[Tag]
    : never;

/** HTML 元素共有的部分：展开成一个接口，同一个元素类型只解析一次 */
interface HtmlBase<El> extends CommonAttrs<El>, HtmlGlobalAttrs, EventAttrs<El, HTMLElementEventMap>, EscapeEvents<El> {}
interface SvgBase<El>
  extends CommonAttrs<El>,
    SvgPresentation,
    SvgReactSpellings,
    EventAttrs<El, SVGElementEventMap>,
    EscapeEvents<El> {}

type HtmlElementProps<Tag extends HtmlTag> = HtmlBase<HTMLElementTagNameMap[Tag]> &
  (Tag extends keyof HtmlSpecific ? HtmlSpecific[Tag] : unknown);
type SvgElementProps<Tag extends SvgTag> = SvgBase<SVGElementTagNameMap[Tag]> &
  (Tag extends keyof SvgSpecific ? SvgSpecific[Tag] : unknown);

/**
 * 一个标签的全部属性。输入框这类按 type 分支的标签是联合类型。
 * a、script、style、title 在 HTML 与 SVG 里同名，按 HTML 处理。
 */
export type IntrinsicProps<Tag extends IntrinsicTag> = Tag extends HtmlTag
  ? HtmlElementProps<Tag>
  : Tag extends SvgTag
    ? SvgElementProps<Tag>
    : never;

// ---- 自定义元素 -------------------------------------------------------------------------------

/**
 * 自定义元素的登记处，用声明合并追加：
 *   declare module '@hilt/runtime/elements' {
 *     interface CustomElements {
 *       'x-card': { props: { heading?: string; elevated?: BoolAttr }; element: XCardElement; events: { 'x-toggle': CustomEvent<boolean> } };
 *     }
 *   }
 * props 是属性（含 BoolAttr 等），element 决定 ref 与 currentTarget 的类型（默认 HTMLElement），
 * events 里的事件写成 `onXToggle`（连字符转驼峰，运行时再转回去）；没登记的事件走 `on:名字`。
 */
export interface CustomElements {}
export interface CustomElementDefinition {
  props?: object;
  element?: HTMLElement;
  events?: { [event: string]: Event };
}

type PascalCase<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Capitalize<Head>}${PascalCase<Tail>}`
  : Capitalize<S>;
type CustomEventMap<D> = D extends { events: infer E } ? E : {};
type CustomElement<D> = D extends { element: infer E extends HTMLElement } ? E : HTMLElement;

interface CustomBase<El> extends CommonAttrs<El>, HtmlGlobalAttrs, EventAttrs<El, HTMLElementEventMap>, EscapeEvents<El> {}
type CustomElementProps<D extends CustomElementDefinition> = CustomBase<CustomElement<D>> &
  EventAttrs<CustomElement<D>, { [K in keyof CustomEventMap<D> & string as PascalCase<K>]: CustomEventMap<D>[K] }> &
  (D extends { props: infer P } ? P : unknown);

export type IntrinsicElements = { [Tag in IntrinsicTag]: IntrinsicProps<Tag> } & {
  [Tag in keyof CustomElements & string]: CustomElements[Tag] extends CustomElementDefinition
    ? CustomElementProps<CustomElements[Tag]>
    : never;
};

// ---- 组件转发 rest 用的工具类型 ------------------------------------------------------------------

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** 连字符属性（aria-*、data-*）：JSX 对不在类型里的连字符属性不报错，所以不能只靠 Omit，要显式标成 never */
type HyphenKeys<K extends string> = Extract<K, `${string}-${string}`>;
type Without<P, Managed extends string> = [Managed] extends [never]
  ? P
  : DistributiveOmit<P, Managed> & { [H in HyphenKeys<Managed>]?: never };

/**
 * 转发到原生 HTML 元素的 props：`interface Props extends HtmlProps<'button', 'type' | 'aria-busy'> { … }`。
 * 第二个参数是组件自己管理的属性（从转发里去掉）。包含 sx、ref、key、children 与全部事件。
 * 对 <input> 这种按 type 分支的标签结果是联合类型，所以要用 `type Props = HtmlProps<…> & {…}` 而不是 interface extends。
 */
export type HtmlProps<Tag extends HtmlTag, Managed extends string = never> = Without<HtmlElementProps<Tag>, Managed>;
/** 转发到 SVG 元素：`SvgProps<'svg', 'children'>`（部件不要 children 时写进受管） */
export type SvgProps<Tag extends SvgTag, Managed extends string = never> = Without<SvgElementProps<Tag>, Managed>;
