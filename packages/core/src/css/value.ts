/**
 * 条件别名：状态跟着 DOM 上的 aria / data 属性走，一个别名合并原生、ARIA、data 几种写法。
 * 键上的注释在悬停时显示；对应的选择器见 declarations.ts 的 CONDITIONS
 */
export interface ConditionAliases {
  /** 悬停：`:hover` */
  _hover: unknown;
  /** 按下：`:active` */
  _active: unknown;
  /** 获得焦点：`:focus` */
  _focus: unknown;
  /** 键盘聚焦（焦点环）：`:focus-visible` */
  _focusVisible: unknown;
  /** 自己或里面有焦点：`:focus-within` */
  _focusWithin: unknown;
  /** 不可用：`:disabled`、`aria-disabled="true"`、`data-disabled` */
  _disabled: unknown;
  /** 选中：`aria-selected="true"`、`data-selected` */
  _selected: unknown;
  /** 勾选：`:checked`、`aria-checked="true"`、`data-state="checked"` */
  _checked: unknown;
  /** 半选：`:indeterminate`、`aria-checked="mixed"`、`data-state="indeterminate"` */
  _indeterminate: unknown;
  /** 按下的开关按钮：`aria-pressed="true"`、`data-pressed` */
  _pressed: unknown;
  /** 展开：`aria-expanded="true"`、`data-expanded` */
  _expanded: unknown;
  /** 打开：`[open]`（details、dialog）、`data-state="open"` */
  _open: unknown;
  /** 当前项：`aria-current`（不是 false）、`data-current` */
  _current: unknown;
  /** 校验不通过：`aria-invalid="true"`、`data-invalid` */
  _invalid: unknown;
  /** 只读：`aria-readonly="true"`、`data-readonly` */
  _readonly: unknown;
  /** 键盘高亮的选项（列表框、菜单）：`data-highlighted` */
  _highlighted: unknown;
  /** 拖动中：`data-dragging` */
  _dragging: unknown;
  /** 占位文字：`::placeholder` */
  _placeholder: unknown;
  /** 高对比模式：`@media (forced-colors: active)` */
  _forcedColors: unknown;
  /** 减少动态效果：`@media (prefers-reduced-motion: reduce)` */
  _reducedMotion: unknown;
  /** 从右到左排版：`:dir(rtl)` */
  _rtl: unknown;
}

/**
 * 条件键：伪类（':hover'、css.when.* 生成的键）、@ 规则（'@media (…)'、'@supports (…)'、'@container (…)'）、
 * 属性选择器（'[data-hot]'、'[data-state="open"]'：状态写在 DOM 属性上，变化时只改属性）；条件别名（_selected…）另见 ConditionAliases
 */
type Condition = `:${string}` | `@${string}` | `[${string}]`;

/**
 * 一个 CSS 属性的取值，同 StyleX：
 *   - 普通值：`padding: 8`
 *   - 按条件取值，必须有 default：`color: { default: 'black', ':hover': 'blue' }`，条件可以嵌套
 *   - 回退值数组：`display: ['grid', 'flex']`（浏览器用第一个支持的）
 */
export type StyleValue<V> = V | ReadonlyArray<V> | ConditionalValue<V>;

/** 条件别名作键：映射自 ConditionAliases，悬停别名时显示它的说明 */
type AliasValues<V> = { readonly [Alias in keyof ConditionAliases]?: StyleValue<V> };

/** 按条件取值：`{ default: '_text', _selected: '_accentText', ':hover': '…' }` */
export interface ConditionalValue<V> extends AliasValues<V> {
  /** 不满足任何条件时的值 */
  readonly default: StyleValue<V>;
  /** 伪类、@ 规则、属性选择器条件下的值 */
  readonly [condition: Condition]: StyleValue<V>;
}

/**
 * 只接受固定几个关键字的属性（StyleX 的取值类型 V 是字面量联合）：接受的值与 V 完全相同，
 * K 的每个键是 V 里的一个关键字，键上的注释在悬停取值时显示（WebStorm 把字符串字面量解析到 keyof 的键上）
 */
export type KeywordValue<K, V> = keyof K | Exclude<V, keyof K>;

/**
 * 接受任意字符串的属性：V 里 string 以外的部分（数字、null）加上 OpenString。
 * 生成的类型再并上各段语法的关键字与主题 token（`keyof LineStyleKeywords`），补全与悬停说明都来自那些键
 */
export type OpenValue<V> = Exclude<V, string> | OpenString;

/**
 * 接受任意字符串、但不吸收同一联合里的字面量。不能直接写 `string & {}`：
 * 在泛型实例化里 TypeScript 会把它化简成 string（实测 6.0），关键字就丢了；具名别名不会被化简。
 */
type OpenString = string & Record<never, never>;
