/**
 * sx 里一项的取值 → 参与组合的片段与行内变量。attrs（渲染时）、select（元素上的 effect 里）共用。
 */
import { declarations, type StyleObject } from './declarations';
import {
  BINDING,
  CLASS,
  DYNAMIC,
  EVALUATE,
  FRAGMENT,
  fragment,
  type Binding,
  type Fragment,
  type StylePart,
} from './fragment';

/** 直接写的样式对象（`sx={{ marginTop: '_md' }}`）→ 片段 */
const literalByObject = new WeakMap<object, Fragment>();
const literalByContent = new Map<string, Fragment>();
/** 按内容最多记住多少个（值一直在变的写法会不断出新内容，不无限增长；记不住时重新展开，规则照旧只插一次） */
const LITERAL_LIMIT = 512;

/**
 * 冻住的对象（编译器把静态字面量提到模块顶层并冻住）按对象记住；其余的按内容记住——
 * 活对象（里面有访问器，内容随状态变）、每次渲染新建的对象都不能按身份缓存
 */
export function literal(value: object): Fragment {
  const frozen = Object.isFrozen(value);
  let result = frozen ? literalByObject.get(value) : undefined;
  if (result) return result;
  const key = JSON.stringify(value);
  result = literalByContent.get(key);
  if (!result) {
    if (literalByContent.size >= LITERAL_LIMIT) literalByContent.clear();
    literalByContent.set(key, (result = fragment(declarations(value as StyleObject), undefined, true)));
  }
  if (frozen) literalByObject.set(value, result);
  return result;
}

/**
 * 一项取值展开进 out（片段、固定类）与 inline（行内变量）：假值不选；数组展开；
 * [片段, 变量] 是动态样式的结果；绑定在这里当场求值（调用者在 effect 里时读到的状态被追踪）；
 * 其余对象当样式对象直接写的字面量
 */
export function collectParts(value: unknown, out: StylePart[], inline: Record<string, string>) {
  if (!value || typeof value !== 'object') return;
  if (BINDING in value) {
    const binding = value as Binding;
    const result = binding.style[EVALUATE](binding.args());
    out.push(...result.parts);
    Object.assign(inline, result.inline);
  } else if (Array.isArray(value)) {
    if (DYNAMIC in value) {
      out.push(value[0] as StylePart);
      Object.assign(inline, value[1]);
    } else for (const item of value) collectParts(item, out, inline);
  } else out.push(FRAGMENT in value || CLASS in value ? (value as StylePart) : literal(value));
}
