/**
 * 样式取值的类型：一个属性能写什么（普通值、回退数组、按条件取值），token 短写按属性所在的组补全并校验。
 */
import type { PropertyGroupOf } from './property-groups';
import type { SxProperties } from './properties';
import type { QualifiedTokens, ShortTokens } from './token-types';
import type { ConditionName } from './conditions';

type RawProps = SxProperties;

/**
 * 不以下划线开头的字符串。csstype 的开放字符串（string & {}）换成它：
 * '_mdd' 既不是登记的 token、也不匹配这里，就能报错；'1px solid red'、'var(--x)'、'#fff' 照常通过。
 * 代价：值只能是字面量，string 类型的变量不能直接写进静态样式（动态样式用 LooseStyleObject）；
 * 模板覆盖到的关键字（'auto'）会从补全里消失，但仍然合法。
 */
type NotToken = `${
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z'
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '#'
  | '-'
  | '.'
  | '+'
  | '('
  | '"'
  | "'"
  | '@'
  | '%'}${string}`;

type Strict<V> = V extends string ? (string extends V ? NotToken : V) : V;

/**
 * 属性 K 的取值。只对“有 token 的属性”（padding、color…）启用 Strict；其他属性保持 csstype 原样。
 * 有 token 的属性：该组的短写（'_md'）+ 带组名的写法（'_space.md'，可跨组）。
 */
type PropertyValue<K extends keyof RawProps> = K extends keyof PropertyGroupOf
  ? Strict<Exclude<RawProps[K], undefined>> | ShortTokens<PropertyGroupOf[K]> | QualifiedTokens
  : Exclude<RawProps[K], undefined>;

/** 动态样式里的取值：不校验 token（值在运行时才知道），任何字符串都收 */
type LooseValue<K extends keyof RawProps> =
  | Exclude<RawProps[K], undefined>
  | (K extends keyof PropertyGroupOf ? ShortTokens<PropertyGroupOf[K]> : never);

// ---- 条件 ----------------------------------------------------------------------------------

/** 条件键：伪类、@ 规则、属性选择器。别名（_hover、_selected…）见 ConditionAliases */
export type Condition = `:${string}` | `@${string}` | `[${string}]`;

/** 一个属性的取值：普通值、回退值数组、按条件取值（必须有 default，条件可嵌套） */
export type StyleValue<V> = V | ReadonlyArray<V> | ConditionalValue<V>;
export interface ConditionalValue<V> extends AliasValues<V> {
  /** 不满足任何条件时的值 */
  readonly default: StyleValue<V>;
  readonly [condition: Condition]: StyleValue<V>;
}
type AliasValues<V> = { readonly [Alias in ConditionName]?: StyleValue<V> };

// ---- 对象 ----------------------------------------------------------------------------------

/**
 * 静态样式的一组属性：拼错属性名、拼错 token、用错组的 token 都报错。
 * 不带 `--x` 自定义属性的索引签名：有索引签名就不再是“弱类型”，
 * 非字面量的对象（变量、数组元素里被推成联合的）就失去“没有任何共同属性”的检查。自定义属性走 defineVars 或动态样式。
 */
export type StyleObject = {
  readonly [K in keyof RawProps]?: StyleValue<PropertyValue<K>>;
} & { readonly [Element in PseudoElement]?: StyleObject };

/**
 * 伪元素的样式块：`'::backdrop': { backgroundColor: '_overlay' }`。
 * 逐个列出而不是写成 `::${string}` 索引签名，理由同上。
 */
export type PseudoElement =
  | '::before'
  | '::after'
  | '::backdrop'
  | '::placeholder'
  | '::selection'
  | '::marker'
  | '::first-line'
  | '::first-letter'
  | '::file-selector-button'
  | '::-webkit-scrollbar'
  | '::-webkit-scrollbar-thumb'
  | '::-webkit-scrollbar-track';

/** 动态样式返回的属性：值在运行时才知道，接受任意字符串；允许 `--x` 自定义属性 */
export type LooseStyleObject = {
  readonly [K in keyof RawProps]?: StyleValue<LooseValue<K>>;
} & { readonly [name: `--${string}`]: string | number };
