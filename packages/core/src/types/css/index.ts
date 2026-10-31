// hiltkit/css 的类型入口（只有类型）。登记处（TokenSets、ConditionSets）从 hiltkit/css 再导出，应用用 `declare module 'hiltkit/css' { … }` 登记。
// 函数的签名在 styles.ts、theme.ts、config.ts，由 css/typed.ts 引用，hiltkit/css 再原样导出。
export type { TokenSets, ConditionSets, ConditionAliases } from './registry';
export type { ConditionName } from './conditions';
export type { InlineProperties, SxProperties } from './properties';
export type {
  Condition,
  ConditionalValue,
  LooseStyleObject,
  StyleObject,
  StyleValue,
} from './values';
export type {
  CompiledStyles,
  DynamicResult,
  PartAttrs,
  PartStyles,
  Recipe,
  RecipeConfig,
  RecipeExtension,
  SxStyles,
  VariantSelection,
  VariantValues,
} from './styles';
export type { Marker, TokenInput, TokenSet, TokenValue, VarGroup } from './theme';
export type { EngineConfig, StyleTagOptions } from './config';
