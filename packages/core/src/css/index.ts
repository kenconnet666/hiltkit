/**
 * 样式入口 `hiltkit/css`：写法同 StyleX，实现同 Emotion、Griffel（运行时生成类）。
 *
 * 引擎本身在同目录（模块分工见 `engine.ts`），这里只做两件接到框架的事：
 *   - sx 数组里的函数换成引擎的 select：依赖变了只换这一项
 *   - recipe 的档位可以直接传读取函数（sig 或解构出来的 prop）
 * 引擎的 when 改名 relation：和框架的 when 常写在同一个文件里。
 */
import { registerStyles } from '../render/props';
import type { Recipe, RecipeConfig } from '../types/css';
import { select } from './dynamic';
import { recipe as engineRecipe } from './engine';
import { markServerRendered } from './sheet';

// 签名在 types/css/：类型比引擎的实现更精确，登记处 TokenSets、ConditionSets 也从这里导出
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
} from './typed';
export type * from '../types/css';

const prepare = (value: unknown): unknown => {
  if (typeof value === 'function') return select(value as () => never);
  if (Array.isArray(value) && !Object.getOwnPropertySymbols(value).length)
    return value.map(prepare);
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
    else if (typeof descriptor.value === 'function') {
      Object.defineProperty(out, key, { enumerable: true, get: descriptor.value });
    } else out[key] = descriptor.value;
  }
  return out;
};
/** 多部件、多档位的组件样式。档位可以传值，也可以传读取函数 */
export const recipe = <const P extends string, V = {}>(
  config: RecipeConfig<P, V>,
): Recipe<P, V> => {
  const inner: any = engineRecipe(config as never);
  const wrapped = (selection?: Record<string, unknown>, ...extensions: unknown[]) =>
    inner(liveSelection(selection), ...extensions);
  // 部件名、热更新用的标记都留在外层
  for (const key of Reflect.ownKeys(inner)) {
    if (key === 'length' || key === 'prototype') continue;
    Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(inner, key)!);
  }
  return wrapped as unknown as Recipe<P, V>;
};
