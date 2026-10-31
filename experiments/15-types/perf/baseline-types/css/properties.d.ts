/**
 * CSS 属性表：全量版，直接用 csstype（约 800 个属性，取值带关键字补全）。
 * 精简版（perf/variants/properties-lite.d.ts）同样导出这两个类型，成本对比见 results/15-types.txt；
 * 路径别名 `@hilt/css/properties` 指向哪个文件，就用哪张表。
 */
import type * as CSS from 'csstype';

/** sx / css.create 里的属性：数字补单位（px 或无单位，见 10-css/engine/units.ts），所以长度收字符串和数字 */
export type SxProperties = CSS.Properties<(string & {}) | number>;
/** style 属性里的对象：数字不补 px，长度只收字符串和 0 */
export type InlineProperties = CSS.Properties;
