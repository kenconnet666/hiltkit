/**
 * 样式里数字值的单位规则（与 StyleX 相同）：样式引擎（declarations.ts 的 cssValue）与 CSS 注释生成（scripts/css-docs）共用。
 * 不依赖别的模块：生成脚本直接用 Node 读这个 .ts 文件
 */

/** 数字值不补单位的属性（其余补 px） */
export const UNITLESS = new Set(
  'WebkitLineClamp animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth counterSet counterReset columnCount flex flexGrow flexShrink flexOrder gridRow gridRowStart gridRowEnd gridColumn gridColumnStart gridColumnEnd gridArea fontWeight hyphenateLimitChars lineClamp lineHeight maskBorderOutset maskBorderSlice maskBorderWidth opacity order orphans tabSize widows zIndex fillOpacity floodOpacity rotate scale shapeImageThreshold stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth mathDepth zoom'.split(
    ' ',
  ),
);
/** 数字值补 ms 的属性 */
export const MILLISECONDS = new Set([
  'animationDelay',
  'animationDuration',
  'transitionDelay',
  'transitionDuration',
  'voiceDuration',
]);
