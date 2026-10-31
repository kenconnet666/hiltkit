// 样式引擎的入口：组件库和应用都从这里拿
import * as runtime from '../04-css/engine/runtime';
import { recipe } from '../04-css/engine/recipe';

export const css = { ...runtime, recipe };
export { recipe };
export { hotStyles } from '../04-css/engine/hot';
