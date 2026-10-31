/**
 * token 短写的类型：从登记处（TokenSets）算出每组有哪些名字，再用模板字面量加上下划线前缀。
 * 这是“模板字面量联合”版；perf/variants/token-types-plain.d.ts 是手写字面量的“普通联合”版，用于成本对比。
 */
import type { TokenSets } from './registry';
import type { TokenGroupName } from './property-groups';

type NamesOf<Group extends string> = {
  [Set in keyof TokenSets]: TokenSets[Set] extends { readonly [G in Group]: infer Tokens }
    ? keyof Tokens & string
    : never;
}[keyof TokenSets];

/** 某组的短写：`_md`、`_accent` */
export type ShortTokens<Group extends TokenGroupName> = `_${NamesOf<Group>}`;

/**
 * 带组名的写法，可跨组取值：`_space.md`。只校验组名、不校验组里的 token 名：
 * 把全部 `_组.名` 列成字面量联合，每个有 token 的属性的补全里会多出几十项带组名的条目（排在 `_md` 之前，盖住短写），
 * 用模式 `_space.${string}` 补全里不出现，写错 token 名在运行时第一次用到时报错（引擎的 resolveToken）。
 */
export type QualifiedTokens = `_${TokenGroupName}.${string}`;
