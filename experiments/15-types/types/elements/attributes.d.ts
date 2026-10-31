/**
 * 所有元素共有的属性：sx / ref / key / children、class / style、ARIA、data-*，以及 React 拼写的提示。
 *
 * 取值约定（和 09-attr/shared.js 的规则表一致）：
 *   - 布尔属性（disabled、hidden…）：BoolAttr = boolean | ''，`disabled=""` 为真，`"false"` 不是合法值（字符串形式一律为真，容易写错）
 *   - 枚举型的“像布尔”属性（aria-*、draggable、spellcheck、contenteditable）：Booleanish，false 写成字符串 "false"
 *   - 其他属性（id、title、href…）：不收 false。`id={cond && 'x'}` 的 false 会被拦下，要写 `cond ? 'x' : undefined`
 */
import type { Children, Ref, WriteAs } from '@hilt/runtime/core';
import type { InlineProperties, SxStyles } from '@hilt/css';

/** 布尔属性：true 写出空属性，false 移除；空字符串等价 true */
export type BoolAttr = boolean | '';
/** 枚举型属性里的“真/假”：false 写成字符串 "false"（aria-*、draggable 需要） */
export type Booleanish = boolean | 'true' | 'false';

/**
 * class 的取值（clsx 的规则）：字符串、数组（可嵌套）、对象（值为真的键）。
 * 假值（false、null、undefined）不出力，所以 `cond && 'a'` 可以直接写。
 */
export type ClassValue =
  | string
  | boolean
  | null
  | undefined
  | readonly ClassValue[]
  | { readonly [name: string]: unknown };

/**
 * style 的对象写法：csstype 的属性，数字不补 px（长度只收字符串和 0，opacity、zIndex 这类无单位的属性收数字），
 * 加上自定义属性 `--x`。
 */
export type InlineStyle = InlineProperties & { readonly [name: `--${string}`]: string | number | undefined };

/** data-*：JSX 对不在类型里的连字符属性不检查，这里用模式索引签名登记取值（false 写成 "false"） */
export interface DataAttrs {
  [name: `data-${string}`]: string | number | boolean | null | undefined;
}

export interface AriaAttrs {
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
  | 'alert' | 'alertdialog' | 'application' | 'article' | 'banner' | 'button' | 'cell' | 'checkbox'
  | 'columnheader' | 'combobox' | 'complementary' | 'contentinfo' | 'dialog' | 'directory' | 'document'
  | 'feed' | 'figure' | 'form' | 'grid' | 'gridcell' | 'group' | 'heading' | 'img' | 'link' | 'list'
  | 'listbox' | 'listitem' | 'log' | 'main' | 'marquee' | 'math' | 'menu' | 'menubar' | 'menuitem'
  | 'menuitemcheckbox' | 'menuitemradio' | 'navigation' | 'none' | 'note' | 'option' | 'presentation'
  | 'progressbar' | 'radio' | 'radiogroup' | 'region' | 'row' | 'rowgroup' | 'rowheader' | 'scrollbar'
  | 'search' | 'searchbox' | 'separator' | 'slider' | 'spinbutton' | 'status' | 'switch' | 'tab'
  | 'table' | 'tablist' | 'tabpanel' | 'term' | 'textbox' | 'timer' | 'toolbar' | 'tooltip' | 'tree'
  | 'treegrid' | 'treeitem';

/**
 * React 拼写：这些属性在本框架里不存在，类型换成 WriteAs<'正确写法'>，报错信息和悬停都会指向正确的名字。
 * 键与 09-attr/shared.js 的 ALIAS 表一一对应（scripts/gen-attr-cases.mjs 会校验），再加上常见的驼峰误写。
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
  /** @deprecated 请写成 value（初始值直接写 value，需要受控请用 _bind） */ defaultValue?: WriteAs<'value'>;
  /** @deprecated 请写成 checked */ defaultChecked?: WriteAs<'checked'>;
  /** @deprecated 请写成 onDblClick */ onDoubleClick?: WriteAs<'onDblClick'>;
}

/** 所有元素共有：sx、ref、key、children，加上全局属性（HTML 与 SVG 都有的那部分） */
export interface CommonAttrs<El> extends AriaAttrs, DataAttrs, ReactSpellings {
  /** 样式：样式组、动态样式、假值、对象字面量或它们的嵌套数组 */
  sx?: SxStyles;
  /** 列表项的身份（list.map 里写 key={item.id}）。类型层不区分位置：只在列表行有意义由编译器诊断 */
  key?: string | number | symbol;
  /** 回调：元素挂载时收到元素，卸载时收到 null */
  ref?: Ref<El>;
  children?: Children;
  id?: string;
  class?: ClassValue;
  style?: string | InlineStyle;
  tabindex?: number;
  slot?: string;
  part?: string;
  lang?: string;
}

/** HTML 元素共有的全局属性 */
export interface HtmlGlobalAttrs {
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
}

