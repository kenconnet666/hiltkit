/** 性能对照用的“简单版”样式类型：对象随便写，不校验属性与 token */
declare const COMPILED: unique symbol;
export interface CompiledStyles {
  readonly [COMPILED]: true;
}
export type InlineStyles = Readonly<Record<string, string>>;
export type StyleObject = Readonly<Record<string, unknown>>;
type StyleArray<T> = T | ReadonlyArray<StyleArray<T>>;
export type SxStyles = StyleArray<null | undefined | boolean | CompiledStyles | StyleObject>;

export interface PartAttrs {
  readonly sx: SxStyles;
  readonly 'data-scope': string;
  readonly 'data-part': string;
}
export declare namespace css {
  function create<const S extends Record<string, StyleObject | ((...args: never[]) => StyleObject)>>(
    styles: S,
  ): { readonly [N in keyof S]: S[N] extends (...args: infer A) => unknown ? (...args: A) => CompiledStyles : CompiledStyles };
  function recipe<const P extends string>(config: {
    name?: string;
    parts: readonly P[];
    base?: Partial<Record<P, StyleObject>>;
    variants?: Record<string, Record<string, Partial<Record<P, StyleObject>>>>;
    defaults?: Record<string, unknown>;
  }): (selection?: Record<string, unknown>) => { readonly [Part in P]: PartAttrs };
}
