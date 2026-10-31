// 样式引擎的类型：kernel.d.ts 里的声明是宽松的（create、recipe 都返回 any），这里按 10-css/engine 的真实签名收紧。
// recipe 额外让档位取值收 Prop：传读取函数就是活的。引擎只认访问器，所以在这里转一次；理想情况是引擎自己收 Prop。
import { create as engineCreate, recipe as engineRecipe } from 'hilt/css';
import type { Prop } from 'hilt';

export { renderStyleTag } from 'hilt/css';

/** 同 10-css/engine/create.ts：返回值就是传入的形状，styles.root 能查到，styles[key] 的 key 能被约束 */
export const create: <S extends Record<string, unknown>>(namespaces: S, label?: string) => S = engineCreate;

type PartStyles<P extends string> = Partial<Record<P, object>>;
type Variants<P extends string> = Record<string, Record<string, PartStyles<P>>>;
/** 取值的键是 'true' / 'false' 时，调用侧收 boolean */
type ValueOf<K> = K extends 'true' | 'false' ? boolean : K;
type Picked<V> = { [Name in keyof V]?: ValueOf<keyof V[Name]> };

export interface RecipeConfig<P extends string, V extends Variants<P>> {
  name?: string;
  parts: readonly P[];
  base?: PartStyles<P>;
  variants?: V;
  compound?: readonly ({ when: Picked<V> } & PartStyles<P>)[];
  defaults?: Picked<V>;
}
/** 一个部件的属性包：展开到元素上 */
export interface PartProps {
  readonly sx: readonly unknown[];
  readonly 'data-scope': string;
  readonly 'data-part': string;
}
/** 档位取值：值或读取函数，可以是 null / undefined（用默认值） */
export type Selection<V> = { [Name in keyof V]?: Prop<ValueOf<keyof V[Name]> | null | undefined> };

/** 读取函数换成访问器：引擎靠“有访问器”判断档位是活的 */
function withGetters(selection: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(selection)) {
    if (typeof value === 'function') Object.defineProperty(out, name, { get: value as () => unknown, enumerable: true });
    else out[name] = value;
  }
  return out;
}

export function recipe<const P extends string, const V extends Variants<P> = {}>(config: RecipeConfig<P, V>) {
  const resolve = engineRecipe(config);
  return (selection: Selection<V> = {}): Readonly<Record<P, PartProps>> => resolve(withGetters(selection as Readonly<Record<string, unknown>>));
}
