/**
 * 样式的热更新原地生效：编译器把顶层的 create / recipe 包上 hotStyles（compiler/style-hot.ts），
 * 模块重新执行时新内容写进旧对象，用到的组合类按原类名改写规则，组件不重新渲染。
 */
import { FRAGMENT, isFragment, replaceFragment } from './fragment';

/** 配方等自己管理状态的样式对象实现它：拿到同一 id 的新对象时把自己原地换成新的 */
export const HOT = Symbol('style hot');
const hotObjects = new Map<string, object>();

/**
 * 编译器包在顶层 `const 名 = css.create(…)` / `recipe(…)` 外面（开发服务器，compiler/style-hot.ts）：
 * 第一次登记；模块热更新重新执行时把新内容写进旧对象并返回旧对象——导入方手里拿的还是它，
 * 已插入的规则按原类名改写，组件不用重新渲染
 */
export function hotStyles<T extends object>(id: string, value: T): T {
  const previous = hotObjects.get(id) as T | undefined;
  if (!previous) {
    hotObjects.set(id, value);
    return value;
  }
  if (HOT in previous) (previous as { [HOT]: (next: T) => void })[HOT](value);
  else hotUpdate(previous as Record<string, unknown>, value as Record<string, unknown>);
  return previous;
}

/** create 的结果原地换成新的：已展开的片段换声明表并改写用到它的规则；动态样式、新加的命名空间直接换上 */
export function hotUpdate(previous: Record<string, unknown>, next: Record<string, unknown>) {
  for (const name of Object.keys(next)) {
    const value = next[name];
    const current = Object.getOwnPropertyDescriptor(previous, name);
    if (current && !current.get && isFragment(current.value) && isFragment(value)) {
      replaceFragment(current.value, value[FRAGMENT]);
    } else {
      Object.defineProperty(previous, name, { value, enumerable: true, configurable: true });
    }
  }
}
