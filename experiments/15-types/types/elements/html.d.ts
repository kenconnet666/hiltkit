/**
 * HTML 元素各自的属性（自写子集，不引 @types/react 之类的属性表）。
 * 属性名用 HTML 的原名（小写：readonly、tabindex、maxlength），和 09-attr 的规则表一致。
 * 可双向绑定的属性（value、checked、open、files…）在原生元素上收 `Bound<T>`：`value={_bind(x)}`。
 */
import type { Bound, GroupBound, NumberBound } from '@hilt/runtime/core';
import type { BoolAttr } from './attributes';

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
  muted?: BoolAttr | Bound<boolean>;
  volume?: number | Bound<number>;
  currentTime?: number | Bound<number>;
  playbackRate?: number | Bound<number>;
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
  /** 展开状态；`open={_bind(x)}` 双向绑定 */
  open?: BoolAttr | Bound<boolean>;
  name?: string;
}
interface DialogAttrs {
  /** 打开状态；`open={_bind(x)}` 双向绑定 */
  open?: BoolAttr | Bound<boolean>;
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

interface InputCommon {
  name?: string;
  disabled?: BoolAttr;
  required?: BoolAttr;
  form?: string;
  autocomplete?: string;
  list?: string;
  indeterminate?: boolean | Bound<boolean>;
  formaction?: string;
  formnovalidate?: BoolAttr;
  formtarget?: Target;
  popovertarget?: string;
}
interface TextLike extends InputCommon {
  readonly?: BoolAttr;
  placeholder?: string;
  minlength?: number;
  maxlength?: number;
  pattern?: string;
  size?: number;
  dirname?: string;
}
/**
 * 按 type 分支：绑定值的类型随 type 变化，写错组合（type="text" 绑数字变量）能报错。
 * 文本框绑数字变量要写 `_bind.number(n)`；省略 type 当作文本。
 */
export type InputAttrs =
  | (TextLike & {
      type?: 'text' | 'search' | 'email' | 'password' | 'tel' | 'url';
      value?: string | number | Bound<string> | NumberBound;
      multiple?: BoolAttr;
    })
  | (TextLike & {
      type: 'number' | 'range';
      value?: string | number | Bound<number>;
      min?: number | string;
      max?: number | string;
      step?: number | string;
    })
  | (TextLike & {
      type: 'date' | 'datetime-local' | 'month' | 'week' | 'time' | 'color';
      value?: string | Bound<string>;
      min?: string;
      max?: string;
      step?: number | string;
    })
  | (InputCommon & {
      type: 'checkbox';
      /** 勾选状态；`_bind.group(list)` 把值收集到数组 */
      checked?: BoolAttr | Bound<boolean> | GroupBound;
      value?: string | number;
    })
  | (InputCommon & {
      type: 'radio';
      checked?: BoolAttr | Bound<boolean> | GroupBound;
      value?: string | number;
    })
  | (InputCommon & {
      type: 'file';
      files?: FileList | null | Bound<FileList | null>;
      accept?: string;
      multiple?: BoolAttr;
      webkitdirectory?: BoolAttr;
      capture?: boolean | 'user' | 'environment';
    })
  | (InputCommon & {
      type: 'button' | 'submit' | 'reset' | 'hidden';
      value?: string;
    })
  | (InputCommon & {
      type: 'image';
      src?: string;
      alt?: string;
      width?: Size;
      height?: Size;
    });

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
/** multiple 为真时绑定数组，否则绑定单个值 */
export type SelectAttrs = {
  name?: string;
  disabled?: BoolAttr;
  required?: BoolAttr;
  size?: number;
  form?: string;
  autocomplete?: string;
} & (
  | { multiple?: false; value?: string | number | Bound<string> | Bound<number> }
  | { multiple: true | ''; value?: readonly string[] | Bound<string[]> }
);
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
  /** 输入的值；`value={_bind(x)}` 双向绑定 */
  value?: string | Bound<string>;
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

/** 有专属属性的标签；没有列出的标签只有全局属性 */
export interface HtmlSpecific {
  a: AnchorAttrs;
  area: AreaAttrs;
  audio: AudioAttrs;
  base: BaseAttrs;
  blockquote: BlockquoteAttrs;
  button: ButtonAttrs;
  canvas: CanvasAttrs;
  col: ColAttrs;
  colgroup: ColAttrs;
  data: DataAttrs2;
  del: DelInsAttrs;
  details: DetailsAttrs;
  dialog: DialogAttrs;
  embed: EmbedAttrs;
  fieldset: FieldsetAttrs;
  form: FormAttrs;
  iframe: IframeAttrs;
  img: ImgAttrs;
  input: InputAttrs;
  ins: DelInsAttrs;
  label: LabelAttrs;
  li: LiAttrs;
  link: LinkAttrs;
  map: MapAttrs;
  meta: MetaAttrs;
  meter: MeterAttrs;
  object: ObjectAttrs;
  ol: OlAttrs;
  optgroup: OptgroupAttrs;
  option: OptionAttrs;
  output: OutputAttrs;
  progress: ProgressAttrs;
  q: QAttrs;
  script: ScriptAttrs;
  select: SelectAttrs;
  slot: SlotAttrs;
  source: SourceAttrs;
  style: StyleAttrs;
  td: CellAttrs;
  textarea: TextareaAttrs;
  th: ThAttrs;
  time: TimeAttrs;
  track: TrackAttrs;
  video: VideoAttrs;
}
