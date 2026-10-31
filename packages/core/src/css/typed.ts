/**
 * 引擎函数配上对外的精确类型。
 *
 * 引擎内部的类型是宽松的（样式对象在运行时什么都可能是），面向使用者的签名在 `types/css/`：
 * 属性值、token、条件键都能补全和报错。这里是两者的接缝，运行时就是引擎本身。
 */
import type * as Config from '../types/css/config';
import type * as Styles from '../types/css/styles';
import type * as Theme from '../types/css/theme';
import * as engine from './engine';

export const configure = engine.configure as unknown as typeof Config.configure;
export const create = engine.create as unknown as typeof Styles.create;
export const createTheme = engine.createTheme as unknown as typeof Theme.createTheme;
export const defineConditions = engine.defineConditions as unknown as typeof Theme.defineConditions;
export const defineMarker = engine.defineMarker as unknown as typeof Theme.defineMarker;
export const defineTokens = engine.defineTokens as unknown as typeof Theme.defineTokens;
export const defineVars = engine.defineVars as unknown as typeof Theme.defineVars;
export const keyframes = engine.keyframes as unknown as typeof Styles.keyframes;
export const provideStyles = engine.provideStyles as unknown as typeof Styles.provideStyles;
export const renderStyleTag = engine.renderStyleTag as unknown as typeof Config.renderStyleTag;
export const themeBootClasses = engine.themeBootClasses as unknown as typeof Theme.themeBootClasses;
export const themeBootScript = engine.themeBootScript as unknown as typeof Theme.themeBootScript;
export const themeStyle = engine.themeStyle as unknown as typeof Theme.themeStyle;
export const useRecipe = engine.useRecipe as unknown as typeof Styles.useRecipe;
export const when = engine.when as unknown as typeof Theme.relation;
