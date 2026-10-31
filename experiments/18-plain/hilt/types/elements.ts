/**
 * 原生元素的 props 汇总：标签 → 属性表，以及组件转发 rest 用的 HtmlProps / SvgProps。
 *
 * 一个标签的属性 = 全局属性（Aria + Global + HtmlGlobal，取值都是“值或读取函数”）+ 事件（currentTarget 是该元素）
 *                + sx / ref / children / class / style + 标签专属属性。
 * 属性表是自写子集（见 html.ts / svg.ts），不依赖 @types/react；csstype 只用在样式取值上（见 css/）。
 */
import type { AriaAttrs, CoreAttrs, DataAttrs, GlobalAttrs, HtmlGlobalAttrs, ReactSpellings } from './attributes';
import type { EscapeEvents, EventAttrs, SuffixEvents, SuffixedEventAttrs } from './events';
import type { HtmlSpecific } from './html';
import type { SvgPresentation, SvgReactSpellings, SvgSpecific } from './svg';
import type { Live } from './value';

export type HtmlTag = keyof HTMLElementTagNameMap;
export type SvgTag = keyof SVGElementTagNameMap;
export type IntrinsicTag = HtmlTag | SvgTag;

export type ElementOf<Tag> = Tag extends HtmlTag
  ? HTMLElementTagNameMap[Tag]
  : Tag extends SvgTag
    ? SVGElementTagNameMap[Tag]
    : never;

/** 展开成一个接口：同一个元素类型只解析一次 */
interface HtmlBase<El>
  extends CoreAttrs<El>,
    AriaAttrs,
    GlobalAttrs,
    HtmlGlobalAttrs,
    DataAttrs,
    ReactSpellings,
    EventAttrs<El, HTMLElementEventMap>,
    SuffixedEventAttrs<El, HTMLElementEventMap>,
    SuffixEvents<El>,
    EscapeEvents<El> {}
interface SvgBase<El>
  extends CoreAttrs<El>,
    AriaAttrs,
    GlobalAttrs,
    Live<SvgPresentation>,
    DataAttrs,
    ReactSpellings,
    SvgReactSpellings,
    EventAttrs<El, SVGElementEventMap>,
    SuffixedEventAttrs<El, SVGElementEventMap>,
    SuffixEvents<El>,
    EscapeEvents<El> {}

type HtmlElementProps<Tag extends HtmlTag> = HtmlBase<HTMLElementTagNameMap[Tag]> & (Tag extends keyof HtmlSpecific ? HtmlSpecific[Tag] : unknown);
type SvgElementProps<Tag extends SvgTag> = SvgBase<SVGElementTagNameMap[Tag]> & (Tag extends keyof SvgSpecific ? SvgSpecific[Tag] : unknown);

/**
 * 一个标签的全部属性。a、script、style、title 在 HTML 与 SVG 里同名，按 HTML 处理。
 */
export type IntrinsicProps<Tag extends IntrinsicTag> = Tag extends HtmlTag
  ? HtmlElementProps<Tag>
  : Tag extends SvgTag
    ? SvgElementProps<Tag>
    : never;

// ---- 自定义元素 -------------------------------------------------------------------------------

/**
 * 自定义元素的登记处，用声明合并追加：
 *   declare module 'hilt/jsx-runtime' {
 *     interface CustomElements {
 *       'x-card': { props: { heading?: Attr<string>; elevated?: Attr<BoolAttr> }; element: XCardElement; events: { 'x-toggle': CustomEvent<boolean> } };
 *     }
 *   }
 * props 是属性（自己写 Attr<…> 才是活的），element 决定 ref 与 currentTarget 的类型（默认 HTMLElement），
 * events 里的事件写成 `onXToggle`（连字符转驼峰，运行时再转回去）；没登记的事件走 `on:名字`。
 */
export interface CustomElements {}
export interface CustomElementDefinition {
  props?: object;
  element?: HTMLElement;
  events?: { [event: string]: Event };
}

type PascalCase<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Capitalize<Head>}${PascalCase<Tail>}` : Capitalize<S>;
type CustomEventMap<D> = D extends { events: infer E } ? E : {};
type CustomElement<D> = D extends { element: infer E extends HTMLElement } ? E : HTMLElement;

type CustomElementProps<D extends CustomElementDefinition> = HtmlBase<CustomElement<D>> &
  EventAttrs<CustomElement<D>, { [K in keyof CustomEventMap<D> & string as PascalCase<K>]: CustomEventMap<D>[K] }> &
  (D extends { props: infer P } ? P : unknown);

export type IntrinsicElements = { [Tag in IntrinsicTag]: IntrinsicProps<Tag> } & {
  [Tag in keyof CustomElements & string]: CustomElements[Tag] extends CustomElementDefinition ? CustomElementProps<CustomElements[Tag]> : never;
};

// ---- 组件转发 rest 用的工具类型 ------------------------------------------------------------------

/** 连字符属性（aria-*、data-*）：JSX 对不在类型里的连字符属性不报错，所以去掉之后还要显式标成 never，使用方才写不进来 */
type HyphenKeys<K extends string> = Extract<K, `${string}-${string}`>;
/**
 * 去掉组件自己管理的属性。用键重映射（as）而不是内置 Omit：Omit 是 Pick<T, Exclude<keyof T, K>>，
 * keyof 的联合里字面量键（onClickCapture）会被同一联合里的模式键（`on${string}Capture`）吞掉，后缀事件就退回通用 Event；
 * 键重映射对属性和索引签名分别处理，精确类型保留。
 */
type Without<P, Managed extends string> = [Managed] extends [never]
  ? P
  : { [K in keyof P as K extends Managed ? never : K]: P[K] } & { [H in HyphenKeys<Managed>]?: never };

/**
 * 转发到原生 HTML 元素的 props：`interface Props extends HtmlProps<'button', 'type' | 'disabled'> { … }`，
 * 第二个参数是组件自己管理的属性（从转发里去掉，可省略）。包含 sx、ref、children 与全部事件。
 * 内置 Omit 也能用（`Omit<HtmlProps<'button'>, 'type'>`），只是后缀事件会退回通用 Event。
 */
export type HtmlProps<Tag extends HtmlTag, Managed extends string = never> = Without<HtmlElementProps<Tag>, Managed>;
/** 转发到 SVG 元素：`SvgProps<'svg', 'children'>` */
export type SvgProps<Tag extends SvgTag, Managed extends string = never> = Without<SvgElementProps<Tag>, Managed>;
