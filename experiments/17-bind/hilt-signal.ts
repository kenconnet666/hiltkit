// 方案二用：函数形态的壳
import { omit, propsView } from '@hilt/runtime';
import { derived, sig, sigModel, type ReadSignal, type Signal } from './hilt';

export { derived, sig, sigModel };
export type { ReadSignal, Signal };
const IS_REF = Symbol.for('hilt.ref');
export function sigWritable<T>(read: () => T, write: (value: T) => void): Signal<T> {
  const self = (() => read()) as any;
  self.set = write;
  self.update = (change: (value: T) => T) => write(change(read()));
  self[IS_REF] = true;
  return self;
}
/** 普通函数组件取 rest：要自己写键名，schema 方案不用 */
export const omit2 = (props: any, keys: string[]) => propsView(omit(props, new Set(keys)));
