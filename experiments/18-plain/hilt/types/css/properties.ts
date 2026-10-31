/**
 * CSS 属性表：全量版，直接用 csstype（约 800 个属性，取值带关键字补全）。
 * 15-types 量过精简版（约 190 个属性）：N=1000 检查快 10%，但关键字补全大幅减少，所以沿用全量。
 * csstype 在 tsconfig 的 paths 里指到 13-ts/node_modules（实验目录里没有顶层的 node_modules/csstype）。
 */
import type * as CSS from 'csstype';

/** sx / css.create 里的属性：数字补单位（px 或无单位，见 10-css/engine/units.ts），所以长度收字符串和数字 */
export type SxProperties = CSS.Properties<(string & {}) | number>;
/** style 属性里的对象：数字不补 px，长度只收字符串和 0 */
export type InlineProperties = CSS.Properties;
