/**
 * 开发期热更新：没有编译魔法，开发插件（`hiltkit/vite` 的 hiltHot）只在文件末尾登记导出的组件。
 * 同一个 id 再次登记就换函数，并让所有实例重建；上层和兄弟不动，所以状态保留。
 */
import { signal, type SignalNode } from '../reactivity/kernel';

const hotRecords = new Map<string, { current: any; version: SignalNode<number> }>();
/** 开发插件生成：hotRegister('文件#组件名', 组件) */
export function hotRegister(id: string, fn: any): void {
  const existing = hotRecords.get(id);
  if (!existing) {
    const record = { current: fn, version: signal(0) };
    hotRecords.set(id, record);
    fn.$$hot = record;
    return;
  }
  existing.current = fn;
  fn.$$hot = existing;
  existing.version.value++;
}
