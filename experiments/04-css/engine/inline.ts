/**
 * 行内样式：给没有 CSSOM、不能在运行时插规则的宿主（小程序）用。
 * 组合类照常生成（类名、缓存、热更新都不变），宿主渲染元素时按类名查回它的声明表，
 * 自己判定条件链里的伪类、属性选择器、@ 规则（它知道元素上的属性与触摸状态），把成立的那些展开成行内样式。
 *
 *   const style = inlineStyle(className, (condition) => matchOn(node, condition));
 *
 * 条件块按 serialize 的顺序拼接（无条件在前、权重高的条件在后），同一属性后写的覆盖先写的，与样式表的层叠一致。
 * 伪元素（::before、::placeholder）没法写进行内样式，跳过（传了 onPseudoElement 时告诉宿主，开发期提示用）。
 * 主题类（createTheme）展开成变量声明，子孙照常继承。
 */
import { merge, serialize, SELF, type Declarations } from './declarations';
import { compositeFragments, FRAGMENT } from './fragment';

/** 判定条件链里的一段：伪类（:active、:is(…)、:not(…)）或 @ 规则（@media …）；成立返回 true */
export type ConditionMatcher = (condition: string) => boolean;

/** 一个条件块：条件链拆成的段（无条件是空数组）与块里的声明；pseudoElement 是带伪元素的选择器，这种块不展开 */
interface ChainBlock {
  readonly conditions: readonly string[];
  readonly body: string;
  readonly pseudoElement?: string;
}

/** 固定类（createTheme 的主题类）→ 它的条件块：只有变量声明，条件只有 @ 规则（vars.ts 登记） */
const fixedBlocks = new Map<string, ChainBlock[]>();

/** 登记一个主题类的变量声明：atRules 是外层的 @ 规则（没有时空数组），body 形如 `--x:1;--y:2` */
export function registerInlineClass(
  name: string,
  blocks: readonly { atRules: readonly string[]; body: string }[],
) {
  fixedBlocks.set(
    name,
    blocks.map((block) => ({ conditions: block.atRules, body: block.body })),
  );
}

/** 组合类 → 它的条件块；记下当时的声明表，热更新换了片段的声明表时重新展开 */
const blocksByName = new Map<string, { tables: readonly Declarations[]; blocks: ChainBlock[] }>();

/**
 * 组合类在这个元素上的行内样式（`color:red;padding:4px`）；不是引擎生成的组合类时 undefined，
 * 宿主照常把它当普通类名（使用方自己写的样式表）。遇到展开不了的伪元素块时调用 onPseudoElement
 */
export function inlineStyle(
  className: string,
  matches: ConditionMatcher,
  onPseudoElement?: (selector: string) => void,
): string | undefined {
  const blocks = blocksOf(className) ?? fixedBlocks.get(className);
  if (!blocks) return undefined;
  const bodies: string[] = [];
  for (const block of blocks) {
    if (block.pseudoElement) onPseudoElement?.(block.pseudoElement);
    else if (block.conditions.every(matches)) bodies.push(block.body);
  }
  return bodies.join(';');
}

function blocksOf(name: string): readonly ChainBlock[] | undefined {
  const fragments = compositeFragments(name);
  if (!fragments) return undefined;
  const tables = fragments.map((part) => part[FRAGMENT]);
  const cached = blocksByName.get(name);
  if (cached && sameTables(cached.tables, tables)) return cached.blocks;
  const blocks = serialize(merge(tables)).flatMap(toBlock);
  blocksByName.set(name, { tables, blocks });
  return blocks;
}

const sameTables = (a: readonly Declarations[], b: readonly Declarations[]) =>
  a.length === b.length && a.every((table, index) => table === b[index]);

/**
 * 规则文本 → 条件块。serialize 的输出形如 `@media (x){.␁.␁:hover{color:red}}`：
 * 外层的 @ 规则逐层剥掉，选择器里去掉类名占位后剩下的伪类就是条件；带伪元素的规则只记下选择器
 */
function toBlock(rule: string): ChainBlock[] {
  const conditions: string[] = [];
  let rest = rule;
  while (rest.startsWith('@')) {
    const open = rest.indexOf('{');
    conditions.push(rest.slice(0, open));
    rest = rest.slice(open + 1, -1);
  }
  const open = rest.indexOf('{');
  const selector = rest.slice(0, open).replaceAll(`.${SELF}`, '');
  if (selector.includes('::')) return [{ conditions, body: '', pseudoElement: selector }];
  conditions.push(...splitPseudos(selector));
  return [{ conditions, body: rest.slice(open + 1, -1) }];
}

/** `:hover:not(:disabled,[x])` → [':hover', ':not(:disabled,[x])']：只在括号外的冒号处切开 */
function splitPseudos(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ':' && depth === 0 && index > start) {
      parts.push(selector.slice(start, index));
      start = index;
    }
  }
  if (selector.length > start) parts.push(selector.slice(start));
  return parts;
}
