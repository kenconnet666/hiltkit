/**
 * @hilt/css 的入口。登记处（TokenSets、ConditionSets、ConditionAliases）从这里再导出，
 * 应用用 `declare module '@hilt/css' { interface TokenSets { … } }` 登记。
 */
export type { TokenSets, ConditionSets, ConditionAliases } from '@hilt/css/registry';
export type { ConditionName } from '@hilt/css/conditions';
export type { InlineProperties, SxProperties } from '@hilt/css/properties';
export type { Condition, ConditionalValue, LooseStyleObject, StyleObject, StyleValue } from '@hilt/css/values';
export type {
  CompiledStyles,
  DynamicResult,
  PartAttrs,
  PartStyles,
  Recipe,
  RecipeConfig,
  SxStyles,
  VariantSelection,
} from '@hilt/css/styles';
export type { TokenInput, TokenSet, TokenValue, VarGroup } from '@hilt/css/theme';
export { create, recipe } from '@hilt/css/styles';
export { createTheme, defineConditions, defineTokens, defineVars, themeStyle } from '@hilt/css/theme';
