/**
 * 运行时样式引擎的内部入口（对外的是 `index.ts`）：写法同 StyleX，实现同 Emotion / Griffel：一个元素一次 sx 合成一个类，
 * 规则在第一次用到时插入；状态变化只改该改的那一处。
 *
 *   用户写的：create、recipe、keyframes、defineTokens、defineVars、createTheme、themeStyle、defineMarker、when、
 *            configure、renderStyleTag、themeBootScript
 *   元素上写的：`<div sx={[styles.root, active && styles.active, styles.bar(width), { marginTop: '_md' }]} />`
 *   sx 里的函数由 `index.ts` 换成 select；运行时经 register.ts 拿到引擎。
 *
 * 模块分工：declarations（样式对象 → 声明表 → 规则文本）、sheet（样式表、SSR）、fragment（片段与组合类）、
 * compose（一个元素的样式 → 类，带缓存）、resolve（sx 一项的取值 → 片段）、dynamic（动态样式与 select）、
 * bindings（元素上的响应式绑定）、attrs（一个元素的 sx → 类与变量）、create、recipe、vars（变量组、主题、标记）、
 * tokens（token 短写）、config。
 */
export { stats } from './bindings';
export { configure } from './config';
export { CONDITIONS, defineConditions } from './declarations';
export { create, keyframes } from './create';
export { recipe } from './recipe';
export type { PartProps, Recipe, RecipeConfig, RecipeExtension } from './recipe';
export { renderStyleTag } from './sheet';
export { provideStyles, useRecipe } from './styles-context';
export {
  createTheme,
  defineMarker,
  defineTokens,
  defineVars,
  themeBootClasses,
  themeBootScript,
  themeStyle,
  when,
} from './vars';
