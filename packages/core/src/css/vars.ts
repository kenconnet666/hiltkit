/**
 * CSS 变量组、主题与标记：
 *   defineTokens('vtp', { colors: {…}, space: {…} })   主题 tokens：每组一个变量组，登记短写（'_md'），返回 t
 *   defineVars('vtp-layout', { … })                    组件私有的变量组（不进短写）
 *   createTheme(t, { colors: { accent: … } })           只改变量的类（可以跨几个组），挂到任意元素的 sx 上
 *   themeStyle(t.colors, { accent: userColor })        同样的覆盖写成行内变量（运行时随便给的颜色，不进规则表）
 *   defineMarker('heading')                            给 when.* 标出被观察的祖先、兄弟
 * 变量名、标记类名都由调用方给的名字决定（`--vtp-colors-accent`），源码、产物、SSR 一致，调试时也认得出来。
 */
import './register';
import { cssValue, dashify, SELF, walk, type Leaf, type StyleValue } from './declarations';
import { CLASS, DYNAMIC, fragment, type ClassStyle } from './fragment';
import { registerTokenGroup } from './tokens';
import { hash, insert, insertNamed, isInserted } from './sheet';

/** 变量组上的组名（不可枚举：遍历 token 时不出现） */
export const VAR_GROUP = Symbol('style var group');
/** defineTokens 的结果上的标记 */
const TOKEN_SET = Symbol('style token set');

/** defineVars 的结果：token 名 → `var(--名字-token)`，带组名 */
export type VarGroup = Readonly<Record<string, string>> & { readonly [VAR_GROUP]: string };
/** defineTokens 的结果：组名 → 变量组 */
export type TokenSet<
  G extends Record<string, Record<string, StyleValue>> = Record<string, Record<string, StyleValue>>,
> = {
  readonly [K in keyof G]: VarGroup & { readonly [T in keyof G[K]]: string };
} & { readonly [TOKEN_SET]: true };

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
 * 声明一组 CSS 变量：`defineVars('vtp-layout', { navHeight: '56px' })` → `:root{--vtp-layout-nav-height:56px}`，
 * 返回 `{ navHeight: 'var(--vtp-layout-nav-height)' }`。值可以按条件取（`{ default: '200ms', '@media (…)': '0ms' }`）。
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
  insertNamed(`--${name}`, rules);
  Object.defineProperty(group, VAR_GROUP, { value: name });
  return Object.freeze(group) as never;
}

/**
 * 主题 tokens：每组 `defineVars(前缀-组名)`，并登记组名，样式里的 token 短写（`'_md'`、`'_space.md'`）按它解析。
 * 返回 t：`t.space.md` 用在模板字符串里（夹在值中间时短写不认），`createTheme(t, …)` 按组改值
 */
export function defineTokens<const G extends Record<string, Record<string, StyleValue>>>(
  prefix: string,
  groups: G,
): TokenSet<G> {
  const result: Record<string, VarGroup> = {};
  for (const [name, values] of Object.entries(groups)) {
    result[name] = defineVars(`${prefix}-${name}`, values);
    registerTokenGroup(name, result[name]!);
  }
  Object.defineProperty(result, TOKEN_SET, { value: true });
  return Object.freeze(result) as never;
}

/** 覆盖值 → [变量, 值] 对：认得出 token 名，写错的报错 */
function variablesOf(
  target: VarGroup | TokenSet,
  overrides: Record<string, unknown>,
): [variable: string, value: StyleValue][] {
  const values: [string, StyleValue][] = [];
  const set = TOKEN_SET in target;
  const put = (group: VarGroup, key: string, value: StyleValue) => {
    const variable = /^var\((--[^)]+)\)$/.exec(group[key] ?? '')?.[1];
    if (!variable) throw new Error(`createTheme：${group[VAR_GROUP]} 组里没有 token '${key}'`);
    values.push([variable, value]);
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (!set) put(target as VarGroup, key, value as StyleValue);
    else {
      const group = (target as Record<string, VarGroup>)[key];
      if (!group) throw new Error(`createTheme：没有 '${key}' 这个 token 组`);
      for (const [name, v] of Object.entries(value as object)) put(group, name, v as StyleValue);
    }
  }
  return values;
}

/** 去重键：同一个变量组的主题在一次 sx 里后者覆盖前者；跨组的主题（覆盖 t 的几个组）自成一组 */
const themeKey = (target: VarGroup | TokenSet) =>
  TOKEN_SET in target ? 'theme' : (target as VarGroup)[VAR_GROUP];

/**
 * 一套主题：只改变量的类（`.t.t, .t.t:root { --变量: 值 }`，压过 :root 上的默认值），值可以按条件取。
 * 第一个参数是 defineTokens 的 t 时覆盖按组写（`{ colors: {…}, shadows: {…} }`，一个类管全部），
 * 是单个变量组时直接写 token。可以挂到任意元素的 sx 上：子树里的变量跟着变，嵌套、局部都是 CSS 继承。
 * `transient`：运行时按用户输入生成的主题，服务端规则表限量记住
 */
export function createTheme(
  target: VarGroup | TokenSet,
  overrides: Record<string, unknown>,
  options: { transient?: boolean } = {},
): ClassStyle {
  const values = variablesOf(target, overrides);
  const rules = [...byAtRule(values)].map(([atRule, list]) => {
    const rule = `.${SELF}.${SELF},.${SELF}.${SELF}:root{${list.join(';')}}`;
    return atRule ? `${atRule}{${rule}}` : rule;
  });
  const key = themeKey(target);
  const name = `x${hash(key + rules.join(''))}`;
  if (!isInserted(name))
    insert(
      name,
      rules.map((rule) => rule.replaceAll(SELF, name)),
      options.transient,
    );
  return Object.freeze({ [CLASS]: [key, name] as const });
}

const NO_STYLE = fragment(new Map());

/**
 * 主题覆盖写成行内变量：`sx={[themeStyle(t.colors, { accent: userColor })]}`。
 * 颜色是用户随便选的（取色器连续变化）时用它：不生成类、不插规则，规则表不会随取值增长。不支持按条件取值
 */
export function themeStyle(
  target: VarGroup | TokenSet,
  overrides: Record<string, unknown>,
): readonly [ClassStyle | ReturnType<typeof fragment>, Readonly<Record<string, string>>] {
  const inline: Record<string, string> = {};
  for (const [variable, value] of variablesOf(target, overrides)) {
    if (typeof value === 'object' && value !== null)
      throw new Error('themeStyle：不支持按条件取值，请用 createTheme');
    inline[variable] = cssValue(variable, value as Leaf);
  }
  const result = [NO_STYLE, inline] as const;
  Object.defineProperty(result, DYNAMIC, { value: true });
  return result;
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

/**
 * 防闪烁脚本（SSR 的明暗）：内联到 <head>，页面画出之前按记住的偏好把主题类加到 <html> 上。
 * 服务端不知道用户的偏好（在 localStorage、系统设置里），所以所有候选主题的规则都要随 renderStyleTag 一起输出
 * （`renderStyleTag(html, { include: themeBootClasses(themes) })`），脚本只负责选类。
 * 应用接管后用同一个 storageKey 读写偏好，切换时换掉 <html> 上的主题类即可。
 */
export function themeBootScript(options: {
  /** 主题名 → 主题（createTheme 的结果） */
  themes: Record<string, ClassStyle>;
  /** 跟随系统时用哪两套 */
  system?: { light: string; dark: string };
  /** 存偏好的 localStorage 键 */
  storageKey?: string;
  /** 没记过时的偏好，默认跟随系统 */
  fallback?: string;
}): string {
  const classes = Object.fromEntries(
    Object.entries(options.themes).map(([name, theme]) => [name, theme[CLASS][1]]),
  );
  const config = JSON.stringify({
    classes,
    system: options.system ?? { light: 'light', dark: 'dark' },
    key: options.storageKey ?? 'hilt-theme',
    fallback: options.fallback ?? 'system',
  });
  return (
    `(()=>{const c=${config};let p;try{p=localStorage.getItem(c.key)}catch(e){}` +
    `if(p!=='system'&&!c.classes[p])p=c.fallback;` +
    `const n=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?c.system.dark:c.system.light):p;` +
    `const k=c.classes[n];if(!k)return;const r=document.documentElement;r.classList.add(k);r.dataset.theme=n})()`
  );
}

/** themeBootScript 会用到的类名：交给 renderStyleTag 的 include，保证这些主题的规则在首屏样式里 */
export const themeBootClasses = (themes: Record<string, ClassStyle>): string[] =>
  Object.values(themes).map((theme) => theme[CLASS][1]);
