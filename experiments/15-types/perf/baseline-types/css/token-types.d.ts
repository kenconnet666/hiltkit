/**
 * token 短写的类型：从登记处（TokenSets）算出每组有哪些名字，再用模板字面量加上下划线前缀。
 * 这是“模板字面量联合”版；perf/variants/token-types-plain.d.ts 是手写字面量的“普通联合”版，用于成本对比。
 */
import type { TokenSets } from '@hilt/css/registry';
import type { TokenGroupName } from '@hilt/css/property-groups';

type NamesOf<Group extends string> = {
  [Set in keyof TokenSets]: TokenSets[Set] extends { readonly [G in Group]: infer Tokens } ? keyof Tokens & string : never;
}[keyof TokenSets];

/** 某组的短写：`_md`、`_accent` */
export type ShortTokens<Group extends TokenGroupName> = `_${NamesOf<Group>}`;

/** 带组名的写法，可跨组取值：`_space.md` */
export type QualifiedTokens = {
  [Set in keyof TokenSets]: {
    [Group in keyof TokenSets[Set] & string]: `_${Group}.${keyof TokenSets[Set][Group] & string}`;
  }[keyof TokenSets[Set] & string];
}[keyof TokenSets];
