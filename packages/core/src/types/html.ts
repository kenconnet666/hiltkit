/**
 * HTML 元素各自的属性（自写子集，不引 @types/react 之类的属性表）。
 * 属性名用 HTML 的原名（小写：readonly、tabindex、maxlength），和运行时 attrs/rules.ts 的规则表一致。
 * 下面的接口只写静态取值；HtmlSpecific 里统一用 Live<…> 派生出“值或读取函数”。
 * 能写回的只有 input 的 value、checked 和 textarea、select 的 value（运行时的 TWO_WAY）：传 Sig 双向，传值或只读函数单向。
 */
import type { Bindable, BoolAttr, Live } from './value';

type Referrer =
  | ''
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';
type CrossOrigin = '' | 'anonymous' | 'use-credentials';
type Target = '_self' | '_blank' | '_parent' | '_top' | (string & {});
type Size = number | string;

interface AnchorAttrs {
  href?: string;
  target?: Target;
  rel?: string;
  download?: boolean | string;
  hreflang?: string;
  type?: string;
  ping?: string;
  referrerpolicy?: Referrer;
}
interface AreaAttrs {
  alt?: string;
  coords?: string;
  shape?: 'rect' | 'circle' | 'poly' | 'default';
  href?: string;
  target?: Target;
  rel?: string;
  download?: boolean | string;
}
interface MediaAttrs {
  src?: string;
  controls?: BoolAttr;
  loop?: BoolAttr;
  autoplay?: BoolAttr;
  preload?: 'none' | 'metadata' | 'auto' | '';
  crossorigin?: CrossOrigin;
  muted?: boolean;
  volume?: number;
  currentTime?: number;
  playbackRate?: number;
  controlslist?: string;
  disableremoteplayback?: BoolAttr;
}
interface VideoAttrs extends MediaAttrs {
  width?: Size;
  height?: Size;
  poster?: string;
  playsinline?: BoolAttr;
  disablepictureinpicture?: BoolAttr;
}
interface AudioAttrs extends MediaAttrs {}
interface BaseAttrs {
  href?: string;
  target?: Target;
}
interface BlockquoteAttrs {
  cite?: string;
}
interface ButtonAttrs {
  type?: 'button' | 'submit' | 'reset';
  disabled?: BoolAttr;
  name?: string;
  value?: string;
  form?: string;
  formaction?: string;
  formenctype?: string;
  formmethod?: 'get' | 'post' | 'dialog';
  formnovalidate?: BoolAttr;
  formtarget?: Target;
  popovertarget?: string;
  popovertargetaction?: 'toggle' | 'show' | 'hide';
}
interface CanvasAttrs {
  width?: Size;
  height?: Size;
}
interface ColAttrs {
  span?: number;
}
interface DataAttrs2 {
  value?: string;
}
interface DelInsAttrs {
  cite?: string;
  datetime?: string;
}
interface DetailsAttrs {
  open?: BoolAttr;
  name?: string;
}
interface DialogAttrs {
  open?: BoolAttr;
}
interface EmbedAttrs {
  src?: string;
  type?: string;
  width?: Size;
  height?: Size;
}
interface FieldsetAttrs {
  disabled?: BoolAttr;
  name?: string;
  form?: string;
}
interface FormAttrs {
  action?: string;
  method?: 'get' | 'post' | 'dialog';
  novalidate?: BoolAttr;
  enctype?: string;
  target?: Target;
  autocomplete?: string;
  name?: string;
  'accept-charset'?: string;
}
interface IframeAttrs {
  src?: string;
  srcdoc?: string;
  name?: string;
  width?: Size;
  height?: Size;
  allow?: string;
  allowfullscreen?: BoolAttr;
  loading?: 'eager' | 'lazy';
  referrerpolicy?: Referrer;
  sandbox?: string;
}
interface ImgAttrs {
  src?: string;
  alt?: string;
  srcset?: string;
  sizes?: string;
  width?: Size;
  height?: Size;
  loading?: 'eager' | 'lazy';
  decoding?: 'sync' | 'async' | 'auto';
  crossorigin?: CrossOrigin;
  referrerpolicy?: Referrer;
  usemap?: string;
  ismap?: BoolAttr;
  fetchpriority?: 'high' | 'low' | 'auto';
}

type InputType =
  | 'text'
  | 'search'
  | 'email'
  | 'password'
  | 'tel'
  | 'url'
  | 'number'
  | 'range'
  | 'date'
  | 'datetime-local'
  | 'month'
  | 'week'
  | 'time'
  | 'color'
  | 'checkbox'
  | 'radio'
  | 'file'
  | 'button'
  | 'submit'
  | 'reset'
  | 'hidden'
  | 'image';
/**
 * input 的属性是一张表，不按 type 分支：type 常常是动态的，而且 merge({ type: 'checkbox' }) 里的字面量会被 TS 放宽成 string，
 * 按 type 分支的联合属性表、或只收 InputType 的 type，都会让这类写法报错。所以 type 额外收任意字符串（补全仍有 InputType），
 * min、max、accept 这类只对某些 type 有意义的属性也不按 type 检查。
 */
interface InputAttrs {
  type?: InputType | (string & {});
  name?: string;
  disabled?: BoolAttr;
  required?: BoolAttr;
  readonly?: BoolAttr;
  form?: string;
  autocomplete?: string;
  list?: string;
  indeterminate?: boolean;
  placeholder?: string;
  minlength?: number;
  maxlength?: number;
  pattern?: string;
  size?: number;
  dirname?: string;
  multiple?: BoolAttr;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  accept?: string;
  capture?: boolean | 'user' | 'environment';
  webkitdirectory?: BoolAttr;
  src?: string;
  alt?: string;
  width?: Size;
  height?: Size;
  formaction?: string;
  formnovalidate?: BoolAttr;
  formtarget?: Target;
  popovertarget?: string;
}
/** 文本类输入写回字符串，number、range 写回数字（空串时仍是字符串），所以收 Sig<string> 或 Sig<number> */
interface InputBinding {
  value?: Bindable<string | number | undefined, string | number>;
  checked?: Bindable<boolean | undefined, boolean>;
}

interface LabelAttrs {
  for?: string;
  form?: string;
}
interface LiAttrs {
  value?: number;
}
interface LinkAttrs {
  href?: string;
  rel?: string;
  as?: string;
  type?: string;
  media?: string;
  sizes?: string;
  crossorigin?: CrossOrigin;
  hreflang?: string;
  integrity?: string;
  referrerpolicy?: Referrer;
  fetchpriority?: 'high' | 'low' | 'auto';
}
interface MapAttrs {
  name?: string;
}
interface MetaAttrs {
  name?: string;
  content?: string;
  charset?: string;
  'http-equiv'?: string;
  property?: string;
}
interface MeterAttrs {
  value?: number;
  min?: number;
  max?: number;
  low?: number;
  high?: number;
  optimum?: number;
}
interface ObjectAttrs {
  data?: string;
  type?: string;
  name?: string;
  width?: Size;
  height?: Size;
  form?: string;
}
interface OlAttrs {
  reversed?: BoolAttr;
  start?: number;
  type?: '1' | 'a' | 'A' | 'i' | 'I';
}
interface OptgroupAttrs {
  disabled?: BoolAttr;
  label?: string;
}
interface OptionAttrs {
  value?: string | number;
  disabled?: BoolAttr;
  selected?: BoolAttr;
  label?: string;
}
interface OutputAttrs {
  for?: string;
  form?: string;
  name?: string;
}
interface ProgressAttrs {
  value?: number;
  max?: number;
}
interface QAttrs {
  cite?: string;
}
interface ScriptAttrs {
  src?: string;
  type?: string;
  async?: BoolAttr;
  defer?: BoolAttr;
  nomodule?: BoolAttr;
  crossorigin?: CrossOrigin;
  integrity?: string;
  referrerpolicy?: Referrer;
}
interface SelectAttrs {
  name?: string;
  disabled?: BoolAttr;
  required?: BoolAttr;
  multiple?: BoolAttr;
  size?: number;
  form?: string;
  autocomplete?: string;
}
interface SelectBinding {
  value?: Bindable<string | number | undefined, string>;
}
interface SlotAttrs {
  name?: string;
}
interface SourceAttrs {
  src?: string;
  srcset?: string;
  sizes?: string;
  type?: string;
  media?: string;
  width?: Size;
  height?: Size;
}
interface StyleAttrs {
  media?: string;
  type?: string;
}
interface CellAttrs {
  colspan?: number;
  rowspan?: number;
  headers?: string;
}
interface ThAttrs extends CellAttrs {
  scope?: 'row' | 'col' | 'rowgroup' | 'colgroup';
  abbr?: string;
}
interface TextareaAttrs {
  name?: string;
  disabled?: BoolAttr;
  readonly?: BoolAttr;
  required?: BoolAttr;
  placeholder?: string;
  rows?: number;
  cols?: number;
  wrap?: 'soft' | 'hard';
  minlength?: number;
  maxlength?: number;
  form?: string;
  autocomplete?: string;
}
interface TextareaBinding {
  value?: Bindable<string | undefined, string>;
}
interface TimeAttrs {
  datetime?: string;
}
interface TrackAttrs {
  src?: string;
  kind?: 'subtitles' | 'captions' | 'descriptions' | 'chapters' | 'metadata';
  srclang?: string;
  label?: string;
  default?: BoolAttr;
}

/** 有专属属性的标签；没有列出的标签只有全局属性。取值已经是“值或读取函数”（能写回的几个另算） */
export interface HtmlSpecific {
  a: Live<AnchorAttrs>;
  area: Live<AreaAttrs>;
  audio: Live<AudioAttrs>;
  base: Live<BaseAttrs>;
  blockquote: Live<BlockquoteAttrs>;
  button: Live<ButtonAttrs>;
  canvas: Live<CanvasAttrs>;
  col: Live<ColAttrs>;
  colgroup: Live<ColAttrs>;
  data: Live<DataAttrs2>;
  del: Live<DelInsAttrs>;
  details: Live<DetailsAttrs>;
  dialog: Live<DialogAttrs>;
  embed: Live<EmbedAttrs>;
  fieldset: Live<FieldsetAttrs>;
  form: Live<FormAttrs>;
  iframe: Live<IframeAttrs>;
  img: Live<ImgAttrs>;
  input: Live<InputAttrs> & InputBinding;
  ins: Live<DelInsAttrs>;
  label: Live<LabelAttrs>;
  li: Live<LiAttrs>;
  link: Live<LinkAttrs>;
  map: Live<MapAttrs>;
  meta: Live<MetaAttrs>;
  meter: Live<MeterAttrs>;
  object: Live<ObjectAttrs>;
  ol: Live<OlAttrs>;
  optgroup: Live<OptgroupAttrs>;
  option: Live<OptionAttrs>;
  output: Live<OutputAttrs>;
  progress: Live<ProgressAttrs>;
  q: Live<QAttrs>;
  script: Live<ScriptAttrs>;
  select: Live<SelectAttrs> & SelectBinding;
  slot: Live<SlotAttrs>;
  source: Live<SourceAttrs>;
  style: Live<StyleAttrs>;
  td: Live<CellAttrs>;
  textarea: Live<TextareaAttrs> & TextareaBinding;
  th: Live<ThAttrs>;
  time: Live<TimeAttrs>;
  track: Live<TrackAttrs>;
  video: Live<VideoAttrs>;
}
