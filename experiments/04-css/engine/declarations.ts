/**
 * 样式对象 → 声明表 → 规则文本（运行时样式引擎的纯计算部分，不碰 DOM）：
 * token 短写、值补单位、条件别名与属性选择器、条件对象展开、按“属性 + 条件”合并、序列化成带条件块的规则。
 */
import { getPriority } from './priority';
import { resolveToken } from './tokens';
import type { ConditionAliases } from './value';
import { MILLISECONDS, UNITLESS } from './units';

/** 样式里的一个值 */
export type Leaf = string | number;
/** 样式里属性的取值：值、回退值数组、条件对象；null / undefined 见 walk */
export type StyleValue = Leaf | null | undefined | readonly Leaf[] | StyleObject;
/** 一个命名空间（create 的一组样式） */
export interface StyleObject {
  readonly [key: string]: StyleValue;
}

/** 一个属性的取值：条件链（伪类、@ 规则按书写顺序，用 \0 连接；无条件是 ''）→ 值 */
export interface PropertyEntry {
  /** 普通值（或顶层 null）：合并时整体替换前面的同名属性；条件对象为 false，按条件逐项合并 */
  readonly replace: boolean;
  /** 条件链 → CSS 文本（回退值数组是多条） */
  readonly values: ReadonlyMap<string, readonly string[]>;
}
/** 片段的声明表：属性（连字符写法）→ 取值 */
export type Declarations = ReadonlyMap<string, PropertyEntry>;

/** 规则文本里类名的占位（控制字符，不会出现在 CSS 值里；& 可能出现在 url 里） */
export const SELF = '\u0001';

/** camelCase → kebab-case；自定义属性（--x）原样 */
export const dashify = (property: string) =>
  property.startsWith('--') ? property : property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** 值转成 CSS 文本：token 短写换成 token 变量（tokens.ts），数字按属性补单位（四位小数） */
export function cssValue(property: string, value: Leaf): string {
  if (typeof value === 'string') return resolveToken(property, value.trim());
  const rounded = String(Math.round(value * 10000) / 10000);
  if (UNITLESS.has(property) || property.startsWith('--')) return rounded;
  return rounded + (MILLISECONDS.has(property) ? 'ms' : 'px');
}

/**
 * 条件别名：样式里写 `{ color: { default: '_text', _selected: '_accentText' } }`，状态跟着 DOM 上的
 * aria / data 属性走（COMPONENTS.md §2.2），组件不必再写 `selected && styles.selected`；
 * 一个别名合并了原生、ARIA、data 几种写法，使用方不必关心组件用的是哪一种
 */
const ALIASES = {
  _hover: ':hover',
  _active: ':active',
  _focus: ':focus',
  _focusVisible: ':focus-visible',
  _focusWithin: ':focus-within',
  _disabled: ':is(:disabled,[aria-disabled="true"],[data-disabled])',
  _selected: ':is([aria-selected="true"],[data-selected])',
  _checked: ':is(:checked,[aria-checked="true"],[data-state="checked"])',
  _indeterminate: ':is(:indeterminate,[aria-checked="mixed"],[data-state="indeterminate"])',
  _pressed: ':is([aria-pressed="true"],[data-pressed])',
  _expanded: ':is([aria-expanded="true"],[data-expanded])',
  _open: ':is([open],[data-state="open"])',
  _current: ':is([aria-current]:not([aria-current="false"]),[data-current])',
  _invalid: ':is([aria-invalid="true"],[data-invalid])',
  _readonly: ':is([aria-readonly="true"],[data-readonly])',
  _highlighted: ':is([data-highlighted])',
  _dragging: ':is([data-dragging])',
  _placeholder: '::placeholder',
  _forcedColors: '@media (forced-colors: active)',
  _reducedMotion: '@media (prefers-reduced-motion: reduce)',
  _rtl: ':dir(rtl)',
} as const satisfies Record<keyof ConditionAliases, string>;

/** 条件别名表（见 ALIASES）；值保留字面量类型，伪类别名可以直接交给 `when.*`（它要 `:` 开头的选择器） */
export const CONDITIONS: typeof ALIASES & Readonly<Record<string, string | undefined>> = ALIASES;

/** 是普通对象（条件对象、命名空间），不是数组 */
export const isObject = (value: unknown): value is StyleObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 条件键 → 选择器片段或 @ 规则；写错的别名、裸的属性选择器直接报错（否则会变成无条件样式） */
function condition(property: string, key: string): string {
  const resolved = conditionOf(key);
  if (!resolved) {
    throw new Error(`样式：${property} 的条件 "${key}" 不是伪类、属性选择器、@ 规则或已知的别名`);
  }
  return resolved;
}

/**
 * 条件键 → 选择器片段或 @ 规则；不是条件时 undefined。属性选择器（'[data-hot]'、'[data-state="open"]'）
 * 包成 :is(…)：状态写在 DOM 属性上，状态变化只改属性、类名不变（同条件别名）
 */
function conditionOf(key: string): string | undefined {
  const resolved = CONDITIONS[key] ?? key;
  if (resolved.startsWith(':') || resolved.startsWith('@')) return resolved;
  if (resolved.startsWith('[') && resolved.endsWith(']')) return `:is(${resolved})`;
  return undefined;
}

/** 命名空间展开后的一个叶子 */
export interface LeafEntry {
  /** 属性名（样式里的写法，camelCase 或 --变量） */
  property: string;
  /** 顶层的普通值（含 null）：合并时整体替换前面的同名属性 */
  replace: boolean;
  /** 条件链：伪类、@ 规则按书写顺序 */
  chain: readonly string[];
  /** CSS 文本（回退值数组是多条）；顶层 null 是 null：去掉该属性 */
  texts: readonly string[] | null;
}

const texts = (property: string, value: Leaf | readonly Leaf[]) =>
  (Array.isArray(value) ? value : [value as Leaf]).map((v) => cssValue(property, v));

/** 属性键：变量组的 token（`[shimmerVars.highlight]: …`，键是 var(--…)）设置的是那个变量 */
const propertyOf = (key: string) => (key.startsWith('var(--') ? key.slice(4, -1) : key);

/** 命名空间的每个叶子。顶层的条件块（'::before': {…}、':hover': {…}）展开成各属性的条件值 */
export function eachLeaf(namespace: StyleObject, visit: (leaf: LeafEntry) => void) {
  for (const [name, value] of Object.entries(namespace)) {
    const resolved = conditionOf(name);
    const key = propertyOf(name);
    if (resolved && isObject(value)) {
      for (const [nestedName, nested] of Object.entries(value)) {
        const property = propertyOf(nestedName);
        walk(property, nested, [resolved], (chain, leaf) =>
          visit({ property, replace: false, chain, texts: texts(property, leaf) }),
        );
      }
    } else if (value === null || value === undefined) {
      visit({ property: key, replace: true, chain: [], texts: null });
    } else {
      const replace = !isObject(value);
      walk(key, value, [], (chain, leaf) =>
        visit({ property: key, replace, chain, texts: texts(key, leaf) }),
      );
    }
  }
}

/** 叶子 → 声明表 */
export function tableOf(leaves: readonly LeafEntry[]): Declarations {
  const table = new Map<string, { replace: boolean; values: Map<string, readonly string[]> }>();
  for (const { property, replace, chain, texts } of leaves) {
    const dashed = dashify(property);
    let entry = table.get(dashed);
    if (!entry) table.set(dashed, (entry = { replace, values: new Map() }));
    if (texts) entry.values.set(chain.join('\0'), texts);
  }
  return table;
}

/** 命名空间 → 声明表 */
export function declarations(namespace: StyleObject): Declarations {
  const leaves: LeafEntry[] = [];
  eachLeaf(namespace, (leaf) => leaves.push(leaf));
  return tableOf(leaves);
}

/** 条件对象逐层展开到叶子；null / undefined 不产出（条件里的 null 表示“这个条件不改”） */
export function walk(
  property: string,
  value: StyleValue,
  chain: readonly string[],
  visit: (chain: readonly string[], value: Leaf | readonly Leaf[]) => void,
) {
  if (value === null || value === undefined) return;
  if (!isObject(value)) return visit(chain, value as Leaf | readonly Leaf[]);
  for (const [key, nested] of Object.entries(value)) {
    walk(property, nested, key === 'default' ? chain : [...chain, condition(property, key)], visit);
  }
}

/** 合并几个片段的声明表（规则见文件开头），不改动片段本身 */
export function merge(tables: readonly Declarations[]): Declarations {
  if (tables.length === 1) return tables[0]!;
  const merged = new Map<string, PropertyEntry>();
  for (const table of tables) {
    for (const [property, entry] of table) {
      const previous = merged.get(property);
      if (!previous || entry.replace) merged.set(property, entry);
      else
        merged.set(property, {
          replace: false,
          values: new Map([...previous.values, ...entry.values]),
        });
    }
  }
  return merged;
}

/** 条件链的排序权重：伪类、@ 规则的优先级相加（同 StyleX 的规则顺序） */
const chainWeight = (chain: string) =>
  chain ? chain.split('\0').reduce((sum, part) => sum + getPriority(part), 0) : 0;

/**
 * 声明表 → 规则文本（类名用 SELF 占位）。每个条件链一条规则：
 * @ 规则里的选择器按层数重复类名（.c.c），压过同级的伪类；when.*（:where）再重复一次，同 StyleX
 */
export function serialize(table: Declarations): string[] {
  const byChain = new Map<string, [property: string, values: readonly string[]][]>();
  for (const [property, entry] of table) {
    for (const [chain, values] of entry.values) {
      let list = byChain.get(chain);
      if (!list) byChain.set(chain, (list = []));
      list.push([property, values]);
    }
  }
  return [...byChain]
    .sort(([a], [b]) => chainWeight(a) - chainWeight(b))
    .map(([chain, list]) => {
      const body = list
        .sort(([a], [b]) => getPriority(a) - getPriority(b))
        .flatMap(([property, values]) => values.map((value) => `${property}:${value}`))
        .join(';');
      const parts = chain ? chain.split('\0') : [];
      const atRules = parts.filter((part) => part.startsWith('@'));
      const pseudos = parts.filter((part) => part.startsWith(':'));
      const classes = pseudos.filter((part) => !part.startsWith('::')).join('');
      const elements = pseudos.filter((part) => part.startsWith('::')).join('');
      const selector =
        `.${SELF}`.repeat(1 + atRules.length + (classes.includes(':where(') ? 1 : 0)) +
        classes +
        elements;
      return atRules.reduceRight((rule, atRule) => `${atRule}{${rule}}`, `${selector}{${body}}`);
    });
}
