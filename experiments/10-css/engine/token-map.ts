/**
 * 主题 tokens 字符串写法的对照表：属性 → token 组（参考 Stitches 的 themeMap）。
 *
 * 表里的属性可以写短写 `fontSize: '_xs'`（= fontSizes.xs）；其他属性、或要跨组取值时写带组名的 `'_space.md'`。
 * 组名沿用 Stitches / styled-system 的约定，主题库按这些名字导出 defineVars。
 * 用到它的地方：运行时展开声明时把短写换成 token 变量（tokens.ts），scripts/css-docs 给这些属性生成短写的取值类型。
 */

const sides = (prefix: string, suffix = '') =>
  [
    '',
    'Top',
    'Right',
    'Bottom',
    'Left',
    'Block',
    'BlockStart',
    'BlockEnd',
    'Inline',
    'InlineStart',
    'InlineEnd',
  ].map((side) => `${prefix}${side}${suffix}`);

const groups = {
  space: [
    'gap',
    'rowGap',
    'columnGap',
    ...sides('padding'),
    ...sides('margin'),
    ...sides('scrollMargin'),
    ...sides('scrollPadding'),
    'inset',
    'insetBlock',
    'insetBlockStart',
    'insetBlockEnd',
    'insetInline',
    'insetInlineStart',
    'insetInlineEnd',
    'top',
    'right',
    'bottom',
    'left',
  ],
  colors: [
    'color',
    'backgroundColor',
    ...sides('border', 'Color'),
    'outlineColor',
    'columnRuleColor',
    'textDecorationColor',
    'textEmphasisColor',
    'caretColor',
    'accentColor',
    'fill',
    'stroke',
    'WebkitTextFillColor',
    'WebkitTextStrokeColor',
  ],
  fonts: ['fontFamily'],
  fontSizes: ['fontSize'],
  fontWeights: ['fontWeight'],
  lineHeights: ['lineHeight'],
  letterSpacings: ['letterSpacing'],
  sizes: [
    'width',
    'height',
    'minWidth',
    'minHeight',
    'maxWidth',
    'maxHeight',
    'inlineSize',
    'blockSize',
    'minInlineSize',
    'minBlockSize',
    'maxInlineSize',
    'maxBlockSize',
    'flexBasis',
  ],
  borderWidths: [
    ...sides('border', 'Width'),
    'outlineWidth',
    'outlineOffset',
    'columnRuleWidth',
    'textDecorationThickness',
  ],
  opacities: ['opacity'],
  strokeWidths: ['strokeWidth'],
  radii: [
    'borderRadius',
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomLeftRadius',
    'borderBottomRightRadius',
    'borderStartStartRadius',
    'borderStartEndRadius',
    'borderEndStartRadius',
    'borderEndEndRadius',
  ],
  shadows: ['boxShadow'],
  durations: ['transitionDuration', 'transitionDelay', 'animationDuration', 'animationDelay'],
  easings: ['transitionTimingFunction', 'animationTimingFunction'],
};

/** 有短写的 token 组 */
export type TokenGroup = keyof typeof groups;

/** CSS 属性（StyleX 的写法，如 backgroundColor）→ 短写取值的 token 组 */
export const TOKEN_GROUP_OF: ReadonlyMap<string, TokenGroup> = new Map(
  Object.entries(groups).flatMap(([group, properties]) =>
    properties.map((property) => [property, group as TokenGroup]),
  ),
);
