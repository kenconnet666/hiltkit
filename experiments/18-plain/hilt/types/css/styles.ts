/**
 * sx、create、recipe 的类型。取值（属性、token、条件）见 values.ts。
 */
import type { Prop } from '../../index';
import type { LooseStyleObject, StyleObject } from './values';

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

/**
 * sx 的取值：样式组、动态样式的结果、假值、对象字面量，
 * 返回它们的函数（`() => active() && styles.active`：依赖变了只换这一项），以及它们的嵌套数组。
 */
export type SxStyles = SxItem | SxFn | SxList;
type SxItem = null | undefined | boolean | CompiledStyles | DynamicResult | StyleObject;
interface SxFn {
  (): SxStyles;
}
interface SxList extends ReadonlyArray<SxStyles> {}

// ---- create ------------------------------------------------------------------------------------

type DynamicStyle = (...args: never[]) => LooseStyleObject;

type MapStyles<S> = Readonly<{
  [Name in keyof S]: S[Name] extends (...args: infer Args) => unknown ? (...args: Args) => DynamicResult : CompiledStyles;
}>;

/**
 * 定义一组样式：静态的写对象，动态的写函数 `(w: number) => ({ width: w })`。
 * 参数类型是对 S 的映射：静态条目直接对着 StyleObject 检查（字面量保持“新鲜”，拼错的属性报未知属性，
 * 错误落在出错的属性上）；写成 `styles: S` 再靠 extends 约束的话，拼错的属性会漏过。
 * `label` 是开发模式的可读名字（开发插件按文件名与变量名填，不手写）。
 */
export declare function create<const S extends { readonly [name: string]: StyleObject | DynamicStyle }>(
  styles: { readonly [N in keyof S]: S[N] extends DynamicStyle ? S[N] : StyleObject },
  label?: string,
): MapStyles<S>;

/** 关键帧的步骤：from、to、百分比 */
type KeyframeStep = 'from' | 'to' | `${number}%`;
/** 返回动画名，写进 `animationName`；规则第一次调用时插入 */
export declare function keyframes(frames: { readonly [Step in KeyframeStep]?: StyleObject }): string;

// ---- recipe ------------------------------------------------------------------------------------

/** 每个部件的样式（可以只写其中几个） */
export type PartStyles<P extends string> = { readonly [Part in P]?: StyleObject };

/** 取值的键是 'true' / 'false' 时，调用侧收 boolean */
type ValueOf<K> = K extends 'true' | 'false' ? boolean : K;
/** 配方里 compound.when、defaults 用的档位取值：只收值 */
export type VariantValues<V> = {
  [Name in keyof V]?: ValueOf<keyof V[Name]> | null | undefined;
};
/**
 * 调用配方时的档位选择：值、读取函数（sig、derived、箭头函数、解构出来的 prop）都行，函数是活的，档位变了只有读了它的部件更新。
 * null / undefined 用默认值。
 */
export type VariantSelection<V> = {
  [Name in keyof V]?: Prop<ValueOf<keyof V[Name]> | null | undefined>;
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
  compound?: readonly ({ when: VariantValues<NoInfer<V>> } & PartStyles<P>)[];
  defaults?: VariantValues<NoInfer<V>>;
}

/** 一个部件的属性包：展开到元素上 `<button {...s.root} />`，或交给 merge */
export interface PartAttrs {
  readonly sx: SxStyles;
  readonly 'data-scope': string;
  readonly 'data-part': string;
}

export interface Recipe<P extends string, V> {
  (selection?: VariantSelection<V>): { readonly [Part in P]: PartAttrs };
  readonly parts: readonly P[];
  readonly name: string | undefined;
}

export declare function recipe<const P extends string, V = {}>(config: RecipeConfig<P, V>): Recipe<P, V>;

/** 主题层对一个配方的定制：配方没有的档位取值也可以在这里给 */
export interface RecipeExtension {
  readonly base?: PartStyles<string>;
  readonly variants?: { readonly [name: string]: { readonly [value: string]: PartStyles<string> } };
}
/** 在当前组件的子树里追加一层定制，键是配方的 name。对象要稳定（写在模块里），配方按它缓存 */
export declare function provideStyles(layer: { readonly [recipeName: string]: RecipeExtension }): void;
/** 配方 + 当前子树里各层的定制：`const s = useRecipe(button, { size })` */
export declare function useRecipe<P extends string, V>(recipe: Recipe<P, V>, selection?: VariantSelection<V>): { readonly [Part in P]: PartAttrs };
