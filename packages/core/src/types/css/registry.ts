/**
 * 登记处：应用把自己的 tokens 和条件别名登记进来，样式里的 '_md'、_loading 才有补全和校验。
 * 登记是声明合并，写在定义它们的那个文件里，类型直接取自 defineTokens / defineConditions 的返回值：
 *
 *   export const t = defineTokens('vtp', { colors: { text: '#1c2024' }, space: { md: '8px' } });
 *   declare module 'hiltkit/css' { interface TokenSets { vtp: typeof t } }
 *
 *   export const conditions = defineConditions({ _loading: '[data-loading]', _md: '@media (min-width: 700px)' });
 *   declare module 'hiltkit/css' { interface ConditionSets { app: typeof conditions } }
 *
 * 属性名（vtp、app）只是登记用的键：不同的库各登记各的，互不覆盖，类型层把它们合起来。
 */

/** tokens 的登记处：键是任意名字（通常和 defineTokens 的前缀相同），值是 defineTokens 的返回类型 */
export interface TokenSets {}
/** 自定义条件别名的登记处：值是 defineConditions 的返回类型 */
export interface ConditionSets {}

/** 内置的条件别名：作键写 `{ default: '_text', _selected: '_accent', ':hover': … }`；悬停时显示这里的说明 */
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
