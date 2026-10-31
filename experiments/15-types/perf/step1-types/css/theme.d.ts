/**
 * defineTokens / createTheme / defineConditions 的类型。
 * defineTokens 的返回值直接驱动 token 短写的类型：应用用 `declare module '@hilt/css' { interface TokenSets { … typeof t } }` 登记（见 registry.d.ts）。
 */
import type { Condition, StyleValue } from '@hilt/css/values';
import type { CompiledStyles, DynamicResult } from '@hilt/css/styles';

declare const TOKEN_SET: unique symbol;
declare const VAR_GROUP: unique symbol;

/** token 的取值：任意 CSS 值，可以按条件取（深色模式、媒体查询） */
export type TokenValue = StyleValue<string | number>;
export type TokenInput = { readonly [group: string]: { readonly [token: string]: TokenValue } };

/** 一个变量组：token 名 → `var(--前缀-组-名)`，用在模板字符串里 */
export type VarGroup<T extends object = Record<string, unknown>> = {
  readonly [Name in keyof T]: string;
} & { readonly [VAR_GROUP]: string };

/** defineTokens 的结果：组名 → 变量组 */
export type TokenSet<G extends TokenInput = TokenInput> = {
  readonly [Group in keyof G]: VarGroup<G[Group]>;
} & { readonly [TOKEN_SET]: true };

/**
 * 主题 tokens：每组一个变量组（`--vtp-colors-accent`），同时登记 '_md' 这样的短写。
 * 返回 t：`t.space.md` 用在模板字符串里（夹在值中间时短写不认），createTheme 按它校验。
 * 登记到类型层要在同一个文件里补一行声明合并（见 registry.d.ts）。
 */
export declare function defineTokens<const G extends TokenInput>(prefix: string, groups: G): TokenSet<G>;

/** 组件私有的变量组（不进短写） */
export declare function defineVars<const T extends { readonly [token: string]: TokenValue }>(name: string, tokens: T): VarGroup<T>;

type ThemeOverrides<Target> = Target extends { readonly [TOKEN_SET]: true }
  ? { readonly [Group in keyof Target & string]?: { readonly [Name in keyof Target[Group] & string]?: TokenValue } }
  : Target extends { readonly [VAR_GROUP]: string }
    ? { readonly [Name in keyof Target & string]?: TokenValue }
    : never;

/**
 * 一套主题：只改变量的类，挂到任意元素的 sx 上。覆盖必须是 token 的子集：
 * 第一个参数是 defineTokens 的 t 时按组写（`{ colors: {…}, space: {…} }`），是单个变量组时直接写 token。
 * 用一个泛型签名而不是两个重载：拼错的 token 直接报在那个属性上，不是 “No overload matches”。
 */
export declare function createTheme<Target extends TokenSet | VarGroup>(
  target: Target,
  overrides: ThemeOverrides<Target>,
  options?: { transient?: boolean },
): CompiledStyles;

/** 同样的覆盖写成行内变量：运行时随便给的取值，不进规则表，不支持按条件取值 */
export declare function themeStyle<Target extends TokenSet | VarGroup>(
  target: Target,
  overrides: ThemeOverrides<Target>,
): DynamicResult;

/** 自定义条件别名：名字以 _ 开头；登记到类型层要补一行声明合并（见 registry.d.ts） */
export declare function defineConditions<const C extends { readonly [alias: string]: Condition }>(
  conditions: C & { readonly [Alias in keyof C]: Alias extends `_${string}` ? Condition : never },
): C;
