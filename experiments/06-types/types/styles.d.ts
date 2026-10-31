/**
 * 样式 API 的类型：css.create / css.recipe / SxStyles。
 * 取值类型建在 csstype 上；'_md' 这类 token 短写按属性所在的组补全并校验（见 tokens.d.ts）。
 */
import type * as CSS from 'csstype';
import type { TokenGroups } from 'exp06/tokens';

declare const COMPILED: unique symbol;

/** 一个样式组（css.create 的结果之一）：不透明，只由 css.create 产出，交给 sx */
export interface CompiledStyles {
  readonly [COMPILED]: true;
}
/** 动态样式的行内部分：CSS 变量名 → 值 */
export type InlineStyles = Readonly<Record<string, string>>;

declare const DYNAMIC: unique symbol;
/**
 * 动态样式调用的结果：[样式组, 行内变量]。必须带品牌：裸元组 Readonly<[CompiledStyles, InlineStyles]> 会让
 * sx={[styles.root, { marginTopp: '_md' }]}（两项、对象值都是字符串）被当成动态样式结果而放过拼写检查。
 */
export type DynamicResult = Readonly<[CompiledStyles, InlineStyles]> & { readonly [DYNAMIC]: true };

// ---- 取值 -----------------------------------------------------------------------------------

type Sides = '' | 'Top' | 'Right' | 'Bottom' | 'Left' | 'Block' | 'Inline';
type CornerSides = '' | 'TopLeft' | 'TopRight' | 'BottomLeft' | 'BottomRight';
interface PropertyGroups {
  space:
    | `padding${Sides}`
    | `margin${Sides}`
    | 'gap'
    | 'rowGap'
    | 'columnGap'
    | 'top'
    | 'right'
    | 'bottom'
    | 'left'
    | 'inset';
  colors:
    | 'color'
    | 'backgroundColor'
    | `border${Sides}Color`
    | 'outlineColor'
    | 'fill'
    | 'stroke'
    | 'caretColor'
    | 'accentColor';
  fontSizes: 'fontSize';
  radii: `border${CornerSides}Radius`;
}

/** 属性 K 接受的 token（不在任何组里的属性得到 never） */
type TokenOf<K> = {
  [G in keyof PropertyGroups]: K extends PropertyGroups[G] ? TokenGroups[G] : never;
}[keyof PropertyGroups];

/**
 * 不以下划线开头的字符串。csstype 的开放字符串（string & {}）换成它：
 * '_mdd' 既不是登记的 token、也不匹配这里，就能报错；'1px solid red'、'var(--x)'、'#fff' 照常通过。
 * 代价：值只能是字面量，string 类型的变量不能直接写进静态样式（动态样式用 Loose 版本）。
 */
type NotToken =
  `${
    | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
    | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
    | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
    | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'
    | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
    | '#' | '-' | '.' | '+' | '(' | '"' | "'" | '@' | '%'}${string}`;

type Strict<V> = V extends string ? (string extends V ? NotToken : V) : V;

/**
 * 属性 K 的取值。只对“有 token 的属性”（padding、color…）启用 Strict：
 * NotToken 是 `a${string}` 这类模板的联合，TypeScript 会把被模板覆盖的字符串字面量从联合里删掉，
 * 关键字（'flex'、'auto'、'red'）的补全随之消失。没有 token 的属性（display、position…）保持 csstype 原样。
 */
type PropertyValue<K extends keyof RawProps> = [TokenOf<K>] extends [never]
  ? Exclude<RawProps[K], undefined>
  : Strict<Exclude<RawProps[K], undefined>> | TokenOf<K>;

/** 条件别名作键：`{ default: '_text', _selected: '_accent', ':hover': … }` */
export interface ConditionAliases {
  /** 悬停：`:hover` */
  _hover: unknown;
  /** 按下：`:active` */
  _active: unknown;
  /** 获得焦点：`:focus` */
  _focus: unknown;
  /** 键盘聚焦：`:focus-visible` */
  _focusVisible: unknown;
  /** 不可用：`:disabled`、`aria-disabled="true"` */
  _disabled: unknown;
  /** 选中：`aria-selected="true"` */
  _selected: unknown;
  /** 勾选：`:checked` */
  _checked: unknown;
  /** 展开：`aria-expanded="true"` */
  _expanded: unknown;
  /** 深色模式 */
  _dark: unknown;
}

type Condition = `:${string}` | `@${string}` | `[${string}]`;

/** 一个属性的取值：普通值、回退值数组、按条件取值（必须有 default，条件可嵌套） */
export type StyleValue<V> = V | ReadonlyArray<V> | ConditionalValue<V>;
export interface ConditionalValue<V> extends AliasValues<V> {
  /** 不满足任何条件时的值 */
  readonly default: StyleValue<V>;
  readonly [condition: Condition]: StyleValue<V>;
}
type AliasValues<V> = { readonly [Alias in keyof ConditionAliases]?: StyleValue<V> };

type RawProps = CSS.Properties<string & {} | number>;
type CustomProps = { readonly [name: `--${string}`]: string | number };

/**
 * 静态样式的一组属性：拼错属性名、拼错 token、用错组的 token 都报错。
 * 不带 `--x` 自定义属性的索引签名：有索引签名就不再是“弱类型”，
 * 非字面量的对象（变量、数组元素里被推成联合的）就失去“没有任何共同属性”的检查。自定义属性走 defineVars 或动态样式。
 */
export type StyleObject = {
  readonly [K in keyof RawProps]?: StyleValue<PropertyValue<K>>;
};

/** 动态样式返回的属性：值在运行时才知道，接受任意字符串（不校验 token） */
export type LooseStyleObject = {
  readonly [K in keyof RawProps]?: StyleValue<Exclude<RawProps[K], undefined> | TokenOf<K>>;
} & CustomProps;

// ---- sx -----------------------------------------------------------------------------------

type StyleArray<T> = T | ReadonlyArray<StyleArray<T>>;

/** sx 的取值：样式组、动态样式的结果、假值、对象字面量，以及它们的嵌套数组 */
export type SxStyles = StyleArray<
  null | undefined | boolean | CompiledStyles | DynamicResult | StyleObject
>;

// ---- css.create --------------------------------------------------------------------------------

type DynamicStyle = (...args: never[]) => LooseStyleObject;

type MapStyles<S> = Readonly<{
  [Name in keyof S]: S[Name] extends (...args: infer Args) => unknown
    ? (...args: Args) => DynamicResult
    : CompiledStyles;
}>;

// ---- css.recipe --------------------------------------------------------------------------------

/** 每个部件的样式（可以只写其中几个） */
export type PartStyles<P extends string> = { readonly [Part in P]?: StyleObject };

/** 取值的键是 'true' / 'false' 时，调用侧收 boolean */
type ValueOf<K> = K extends 'true' | 'false' ? boolean : K;
export type VariantSelection<V> = {
  [Name in keyof V]?: ValueOf<keyof V[Name]> | null | undefined;
};

export interface RecipeConfig<P extends string, V> {
  /** 组件名：部件的 data-scope */
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

export declare namespace css {
  /**
   * 定义一组样式：静态的写对象，动态的写函数 `(w: string) => ({ width: w })`。
   * 参数类型是对 S 的映射：静态条目直接对着 StyleObject 检查（字面量保持“新鲜”，拼错的属性报未知属性，
   * 错误落在出错的属性上）；写成 `styles: S` 再靠 extends 约束的话，拼错的属性会漏过。
   * 不用重载：两个重载都失败时报的是“没有匹配的重载”，落在 css.create 上，信息也长。
   */
  function create<const S extends { readonly [name: string]: StyleObject | DynamicStyle }>(styles: {
    readonly [N in keyof S]: S[N] extends DynamicStyle ? S[N] : StyleObject;
  }): MapStyles<S>;
  function recipe<const P extends string, V = {}>(config: RecipeConfig<P, V>): Recipe<P, V>;
}
