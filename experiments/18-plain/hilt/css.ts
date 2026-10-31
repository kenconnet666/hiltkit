// 样式入口：引擎本身不变。sx 数组里的函数换成 select：依赖变了只换这一项
import { markServerRendered, select } from '@hilt/css/abi';
import { recipe as engineRecipe } from '@hilt/css';
import { registerStyles } from './index';
import type { Recipe, RecipeConfig } from './types/css';

// 签名在 types/css/：引擎模块的声明（kernel.d.ts）引用它们，这里原样导出；登记处 TokenSets、ConditionSets 也从这里导出
// 引擎的 when 改名 relation：和 hilt 的 when 常写在同一个文件里
export {
  configure,
  create,
  createTheme,
  defineConditions,
  defineMarker,
  defineTokens,
  defineVars,
  keyframes,
  provideStyles,
  renderStyleTag,
  themeBootClasses,
  themeBootScript,
  themeStyle,
  useRecipe,
  when as relation,
} from '@hilt/css';
export type * from './types/css';

const prepare = (value: unknown): unknown => {
  if (typeof value === 'function') return select(value as () => never);
  if (Array.isArray(value) && !Object.getOwnPropertySymbols(value).length) return value.map(prepare);
  return value;
};
registerStyles({ prepare, onHydrate: markServerRendered });

/** 引擎靠访问器判断档位是不是活的：这里把读取函数换成访问器，档位可以直接传 sig 或解构出来的 prop */
const liveSelection = (selection: Record<string, unknown> | undefined) => {
  if (!selection) return selection;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(selection)) {
    const descriptor = Object.getOwnPropertyDescriptor(selection, key)!;
    // 已经是访问器的原样留着，读一次就不活了
    if (descriptor.get) Object.defineProperty(out, key, descriptor);
    else if (typeof descriptor.value === 'function') Object.defineProperty(out, key, { enumerable: true, get: descriptor.value });
    else out[key] = descriptor.value;
  }
  return out;
};
export const recipe = <const P extends string, V = {}>(config: RecipeConfig<P, V>): Recipe<P, V> => {
  const inner = engineRecipe(config);
  const wrapped = (selection?: Record<string, unknown>, ...extensions: unknown[]) => inner(liveSelection(selection), ...extensions);
  // 部件名、热更新用的标记都留在外层
  for (const key of Reflect.ownKeys(inner)) {
    if (key === 'length' || key === 'prototype') continue;
    Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(inner, key)!);
  }
  return wrapped as unknown as Recipe<P, V>;
};
