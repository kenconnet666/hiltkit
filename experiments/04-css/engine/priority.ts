/**
 * 组合类里声明与条件块的排序依据（declarations.ts 的 serialize）：沿用 StyleX 的 getPriority（@stylexjs/shared 0.19.1），
 * 省掉了逻辑长属性那张 318 项的表——它们的优先级就是默认的 3000，查表与不查表结果一样。
 *
 * 规则：简写的简写 1000 < 简写 2000 < 长属性 3000 < 物理长属性 4000（后注入的压过先注入的）；
 * 条件加在属性上：@supports 30、@media 200、@container 300，伪类按表（:hover 130、:active 170…），伪元素 5000。
 */

const SHORTHANDS_OF_SHORTHANDS = new Set(
  'animation background border border-block border-inline margin padding font grid grid-template grid-area all inset scroll-margin scroll-padding'.split(
    ' ',
  ),
);

const SHORTHANDS_OF_LONGHANDS = new Set(
  'animation-range scroll-timeline view-timeline background-position border-color border-style border-width border-block-start border-top border-block-end border-bottom border-inline-color border-inline-style border-inline-width border-inline-start border-left border-inline-end border-right border-image border-radius corner-shape caret outline grid-gap gap place-content place-items place-self margin-block margin-inline overscroll-behavior padding-block padding-inline columns column-rule contain-intrinsic-size container flex flex-flow font-variant grid-template-areas grid-row grid-column list-style mask mask-border offset overflow inset-block inset-inline scroll-margin-block scroll-margin-inline scroll-padding-block scroll-padding-inline scroll-snap-type text-decoration text-emphasis transition'.split(
    ' ',
  ),
);

const LONGHANDS_PHYSICAL = new Set(
  'border-top-color border-top-style border-top-width border-bottom-color border-bottom-style border-bottom-width border-left-color border-left-style border-left-width border-right-color border-right-style border-right-width border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius corner-top-left-shape corner-top-right-shape corner-bottom-left-shape corner-bottom-right-shape height width max-height max-width min-height min-width margin-top margin-bottom margin-left margin-right overscroll-behavior-y overscroll-behavior-x padding-top padding-bottom padding-left padding-right overflow-y overflow-x top bottom left right scroll-margin-top scroll-margin-bottom scroll-margin-left scroll-margin-right scroll-padding-top scroll-padding-bottom scroll-padding-left scroll-padding-right'.split(
    ' ',
  ),
);

/** 伪类的优先级（不在表里的 40）；:focusWithin、:focusVisible 的驼峰写法照抄 StyleX */
const PSEUDO_CLASSES: Readonly<Record<string, number>> = {
  ':is': 40,
  ':where': 40,
  ':not': 40,
  ':has': 45,
  ':dir': 50,
  ':lang': 51,
  ':first-child': 52,
  ':first-of-type': 53,
  ':last-child': 54,
  ':last-of-type': 55,
  ':only-child': 56,
  ':only-of-type': 57,
  ':nth-child': 60,
  ':nth-last-child': 61,
  ':nth-of-type': 62,
  ':nth-last-of-type': 63,
  ':empty': 70,
  ':link': 80,
  ':any-link': 81,
  ':local-link': 82,
  ':target-within': 83,
  ':target': 84,
  ':visited': 85,
  ':enabled': 91,
  ':disabled': 92,
  ':required': 93,
  ':optional': 94,
  ':read-only': 95,
  ':read-write': 96,
  ':placeholder-shown': 97,
  ':in-range': 98,
  ':out-of-range': 99,
  ':default': 100,
  ':checked': 101,
  ':indeterminate': 101,
  ':blank': 102,
  ':valid': 103,
  ':invalid': 104,
  ':user-invalid': 105,
  ':autofill': 110,
  ':picture-in-picture': 120,
  ':modal': 121,
  ':fullscreen': 122,
  ':paused': 123,
  ':playing': 124,
  ':current': 125,
  ':past': 126,
  ':future': 127,
  ':hover': 130,
  ':focusWithin': 140,
  ':focus': 150,
  ':focusVisible': 160,
  ':active': 170,
};

const PSEUDO_ELEMENT = 5000;

/** when.* 生成的关系选择器：基数 + 被观察元素那个伪类的优先级 / 100 */
const RELATIONAL: readonly [RegExp, number][] = [
  [/^:where\(\.[0-9a-zA-Z_-]+(:[a-zA-Z-]+)\s+\*\)$/, 10],
  [/^:where\(:has\(\.[0-9a-zA-Z_-]+(:[a-zA-Z-]+)\)\)$/, 15],
  [/^:where\(\.[0-9a-zA-Z_-]+(:[a-zA-Z-]+)\s+~\s+\*\)$/, 30],
  [/^:where\(:has\(~\s\.[0-9a-zA-Z_-]+(:[a-zA-Z-]+)\)\)$/, 40],
];
const ANY_SIBLING =
  /^:where\(\.[0-9a-zA-Z_-]+(:[a-zA-Z-]+)\s+~\s+\*,\s+:has\(~\s\.[0-9a-zA-Z_-]+(:[a-zA-Z-]+)\)\)$/;
const PSEUDO_PART = /::[a-zA-Z-]+|:[a-zA-Z-]+(?:\([^)]*\))?/g;

const pseudoClass = (name: string) => PSEUDO_CLASSES[name] ?? 40;

/** 属性名（连字符）、伪类、伪元素或 @ 规则的优先级 */
export function getPriority(key: string): number {
  if (key.startsWith('--')) return 1;
  if (key.startsWith('@supports')) return 30;
  if (key.startsWith('@media')) return 200;
  if (key.startsWith('@container')) return 300;
  // 连写的几个伪类 / 伪元素（:hover::before）：各自相加；带括号的不拆
  const parts = key.match(PSEUDO_PART);
  if (parts && parts.length > 1 && !parts.some((part) => part.includes('('))) {
    return parts.reduce(
      (sum, part) => sum + (part.startsWith('::') ? PSEUDO_ELEMENT : pseudoClass(part)),
      0,
    );
  }
  if (key.startsWith('::')) return PSEUDO_ELEMENT;
  if (key.startsWith(':')) {
    for (const [pattern, base] of RELATIONAL) {
      const match = pattern.exec(key);
      if (match) return base + pseudoClass(match[1]!) / 100;
    }
    const sibling = ANY_SIBLING.exec(key);
    if (sibling) return 20 + Math.max(pseudoClass(sibling[1]!), pseudoClass(sibling[2]!)) / 100;
    return pseudoClass(key.split('(')[0]!);
  }
  if (SHORTHANDS_OF_SHORTHANDS.has(key)) return 1000;
  if (SHORTHANDS_OF_LONGHANDS.has(key)) return 2000;
  if (LONGHANDS_PHYSICAL.has(key)) return 4000;
  return 3000;
}
