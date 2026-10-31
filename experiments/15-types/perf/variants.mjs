// 成本对比用的类型变体：每个变体 = 在 tsconfig 的 paths 里把某个模块换成另一份文件。
// 变体文件由真实源码做文本替换生成（保证跟着真实类型走），替换没命中就报错，不会悄悄变成同一份。
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');

/** 变体名 → paths 覆盖（值以 variant: 开头表示 out/variants/ 下生成的文件，否则是相对 15-types 的路径） */
export const VARIANTS = {
  base: {},
  // 优化前的完整类型层快照（perf/baseline-types，未做任何成本优化），用来量“优化前后”
  'v0-baseline': { tree: 'perf/baseline-types' },
  // 第一步优化后的快照：事件后缀 16 种排列 → 4 个精确键 + 12 个模式索引签名
  'v1-events4': { tree: 'perf/step1-types' },
  // CSS 属性表：csstype 全量 vs 精简
  'lite-props': { paths: { '@hilt/css/properties': 'variant:properties-lite.d.ts' } },
  // token 补全：模板字面量联合 vs 普通联合
  'plain-tokens': { paths: { '@hilt/css/token-types': 'variant:token-types-plain.d.ts' } },
  'lite+plain': { paths: { '@hilt/css/properties': 'variant:properties-lite.d.ts', '@hilt/css/token-types': 'variant:token-types-plain.d.ts' } },
  // 拼错 token 的检测：去掉 NotToken 模板联合
  'no-strict': { paths: { '@hilt/css/values': 'variant:values-nostrict.d.ts' } },
  // 事件后缀的对照（在第一步优化后的快照上改）：4 种后缀的精确键全展开 vs 16 种排列全展开 vs 只有无后缀
  'events-16': { tree: 'variant:tree-events-16' },
  'events-1': { tree: 'variant:tree-events-1' },
};

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`变体替换没命中：${label}`);
  return text.replace(from, to);
}

/** 精简属性表：约 190 个常用属性，值用宽泛类型，关键字补全只给最常用的几十个 */
function liteProperties() {
  const sides = (prefix, suffix = '') => ['', 'Top', 'Right', 'Bottom', 'Left', 'Block', 'BlockStart', 'BlockEnd', 'Inline', 'InlineStart', 'InlineEnd'].map((s) => `${prefix}${s}${suffix}`);
  const corners = ['', 'TopLeft', 'TopRight', 'BottomLeft', 'BottomRight', 'StartStart', 'StartEnd', 'EndStart', 'EndEnd'].map((c) => `border${c}Radius`);
  const lengths = ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'inlineSize', 'blockSize', ...sides('padding'), ...sides('margin'), ...sides('inset').filter((n) => n !== 'inset' || true), 'top', 'right', 'bottom', 'left', 'gap', 'rowGap', 'columnGap', ...sides('border', 'Width'), ...corners, 'fontSize', 'letterSpacing', 'flexBasis', 'outlineWidth', 'outlineOffset', 'textIndent', 'wordSpacing', 'borderSpacing'];
  const keywords = {
    display: 'flex block inline inline-block inline-flex grid inline-grid none contents flow-root table',
    position: 'static relative absolute fixed sticky',
    flexDirection: 'row row-reverse column column-reverse',
    flexWrap: 'nowrap wrap wrap-reverse',
    alignItems: 'stretch center flex-start flex-end baseline start end',
    alignContent: 'stretch center flex-start flex-end space-between space-around',
    alignSelf: 'auto stretch center flex-start flex-end baseline',
    justifyContent: 'flex-start flex-end center space-between space-around space-evenly start end',
    justifyItems: 'stretch center start end',
    overflow: 'visible hidden scroll auto clip',
    overflowX: 'visible hidden scroll auto clip',
    overflowY: 'visible hidden scroll auto clip',
    visibility: 'visible hidden collapse',
    cursor: 'auto default pointer text move not-allowed grab grabbing',
    pointerEvents: 'auto none',
    userSelect: 'auto none text all',
    boxSizing: 'border-box content-box',
    textAlign: 'left right center justify start end',
    textTransform: 'none uppercase lowercase capitalize',
    whiteSpace: 'normal nowrap pre pre-wrap pre-line',
    wordBreak: 'normal break-all keep-all break-word',
    fontStyle: 'normal italic oblique',
    textOverflow: 'clip ellipsis',
    objectFit: 'fill contain cover none scale-down',
    float: 'left right none',
    clear: 'left right both none',
  };
  const others = 'color backgroundColor borderColor outline outlineColor outlineStyle background backgroundImage backgroundSize backgroundPosition backgroundRepeat backgroundClip border borderStyle boxShadow textShadow transition transitionProperty transitionDuration transitionTimingFunction transitionDelay animation animationName animationDuration animationTimingFunction animationDelay animationIterationCount animationFillMode transform transformOrigin filter backdropFilter fontFamily fontWeight textDecoration textDecorationColor verticalAlign lineHeight opacity zIndex flex flexGrow flexShrink order placeItems placeContent placeSelf content listStyle gridTemplateColumns gridTemplateRows gridTemplateAreas gridColumn gridRow gridArea gridAutoFlow gridAutoColumns gridAutoRows aspectRatio objectPosition resize appearance fill stroke strokeWidth caretColor accentColor willChange touchAction scrollBehavior scrollSnapType scrollSnapAlign overflowWrap hyphens tabSize counterReset counterIncrement columns columnCount clipPath mask maskImage mixBlendMode isolation contain containerType containerName borderCollapse tableLayout captionSide emptyCells quotes writingMode direction unicodeBidi'.split(' ');
  const keywordNames = new Set(Object.keys(keywords));
  const lines = [];
  for (const name of new Set(lengths)) lines.push(`  ${name}?: L;`);
  for (const [name, words] of Object.entries(keywords)) lines.push(`  ${name}?: ${words.split(' ').map((w) => `'${w}'`).join(' | ')} | (string & {});`);
  for (const name of others) if (!keywordNames.has(name) && !lengths.includes(name)) lines.push(`  ${name}?: string | number;`);
  return `/** 精简属性表（成本对比用）：${lines.length} 个常用属性，值是宽泛类型，只有最常用的几十个关键字有补全 */
interface LiteProperties<L> {
${lines.join('\n')}
}
export type SxProperties = LiteProperties<(string & {}) | number>;
export type InlineProperties = LiteProperties<(string & {}) | 0>;
`;
}

/** 普通联合版的 token 类型：按 THEME 手写出字面量联合（等于 06 的做法：接口成员 / 联合直接列出） */
function plainTokenTypes(theme) {
  const union = (names) => names.map((n) => `'_${n}'`).join(' | ') || 'never';
  const lines = Object.entries(theme).map(([group, names]) => `  ${group}: ${union(names)};`);
  return `import type { TokenGroupName } from '@hilt/css/property-groups';

/** 普通联合版：每组的短写是手写的字面量联合，没有从登记处用模板字面量计算 */
interface Plain {
${lines.join('\n')}
}
export type ShortTokens<Group extends TokenGroupName> = Group extends keyof Plain ? Plain[Group] : never;
export type QualifiedTokens = \`_\${TokenGroupName}.\${string}\`;
`;
}

export function writeVariantFiles(out, theme) {
  const dir = `${out}/variants`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/properties-lite.d.ts`, liteProperties());
  writeFileSync(`${dir}/token-types-plain.d.ts`, plainTokenTypes(theme));
  writeFileSync(
    `${dir}/values-nostrict.d.ts`,
    replaceOnce(read('types/css/values.d.ts'), 'type Strict<V> = V extends string ? (string extends V ? NotToken : V) : V;', 'type Strict<V> = V;', 'no-strict'),
  );
  // 事件后缀对照用的完整类型树：复制第一步优化后的快照（EventSuffix 版），只改 EventSuffix
  const suffix = /export type EventSuffix =[\s\S]*?;\n/;
  const all16 = ["''", "'Capture'", "'Once'", "'Passive'", "'CaptureOnce'", "'CapturePassive'", "'OnceCapture'", "'OncePassive'", "'PassiveCapture'", "'PassiveOnce'", "'CaptureOncePassive'", "'CapturePassiveOnce'", "'OnceCapturePassive'", "'OncePassiveCapture'", "'PassiveCaptureOnce'", "'PassiveOnceCapture'"];
  for (const [name, replacement] of [['events-16', all16.join(' | ')], ['events-1', "''"]]) {
    const tree = `${dir}/tree-${name}`;
    cpSync(resolve(root, 'perf/step1-types'), tree, { recursive: true });
    const file = `${tree}/elements/events.d.ts`;
    const events = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (!suffix.test(events)) throw new Error('变体替换没命中：EventSuffix');
    writeFileSync(file, events.replace(suffix, `export type EventSuffix = ${replacement};\n`));
  }
}
