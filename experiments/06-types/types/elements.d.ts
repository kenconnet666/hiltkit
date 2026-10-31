/**
 * 原生元素的属性：全局属性 + ARIA + 事件（currentTarget 带具体元素）+ 各标签自己的属性 + sx / ref / children。
 * 事件名由 lib.dom 的事件表生成（onClick、onInput…），双向绑定属性（_value、_checked、_open、_files）按标签给出。
 */
import type * as CSS from 'csstype';
import type { Children, Ref } from 'exp06/core';
import type { SxStyles } from 'exp06/styles';

export type HtmlTag = keyof HTMLElementTagNameMap;
export type SvgTag = keyof SVGElementTagNameMap;
export type IntrinsicTag = HtmlTag | SvgTag;

export type ElementOf<Tag> = Tag extends HtmlTag
  ? HTMLElementTagNameMap[Tag]
  : Tag extends SvgTag
    ? SVGElementTagNameMap[Tag]
    : never;

type Booleanish = boolean | 'true' | 'false';

/**
 * lib.dom 的事件名全小写（keydown），Capitalize 只能得到 onKeydown。
 * 想要 onKeyDown / onDblClick 这种驼峰，只能手写一张表：不规则的才列，其余仍然 Capitalize。
 */
interface EventCamelCase {
  keydown: 'KeyDown'; keyup: 'KeyUp'; keypress: 'KeyPress';
  mousedown: 'MouseDown'; mouseup: 'MouseUp'; mousemove: 'MouseMove'; mouseenter: 'MouseEnter';
  mouseleave: 'MouseLeave'; mouseover: 'MouseOver'; mouseout: 'MouseOut'; dblclick: 'DblClick';
  contextmenu: 'ContextMenu'; auxclick: 'AuxClick';
  pointerdown: 'PointerDown'; pointerup: 'PointerUp'; pointermove: 'PointerMove'; pointerenter: 'PointerEnter';
  pointerleave: 'PointerLeave'; pointerover: 'PointerOver'; pointerout: 'PointerOut'; pointercancel: 'PointerCancel';
  gotpointercapture: 'GotPointerCapture'; lostpointercapture: 'LostPointerCapture';
  touchstart: 'TouchStart'; touchend: 'TouchEnd'; touchmove: 'TouchMove'; touchcancel: 'TouchCancel';
  dragstart: 'DragStart'; dragend: 'DragEnd'; dragenter: 'DragEnter'; dragleave: 'DragLeave'; dragover: 'DragOver';
  focusin: 'FocusIn'; focusout: 'FocusOut'; beforeinput: 'BeforeInput'; beforetoggle: 'BeforeToggle';
  compositionstart: 'CompositionStart'; compositionend: 'CompositionEnd'; compositionupdate: 'CompositionUpdate';
  animationstart: 'AnimationStart'; animationend: 'AnimationEnd'; animationiteration: 'AnimationIteration';
  transitionend: 'TransitionEnd'; transitionstart: 'TransitionStart'; transitionrun: 'TransitionRun';
  selectionchange: 'SelectionChange'; selectstart: 'SelectStart'; fullscreenchange: 'FullscreenChange';
  loadeddata: 'LoadedData'; loadedmetadata: 'LoadedMetadata'; loadstart: 'LoadStart'; timeupdate: 'TimeUpdate';
  volumechange: 'VolumeChange'; ratechange: 'RateChange'; durationchange: 'DurationChange'; canplaythrough: 'CanPlayThrough';
  securitypolicyviolation: 'SecurityPolicyViolation'; slotchange: 'SlotChange'; cuechange: 'CueChange';
}
type EventName<K extends string> = K extends keyof EventCamelCase ? EventCamelCase[K] : Capitalize<K>;

/** 由事件表生成 onXxx：参数的 currentTarget 是具体元素 */
type EventAttrs<El, Map> = {
  [K in keyof Map & string as `on${EventName<K>}`]?: (event: Map[K] & { currentTarget: El }) => void;
};

interface AriaAttrs {
  role?: string;
  'aria-activedescendant'?: string;
  'aria-atomic'?: Booleanish;
  'aria-autocomplete'?: 'none' | 'inline' | 'list' | 'both';
  'aria-busy'?: Booleanish;
  'aria-checked'?: Booleanish | 'mixed';
  'aria-colcount'?: number;
  'aria-colindex'?: number;
  'aria-colspan'?: number;
  'aria-controls'?: string;
  'aria-current'?: Booleanish | 'page' | 'step' | 'location' | 'date' | 'time';
  'aria-describedby'?: string;
  'aria-description'?: string;
  'aria-details'?: string;
  'aria-disabled'?: Booleanish;
  'aria-errormessage'?: string;
  'aria-expanded'?: Booleanish;
  'aria-flowto'?: string;
  'aria-haspopup'?: Booleanish | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
  'aria-hidden'?: Booleanish;
  'aria-invalid'?: Booleanish | 'grammar' | 'spelling';
  'aria-keyshortcuts'?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-level'?: number;
  'aria-live'?: 'off' | 'assertive' | 'polite';
  'aria-modal'?: Booleanish;
  'aria-multiline'?: Booleanish;
  'aria-multiselectable'?: Booleanish;
  'aria-orientation'?: 'horizontal' | 'vertical';
  'aria-owns'?: string;
  'aria-placeholder'?: string;
  'aria-posinset'?: number;
  'aria-pressed'?: Booleanish | 'mixed';
  'aria-readonly'?: Booleanish;
  'aria-relevant'?: string;
  'aria-required'?: Booleanish;
  'aria-roledescription'?: string;
  'aria-rowcount'?: number;
  'aria-rowindex'?: number;
  'aria-rowspan'?: number;
  'aria-selected'?: Booleanish;
  'aria-setsize'?: number;
  'aria-sort'?: 'none' | 'ascending' | 'descending' | 'other';
  'aria-valuemax'?: number;
  'aria-valuemin'?: number;
  'aria-valuenow'?: number;
  'aria-valuetext'?: string;
}

/** 所有元素共有：sx、ref、children 以及全局属性 */
interface CommonAttrs<El> extends AriaAttrs {
  /** 样式：样式组、动态样式、假值、对象字面量或它们的嵌套数组 */
  sx?: SxStyles;
  /** 列表项的身份（list.map 里写 key={item.id}）；IntrinsicAttributes 只管组件，原生元素要自己声明 */
  key?: string | number | symbol;
  ref?: Ref<El>;
  children?: Children;
  id?: string;
  class?: string;
  style?: string | CSS.Properties<string | number>;
  title?: string;
  lang?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  hidden?: boolean | 'until-found';
  inert?: boolean;
  slot?: string;
  tabindex?: number;
  draggable?: Booleanish;
  contenteditable?: Booleanish | 'plaintext-only';
  spellcheck?: Booleanish;
  translate?: 'yes' | 'no';
  inputmode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  enterkeyhint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
  accesskey?: string;
  autofocus?: boolean;
  popover?: 'auto' | 'manual' | 'hint' | '';
}

type HtmlBase<El> = CommonAttrs<El> & EventAttrs<El, HTMLElementEventMap>;

// ---- 各标签自己的属性 -----------------------------------------------------------------------

interface ButtonAttrs {
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  name?: string;
  value?: string;
  form?: string;
  formaction?: string;
  popovertarget?: string;
  popovertargetaction?: 'toggle' | 'show' | 'hide';
}

interface InputBase {
  name?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  placeholder?: string;
  autocomplete?: string;
  form?: string;
  list?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  minlength?: number;
  maxlength?: number;
  pattern?: string;
  multiple?: boolean;
  accept?: string;
  value?: string | number;
  checked?: boolean;
}
/** 按 type 分支：绑定值的类型随 type 变化，写错组合（type="text" 绑数字）能报错 */
type InputAttrs = InputBase &
  (
    | { type?: 'text' | 'search' | 'email' | 'password' | 'tel' | 'url'; _value?: string }
    | { type: 'number' | 'range'; _value?: number }
    | { type: 'date' | 'datetime-local' | 'month' | 'week' | 'time' | 'color'; _value?: string }
    | { type: 'checkbox'; _checked?: boolean | readonly (string | number)[] }
    | { type: 'radio'; _checked?: boolean }
    | { type: 'file'; _files?: FileList | null }
    | { type: 'button' | 'submit' | 'reset' | 'hidden' | 'image' }
  );

interface TextareaAttrs {
  name?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  cols?: number;
  wrap?: 'soft' | 'hard';
  minlength?: number;
  maxlength?: number;
  /** 双向绑定输入的值 */
  value?: string;
  _value?: string;
}

type SelectAttrs = {
  name?: string;
  disabled?: boolean;
  required?: boolean;
  size?: number;
} & ({ multiple?: false; value?: string | number; _value?: string | number } | { multiple: true; value?: readonly string[]; _value?: readonly string[] });

interface OptionAttrs {
  value?: string | number;
  disabled?: boolean;
  selected?: boolean;
  label?: string;
}
interface AnchorAttrs {
  href?: string;
  target?: '_self' | '_blank' | '_parent' | '_top' | (string & {});
  rel?: string;
  download?: boolean | string;
  hreflang?: string;
  type?: string;
}
interface ImgAttrs {
  src?: string;
  alt?: string;
  srcset?: string;
  sizes?: string;
  width?: number | string;
  height?: number | string;
  loading?: 'eager' | 'lazy';
  decoding?: 'sync' | 'async' | 'auto';
  crossorigin?: 'anonymous' | 'use-credentials' | '';
}
interface FormAttrs {
  action?: string;
  method?: 'get' | 'post' | 'dialog';
  novalidate?: boolean;
  enctype?: string;
  target?: string;
}
interface LabelAttrs {
  for?: string;
  form?: string;
}
interface DetailsAttrs {
  /** 双向绑定展开状态 */
  open?: boolean;
  _open?: boolean;
  name?: string;
}
interface DialogAttrs {
  /** 双向绑定打开状态 */
  open?: boolean;
  _open?: boolean;
}
interface ProgressAttrs {
  value?: number;
  max?: number;
}
interface FieldsetAttrs {
  disabled?: boolean;
  name?: string;
  form?: string;
}
interface TdAttrs {
  colspan?: number;
  rowspan?: number;
  headers?: string;
}

interface HtmlSpecific {
  button: ButtonAttrs;
  input: InputAttrs;
  textarea: TextareaAttrs;
  select: SelectAttrs;
  option: OptionAttrs;
  a: AnchorAttrs;
  img: ImgAttrs;
  form: FormAttrs;
  label: LabelAttrs;
  details: DetailsAttrs;
  dialog: DialogAttrs;
  progress: ProgressAttrs;
  fieldset: FieldsetAttrs;
  td: TdAttrs;
  th: TdAttrs;
}

// ---- SVG -------------------------------------------------------------------------------------

interface SvgPresentation {
  fill?: string;
  stroke?: string;
  'stroke-width'?: number | string;
  'stroke-linecap'?: 'butt' | 'round' | 'square';
  'stroke-linejoin'?: 'miter' | 'round' | 'bevel';
  'fill-rule'?: 'nonzero' | 'evenodd';
  opacity?: number | string;
  transform?: string;
  d?: string;
  cx?: number | string;
  cy?: number | string;
  r?: number | string;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  viewBox?: string;
  xmlns?: string;
  points?: string;
  'clip-path'?: string;
}
type SvgBase<El> = CommonAttrs<El> & EventAttrs<El, SVGElementEventMap> & SvgPresentation;

// ---- 汇总 ------------------------------------------------------------------------------------

/** 一个标签的全部属性。输入框这类按 type 分支的标签是联合类型 */
export type IntrinsicProps<Tag extends IntrinsicTag> = Tag extends HtmlTag
  ? HtmlBase<ElementOf<Tag>> & (Tag extends keyof HtmlSpecific ? HtmlSpecific[Tag] : {})
  : SvgBase<ElementOf<Tag>>;
