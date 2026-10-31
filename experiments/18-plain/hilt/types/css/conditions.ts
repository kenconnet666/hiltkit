/**
 * 条件别名的名字集合：内置别名 + defineConditions 登记的别名。
 */
import type { ConditionAliases, ConditionSets } from './registry';

type RegisteredConditionName = {
  [Set in keyof ConditionSets]: keyof ConditionSets[Set] & string;
}[keyof ConditionSets];

export type ConditionName = keyof ConditionAliases | RegisteredConditionName;
