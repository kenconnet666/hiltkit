/**
 * CSS 变量组与主题、标记：defineVars 在 :root 上声明一组变量（主题 tokens、组件之间约定的变量），
 * createTheme 生成只改这组变量的类，defineMarker 给 when.* 标出被观察的祖先、兄弟。
 * 变量名、标记类名都由调用方给的名字决定（`--vtp-colors-accent`），源码、产物、SSR 一致，调试时也认得出来。
 */
import { cssValue, dashify, SELF, walk, type Leaf, type StyleValue } from './declarations';
import { CLASS, type ClassStyle } from './fragment';
import { registerInlineClass } from './inline';
import { hash, insert, isInserted } from './sheet';

/** 变量组上的组名（不可枚举：遍历 token 时不出现） */
export const VAR_GROUP = Symbol('style var group');

/** defineVars 的结果：token 名 → `var(--名字-token)`，带组名 */
export type VarGroup = Readonly<Record<string, string>> & { readonly [VAR_GROUP]: string };

/** 条件值按 @ 规则分开的声明：@ 规则链（无条件时为空串）→ 声明 */
function byAtRule(entries: Iterable<[variable: string, value: StyleValue]>) {
  const blocks = new Map<string, string[]>();
  for (const [variable, value] of entries) {
    walk(variable, value, [], (chain, leaf) => {
      const atRule = chain.join('');
      let list = blocks.get(atRule);
      if (!list) blocks.set(atRule, (list = []));
      list.push(`${variable}:${cssValue(variable, leaf as Leaf)}`);
    });
  }
  return blocks;
}

/**
 * 声明一组 CSS 变量：`defineVars('vtp-colors', { accent: '#3e63dd' })` → `:root{--vtp-colors-accent:#3e63dd}`，
 * 返回 `{ accent: 'var(--vtp-colors-accent)' }`。值可以按条件取（`{ default: '200ms', '@media (…)': '0ms' }`）。
 * 规则在调用时插入；同名再调用（热更新重新执行模块）时换成新的取值
 */
export function defineVars<const T extends Record<string, StyleValue>>(
  name: string,
  tokens: T,
): VarGroup & { readonly [K in keyof T]: string } {
  const group: Record<string, string> = {};
  const values: [string, StyleValue][] = [];
  for (const [key, value] of Object.entries(tokens)) {
    const variable = `--${name}-${dashify(key).replace(/^-/, '')}`;
    group[key] = `var(${variable})`;
    values.push([variable, value]);
  }
  const rules = [...byAtRule(values)].map(([atRule, list]) => {
    const rule = `:root{${list.join(';')}}`;
    return atRule ? `${atRule}{${rule}}` : rule;
  });
  insert(`--${name}`, rules);
  Object.defineProperty(group, VAR_GROUP, { value: name });
  return Object.freeze(group) as never;
}

/**
 * 一套主题：只改一组变量的类（`.t.t, .t.t:root { --变量: 值 }`，压过 :root 上的默认值），值可以按条件取。
 * 同一组的主题在一次 attrs 里后者覆盖前者
 */
export function createTheme(group: VarGroup, overrides: Record<string, StyleValue>): ClassStyle {
  const values: [string, StyleValue][] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const variable = /^var\((--[^)]+)\)$/.exec(group[key] ?? '')?.[1];
    if (!variable) throw new Error(`createTheme：${group[VAR_GROUP]} 组里没有 token '${key}'`);
    values.push([variable, value]);
  }
  const rules = [...byAtRule(values)].map(([atRule, list]) => {
    const rule = `.${SELF}.${SELF},.${SELF}.${SELF}:root{${list.join(';')}}`;
    return atRule ? `${atRule}{${rule}}` : rule;
  });
  const name = `x${hash(group[VAR_GROUP] + rules.join(''))}`;
  // 小程序这类不能插规则的宿主把主题类展开成行内的变量声明（inline.ts）
  registerInlineClass(
    name,
    [...byAtRule(values)].map(([atRule, list]) => ({
      atRules: atRule ? atRule.split(/(?=@)/) : [],
      body: list.join(';'),
    })),
  );
  if (!isInserted(name))
    insert(
      name,
      rules.map((rule) => rule.replaceAll(SELF, name)),
    );
  return Object.freeze({ [CLASS]: [group[VAR_GROUP], name] as const });
}

/** 标记：挂到元素上的一个类，when.* 按它找被观察的元素 */
export type Marker = ClassStyle;

/** 定义标记：`defineMarker('vtp-heading')`，类名就是这个名字 */
export const defineMarker = (name: string): Marker =>
  Object.freeze({ [CLASS]: [name, name] as const });

const markerClass = (marker: Marker) => marker[CLASS][1];

/** when.*：按祖先、后代、兄弟的状态取样式的条件键（:where 不加特异性，同 StyleX） */
export const when = {
  /** 祖先处于某状态时：`[when.ancestor(':hover', marker)]: 1` */
  ancestor: (pseudo: string, marker: Marker) => `:where(.${markerClass(marker)}${pseudo} *)`,
  /** 有后代处于某状态时 */
  descendant: (pseudo: string, marker: Marker) => `:where(:has(.${markerClass(marker)}${pseudo}))`,
  /** 前面的兄弟处于某状态时 */
  siblingBefore: (pseudo: string, marker: Marker) => `:where(.${markerClass(marker)}${pseudo} ~ *)`,
  /** 后面的兄弟处于某状态时 */
  siblingAfter: (pseudo: string, marker: Marker) =>
    `:where(:has(~ .${markerClass(marker)}${pseudo}))`,
  /** 任一兄弟处于某状态时 */
  anySibling: (pseudo: string, marker: Marker) =>
    `:where(.${markerClass(marker)}${pseudo} ~ *, :has(~ .${markerClass(marker)}${pseudo}))`,
};
