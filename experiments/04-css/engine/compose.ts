/**
 * 一个元素的样式组合成类：片段合成一个组合类，固定类（主题、标记）原样挂上。
 * attrs 渲染时用它；元素上的绑定换了其中一段时也用它就地算出新类（bindings.ts）。
 */
import { CLASS, composite, FRAGMENT, type ClassStyle, type Fragment } from './fragment';

/** 组合的结果：交给元素的 class（没有样式时为空对象） */
export type Composed = Readonly<{ class?: string }>;

/** 组合缓存：按参与的对象（片段、主题、标记）逐层索引 */
interface CacheNode {
  next?: WeakMap<object, CacheNode>;
  result?: Composed;
}
const cache: CacheNode = {};

/**
 * 一组样式（按书写顺序）→ 元素的类。按参与的对象逐层查缓存，命中时不拼字符串、不算哈希，
 * 同样的组合返回同一个结果对象（Vue 比对 class 相同就不碰 DOM）
 */
export function compose(parts: readonly object[]): Composed {
  let node = cache;
  for (const part of parts) {
    node.next ??= new WeakMap();
    let child = node.next.get(part);
    if (!child) node.next.set(part, (child = {}));
    node = child;
  }
  return (node.result ??= resolve(parts));
}

/** 缓存没命中：片段合成一个类；固定类（主题、标记）按去重键后者覆盖前者 */
function resolve(parts: readonly object[]): Composed {
  const fragments: Fragment[] = [];
  const fixed = new Map<string, string>();
  for (const part of parts) {
    if (FRAGMENT in part) fragments.push(part as Fragment);
    else if (CLASS in part) {
      const [key, className] = (part as ClassStyle)[CLASS];
      fixed.delete(key);
      fixed.set(key, className);
    } else throw new Error('attrs：不认识的样式，只收 create、createTheme、defineMarker 的结果');
  }
  const classes = [fragments.length ? composite(fragments) : '', ...fixed.values()].filter(Boolean);
  return Object.freeze(classes.length ? { class: classes.join(' ') } : {});
}
