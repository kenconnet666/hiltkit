/**
 * create：一组命名空间 → 片段（声明表）。命名空间第一次被读时才展开（惰性）；函数是动态样式。
 * 片段不插规则：规则在片段第一次出现在某个元素的 sx 里时才插（attrs → compose）。
 */
import './register';
import { cssValue, dashify, declarations, type Leaf, type StyleObject } from './declarations';
import { dynamic } from './dynamic';
import { fragment } from './fragment';
import { hash, insert, isInserted } from './sheet';

/**
 * css.create：写法同 StyleX。`label` 是开发模式的可读名字（进组合类的类名）
 */
export function create<S extends Record<string, unknown>>(namespaces: S, label?: string): S {
  const result: Record<string, unknown> = {};
  for (const [name, namespace] of Object.entries(namespaces)) {
    const full = label ? `${label}.${name}` : undefined;
    if (typeof namespace === 'function') {
      result[name] = dynamic(namespace as (...args: never[]) => StyleObject, full);
      continue;
    }
    Object.defineProperty(result, name, {
      enumerable: true,
      configurable: true,
      get() {
        const value = fragment(declarations(namespace as StyleObject), full);
        Object.defineProperty(result, name, { value, enumerable: true, configurable: true });
        return value;
      },
    });
  }
  return result as S;
}

/** keyframes：返回动画名，规则第一次调用时插入 */
export function keyframes(frames: Record<string, StyleObject>): string {
  const body = Object.entries(frames)
    .map(
      ([step, declarations]) =>
        `${step}{${Object.entries(declarations)
          .filter(([, value]) => value !== null && value !== undefined)
          .map(([property, value]) => `${dashify(property)}:${cssValue(property, value as Leaf)}`)
          .join(';')}}`,
    )
    .join('');
  const name = `k${hash(body)}`;
  if (!isInserted(name)) insert(name, [`@keyframes ${name}{${body}}`]);
  return name;
}
