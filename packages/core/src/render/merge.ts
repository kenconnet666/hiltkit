/**
 * 属性合并：组件把外面传来的 rest 和自己的属性合起来。
 * 对象展开只会覆盖；class 拼接、事件都执行、函数值落回下层这些要靠 merge。
 */
import { isEventKey } from '../attrs/rules';
import { devHooks } from '../reactivity/kernel';
import { isSig, read } from '../reactivity/sig';

type Intersect<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Tail]
  ? Head & Intersect<Tail>
  : unknown;

/** 靠后的优先。class、sx、style 累加，事件都执行（靠后的先，preventDefault 后下层跳过），ref 都给 */
export function merge<const T extends readonly (object | null | undefined | false)[]>(
  ...sources: T
): Intersect<{ [K in keyof T]: Exclude<T[K], null | undefined | false> }>;
export function merge(...sources: any[]): any {
  const out: any = {};
  for (const source of sources) {
    if (!source) continue;
    // 动态键层跟着合并走：组件转发 rest 时不能丢
    for (const symbol of Object.getOwnPropertySymbols(source)) out[symbol] = source[symbol];
    for (const key of Object.keys(source)) {
      const value = source[key];
      if (value === undefined) continue;
      const previous = out[key];
      if (previous === undefined) out[key] = value;
      else if (key === 'class') out.class = [previous, value];
      else if (key === 'sx') out.sx = [previous, value];
      // 保留各层，落到元素上时由规则表按属性合并：字符串切分、大小写、undefined 落回都只有一份实现
      else if (key === 'style') out.style = [previous, value];
      else if (key === 'ref')
        out.ref = (el: unknown) => (applyRef(previous, el), applyRef(value, el));
      else if (isEventKey(key)) {
        // 靠后的先执行，preventDefault 之后下层跳过
        out[key] = (event: Event) => {
          value(event);
          if (!event.defaultPrevented) previous(event);
        };
      } else if (typeof value === 'function' && !isSig(value)) {
        out[key] = () => {
          const top = value();
          return top === undefined ? read(previous) : top;
        };
      } else out[key] = value;
    }
  }
  devHooks?.merged(out);
  return out;
}
const applyRef = (ref: any, el: unknown) => (isSig(ref) ? ref.set(el) : ref?.(el));
