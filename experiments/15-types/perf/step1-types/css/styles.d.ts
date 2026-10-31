/**
 * sx、create、recipe 的类型。取值（属性、token、条件）见 values.d.ts。
 */
import type { LooseStyleObject, StyleObject } from '@hilt/css/values';

declare const COMPILED: unique symbol;
declare const DYNAMIC: unique symbol;

/** 一个样式组（create 的结果之一，或 createTheme 的结果）：不透明，交给 sx */
export interface CompiledStyles {
  readonly [COMPILED]: true;
}
/** 动态样式的行内部分：CSS 变量名 → 值 */
export type InlineStyles = Readonly<Record<string, string>>;
/**
 * 动态样式调用的结果：[样式组, 行内变量]。必须带品牌：裸元组 Readonly<[CompiledStyles, InlineStyles]> 会让
 * sx={[styles.root, { marginTopp: '_md' }]}（两项、对象值都是字符串）被当成动态样式结果而放过拼写检查。
 */
export type DynamicResult = Readonly<[CompiledStyles, InlineStyles]> & { readonly [DYNAMIC]: true };

type StyleArray<T> = T | ReadonlyArray<StyleArray<T>>;

/** sx 的取值：样式组、动态样式的结果、假值、对象字面量，以及它们的嵌套数组 */
export type SxStyles = StyleArray<null | undefined | boolean | CompiledStyles | DynamicResult | StyleObject>;

// ---- create ------------------------------------------------------------------------------------

type DynamicStyle = (...args: never[]) => LooseStyleObject;

type MapStyles<S> = Readonly<{
  [Name in keyof S]: S[Name] extends (...args: infer Args) => unknown ? (...args: Args) => DynamicResult : CompiledStyles;
}>;

/**
 * 定义一组样式：静态的写对象，动态的写函数 `(w: number) => ({ width: w })`。
 * 参数类型是对 S 的映射：静态条目直接对着 StyleObject 检查（字面量保持“新鲜”，拼错的属性报未知属性，
 * 错误落在出错的属性上）；写成 `styles: S` 再靠 extends 约束的话，拼错的属性会漏过。
 * 不用重载：两个重载都失败时报的是“没有匹配的重载”，落在 create 上，信息也长。
 */
export declare function create<const S extends { readonly [name: string]: StyleObject | DynamicStyle }>(styles: {
  readonly [N in keyof S]: S[N] extends DynamicStyle ? S[N] : StyleObject;
}): MapStyles<S>;

// ---- recipe ------------------------------------------------------------------------------------

/** 每个部件的样式（可以只写其中几个） */
export type PartStyles<P extends string> = { readonly [Part in P]?: StyleObject };

/** 取值的键是 'true' / 'false' 时，调用侧收 boolean */
type ValueOf<K> = K extends 'true' | 'false' ? boolean : K;
export type VariantSelection<V> = {
  [Name in keyof V]?: ValueOf<keyof V[Name]> | null | undefined;
};

export interface RecipeConfig<P extends string, V> {
  /** 组件名：部件的 data-scope，主题层按它找定制 */
  name?: string;
  parts: readonly P[];
  base?: PartStyles<P>;
  /**
   * 档位：名 → 取值 → 各部件的样式。写成映射类型而不是 `V extends Variants<P>`：
   * 后者让 V 直接等于字面量，拼错的属性名因为“不是新鲜对象字面量”而漏过检查
   */
  variants?: { readonly [Name in keyof V]: { readonly [Value in keyof V[Name]]: PartStyles<P> } };
  compound?: readonly ({ when: VariantSelection<NoInfer<V>> } & PartStyles<P>)[];
  defaults?: VariantSelection<NoInfer<V>>;
}

/** 一个部件的属性包：展开到元素上 `<button {...s.root} />` */
export interface PartAttrs {
  readonly sx: SxStyles;
  readonly 'data-scope': string;
  readonly 'data-part': string;
}

export interface Recipe<P extends string, V> {
  (selection?: VariantSelection<V>): { readonly [Part in P]: PartAttrs };
  readonly parts: readonly P[];
}

export declare function recipe<const P extends string, V = {}>(config: RecipeConfig<P, V>): Recipe<P, V>;
