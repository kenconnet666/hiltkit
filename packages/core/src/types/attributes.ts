// 所有元素共有的属性：sx / ref / children、class / style、ARIA、data-*，以及 React 拼写的提示。
// 属性表里写静态取值；“值或读取函数”统一由 Live<…> 派生（见 value.ts）。
//   - 布尔属性（disabled、hidden…）：BoolAttr = boolean | ''
//   - 枚举型的“像布尔”属性（aria-*、draggable、spellcheck、contenteditable）：Booleanish，false 写成字符串 "false"
//   - 其他属性（id、title、href…）：不收 false。`id={cond && 'x'}` 的 false 会被拦下，要写 `cond ? 'x' : undefined`
import type { ReadSig } from '../index';
import type { InlineProperties, SxStyles } from './css';
import type { Attr, BoolAttr, Booleanish, Child, Live, Ref, WriteAs } from './value';

/**
 * class 的取值（clsx 的规则）：字符串、数组（可嵌套）、对象（值为真的键）、返回这些的函数。
 * 假值（false、null、undefined）不出力，所以 `cond && 'a'` 可以直接写。
 */
export type ClassValue =
  string | boolean | null | undefined | ClassFn | ClassList | { readonly [name: string]: unknown };
interface ClassFn {
  (): ClassValue;
}
interface ClassList extends ReadonlyArray<ClassValue> {}

/**
 * style 的对象写法：csstype 的属性，字段值可以是读取函数；数字不补 px（长度只收字符串和 0，opacity、zIndex 这类无单位的属性收数字），
 * 加上自定义属性 `--x`。
 */
export type InlineStyle = Live<InlineProperties> & {
  readonly [name: `--${string}`]: Attr<string | number | undefined>;
};
/** style 的取值：字符串、对象，或返回它们的函数 */
export type StyleAttr = string | InlineStyle | ReadSig<string | InlineStyle | undefined>;

/** data-*：JSX 对不在类型里的连字符属性不检查，这里用模式索引签名登记取值（false 合法，写出 "false"） */
export interface DataAttrs {
  [name: `data-${string}`]: Attr<string | number | boolean | null | undefined>;
}

interface AriaStatic {
  role?: AriaRole | (string & {});
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

type AriaRole =
  | 'alert'
  | 'alertdialog'
  | 'application'
  | 'article'
  | 'banner'
  | 'button'
  | 'cell'
  | 'checkbox'
  | 'columnheader'
  | 'combobox'
  | 'complementary'
  | 'contentinfo'
  | 'dialog'
  | 'directory'
  | 'document'
  | 'feed'
  | 'figure'
  | 'form'
  | 'grid'
  | 'gridcell'
  | 'group'
  | 'heading'
  | 'img'
  | 'link'
  | 'list'
  | 'listbox'
  | 'listitem'
  | 'log'
  | 'main'
  | 'marquee'
  | 'math'
  | 'menu'
  | 'menubar'
  | 'menuitem'
  | 'menuitemcheckbox'
  | 'menuitemradio'
  | 'navigation'
  | 'none'
  | 'note'
  | 'option'
  | 'presentation'
  | 'progressbar'
  | 'radio'
  | 'radiogroup'
  | 'region'
  | 'row'
  | 'rowgroup'
  | 'rowheader'
  | 'scrollbar'
  | 'search'
  | 'searchbox'
  | 'separator'
  | 'slider'
  | 'spinbutton'
  | 'status'
  | 'switch'
  | 'tab'
  | 'table'
  | 'tablist'
  | 'tabpanel'
  | 'term'
  | 'textbox'
  | 'timer'
  | 'toolbar'
  | 'tooltip'
  | 'tree'
  | 'treegrid'
  | 'treeitem';

/** HTML 与 SVG 都有的全局属性 */
interface GlobalStatic {
  id?: string;
  tabindex?: number | string;
  slot?: string;
  part?: string;
  lang?: string;
}

/** HTML 元素共有的全局属性 */
interface HtmlGlobalStatic {
  title?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  hidden?: BoolAttr | 'until-found';
  inert?: BoolAttr;
  autofocus?: BoolAttr;
  popover?: BoolAttr | 'auto' | 'manual' | 'hint';
  draggable?: Booleanish;
  spellcheck?: Booleanish;
  contenteditable?: Booleanish | 'plaintext-only';
  translate?: boolean | 'yes' | 'no';
  inputmode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  enterkeyhint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
  accesskey?: string;
  autocapitalize?: 'off' | 'none' | 'on' | 'sentences' | 'words' | 'characters';
  nonce?: string;
  is?: string;
  itemscope?: BoolAttr;
  itemprop?: string;
  itemtype?: string;
  itemid?: string;
  exportparts?: string;
  /** 只写不读的内容属性：服务端、客户端都按 HTML 字符串写入，不转义 */
  innerHTML?: string;
}

/** 全局属性（读取函数版）：整张表只展开一次，每个元素共用 */
export type AriaAttrs = Live<AriaStatic>;
export type GlobalAttrs = Live<GlobalStatic>;
export type HtmlGlobalAttrs = Live<HtmlGlobalStatic>;

/**
 * React 拼写：这些属性在本框架里不存在，类型换成 WriteAs<'正确写法'>，报错信息和悬停都会指向正确的名字。
 * 键与运行时 attrs/rules.ts 的 ALIAS 表一一对应（scripts/gen-attr-cases 会校验），再加上常见的驼峰误写。
 */
export interface ReactSpellings {
  /** @deprecated 请写成 class */ className?: WriteAs<'class'>;
  /** @deprecated 请写成 for */ htmlFor?: WriteAs<'for'>;
  /** @deprecated 请写成 accept-charset */ acceptCharset?: WriteAs<'accept-charset'>;
  /** @deprecated 请写成 http-equiv */ httpEquiv?: WriteAs<'http-equiv'>;
  /** @deprecated 请写成 readonly */ readOnly?: WriteAs<'readonly'>;
  /** @deprecated 请写成 novalidate */ noValidate?: WriteAs<'novalidate'>;
  /** @deprecated 请写成 formnovalidate */ formNoValidate?: WriteAs<'formnovalidate'>;
  /** @deprecated 请写成 autofocus */ autoFocus?: WriteAs<'autofocus'>;
  /** @deprecated 请写成 autoplay */ autoPlay?: WriteAs<'autoplay'>;
  /** @deprecated 请写成 playsinline */ playsInline?: WriteAs<'playsinline'>;
  /** @deprecated 请写成 allowfullscreen */ allowFullScreen?: WriteAs<'allowfullscreen'>;
  /** @deprecated 请写成 ismap */ isMap?: WriteAs<'ismap'>;
  /** @deprecated 请写成 nomodule */ noModule?: WriteAs<'nomodule'>;
  /** @deprecated 请写成 tabindex */ tabIndex?: WriteAs<'tabindex'>;
  /** @deprecated 请写成 contenteditable */ contentEditable?: WriteAs<'contenteditable'>;
  /** @deprecated 请写成 spellcheck */ spellCheck?: WriteAs<'spellcheck'>;
  /** @deprecated 请写成 accesskey */ accessKey?: WriteAs<'accesskey'>;
  /** @deprecated 请写成 inputmode */ inputMode?: WriteAs<'inputmode'>;
  /** @deprecated 请写成 enterkeyhint */ enterKeyHint?: WriteAs<'enterkeyhint'>;
  /** @deprecated 请写成 crossorigin */ crossOrigin?: WriteAs<'crossorigin'>;
  /** @deprecated 请写成 maxlength */ maxLength?: WriteAs<'maxlength'>;
  /** @deprecated 请写成 minlength */ minLength?: WriteAs<'minlength'>;
  /** @deprecated 请写成 colspan */ colSpan?: WriteAs<'colspan'>;
  /** @deprecated 请写成 rowspan */ rowSpan?: WriteAs<'rowspan'>;
  /** @deprecated 请写成 srcset */ srcSet?: WriteAs<'srcset'>;
  /** @deprecated 请写成 autocomplete */ autoComplete?: WriteAs<'autocomplete'>;
  /** @deprecated 请写成 charset */ charSet?: WriteAs<'charset'>;
  /** @deprecated 初始值直接写 value；要受控传 Sig */ defaultValue?: WriteAs<'value'>;
  /** @deprecated 请写成 checked */ defaultChecked?: WriteAs<'checked'>;
  /** @deprecated 请写成 onDblClick */ onDoubleClick?: WriteAs<'onDblClick'>;
}

/** 所有元素共有、与具体元素类型有关的部分：sx、ref、children、class、style */
export interface CoreAttrs<El> {
  /** 样式：样式组、动态样式、假值、对象字面量、返回它们的函数，或它们的嵌套数组 */
  sx?: SxStyles;
  /** Sig 或回调：元素挂载时收到元素，卸载时收到 null */
  ref?: Ref<El>;
  children?: Child;
  /** 列表项的身份。标准 JSX 的 key 不进 props；原生元素的属性表要自己声明它（IntrinsicAttributes 只管组件） */
  key?: string | number | symbol;
  class?: ClassValue;
  style?: StyleAttr;
}
