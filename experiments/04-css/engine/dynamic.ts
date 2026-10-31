/**
 * 动态样式（create 里写成函数的命名空间）与响应式绑定：css.bind 绑定动态样式的参数，css.select 绑定选哪段样式。
 */
import { eachLeaf, tableOf, type LeafEntry, type StyleObject } from './declarations';
import {
  BINDING,
  CLASS,
  DYNAMIC,
  EVALUATE,
  FRAGMENT,
  fragment,
  type Binding,
  type DynamicStyle,
  type Evaluated,
  type Evaluator,
  type Fragment,
  type StylePart,
} from './fragment';
import { hash, variablesOnly } from './sheet';

/**
 * 动态样式的变量名：按属性与条件（同 StyleX 的 --x-属性）。不注册 @property：类里引用变量的元素，
 * 自己的行内一定写着这个变量（同一次求值产出类与值），不会用到祖先继承下来的值；注册反而让样式重算慢 15–20%
 */
const dynamicVar = (property: string, chain: readonly string[]) =>
  chain.length ? `--x-${property}-${hash(chain.join(''))}` : `--x-${property}`;

/**
 * 动态样式：一直没变过的属性直接写进类里（多半是常量，同手写，元素上不挂变量）；
 * 值一旦和第一次不同，这个属性就永久转成变量（类里写 var(--x-属性)、值进行内样式）。
 * 一个动态命名空间最多产生“属性数 + 1”种类，不随取值增长；转成变量之后值怎么变类都不变。
 * StyleX 把动态命名空间的属性一律变成行内变量，每个元素多挂几个，样式重算更慢。
 * 响应式绑定遇到“这个属性刚开始变”（类还是写死的那种）时就地换成变量版的类（bindings.ts），之后只改变量
 */
export function dynamic(factory: (...args: never[]) => StyleObject): DynamicStyle {
  const first = new Map<string, string>();
  const varying = new Set<string>();
  const shapes = new Map<string, Fragment>();
  // 参数都是原始值时按参数记住结果：重新渲染、绑定的 effect 重跑时同样的参数不再调用工厂、展开声明。
  // 有属性新转成变量时结果会变，清空；条目太多（连续变化的值）时也清空，不无限增长
  const memo = new Map<string, Evaluated>();
  const evaluate = (args: readonly unknown[]): Evaluated => {
    const key = memoKey(args);
    const hit = key === undefined ? undefined : memo.get(key);
    if (hit) return hit;
    const before = varying.size;
    const result = compute(args);
    if (varying.size !== before || memo.size >= MEMO_LIMIT) memo.clear();
    if (key !== undefined) memo.set(key, result);
    return result;
  };
  const compute = (args: readonly unknown[]): Evaluated => {
    const inline: Record<string, string> = {};
    const leaves: LeafEntry[] = [];
    let shape = '';
    // 服务端渲染与它的水合一律写成变量（见 variablesOnly），两边出同样的类
    const always = variablesOnly();
    eachLeaf(factory(...(args as never[])), (leaf) => {
      const key = leaf.chain.length ? `${leaf.property}\0${leaf.chain.join('\0')}` : leaf.property;
      const text = leaf.texts?.join(', ') ?? '';
      const seen = first.get(key);
      if (seen === undefined) first.set(key, text);
      else if (seen !== text) varying.add(key);
      if (!leaf.texts || (!always && !varying.has(key))) {
        shape += `${key}=${text};`;
        leaves.push(leaf);
        return;
      }
      const variable = dynamicVar(leaf.property, leaf.chain);
      inline[variable] = text;
      shape += `${key};`;
      leaves.push({ ...leaf, texts: [`var(${variable})`] });
    });
    let shared = shapes.get(shape);
    if (!shared) shapes.set(shape, (shared = fragment(tableOf(leaves))));
    return { part: shared, inline };
  };
  const style = (...args: never[]) => {
    const { part, inline } = evaluate(args);
    const result = [part, inline] as const;
    Object.defineProperty(result, DYNAMIC, { value: true });
    return result;
  };
  return Object.assign(style, { [EVALUATE]: evaluate });
}

/** 每个动态样式最多记住多少组参数的结果 */
const MEMO_LIMIT = 512;

/** 参数都是原始值时的记忆键（带上类型，1 与 '1' 不同）；有对象参数时不记忆 */
function memoKey(args: readonly unknown[]): string | undefined {
  let key = '';
  for (const arg of args) {
    const type = typeof arg;
    if (
      arg !== null &&
      type !== 'string' &&
      type !== 'number' &&
      type !== 'boolean' &&
      type !== 'undefined'
    )
      return undefined;
    key += `${type[0]}${String(arg)}\u0001`;
  }
  return key;
}

/**
 * 动态样式的响应式绑定：`css.bind(styles.bar, () => [item.width])`。交给 attrs / sx 后，
 * 参数变化时只改元素上的变量，不重新渲染组件。JSX 里写 `styles.bar(item.width)` 时编译器自动改写成它
 */
export function bind<Args extends unknown[]>(
  style: (...args: Args) => unknown,
  args: () => NoInfer<Args>,
  stable = false,
): Binding {
  return { [BINDING]: true, style: style as unknown as DynamicStyle, args, stable };
}

const EMPTY: Readonly<Record<string, string>> = Object.freeze({});
/** 没选中任何样式：空片段，参与组合但不产生声明 */
const NONE: Evaluated = { part: fragment(new Map()), inline: EMPTY };
const selected = new WeakMap<StylePart, Evaluated>();

/** css.select 的求值：读到的样式原样参与组合，假值不选 */
const SELECT: Evaluator = {
  [EVALUATE]: ([style]) => {
    if (!style) return NONE;
    if (typeof style !== 'object' || !(FRAGMENT in style || CLASS in style)) {
      throw new Error(
        'css.select：读取函数要返回 create、createTheme、defineMarker 的结果，或假值',
      );
    }
    let result = selected.get(style as StylePart);
    if (!result)
      selected.set(style as StylePart, (result = { part: style as StylePart, inline: EMPTY }));
    return result;
  },
};

/**
 * 按状态选样式的响应式绑定：`css.select(() => item.hot && styles.hot)`。交给 attrs / sx 后，渲染时不追踪读到的状态，
 * 状态变化时由元素上的 effect 就地换组合类，组件不重新渲染。JSX 里写 `item.hot && styles.hot`、
 * `active ? styles.on : styles.off`、`sizeStyles[size]` 时编译器自动改写成它（只在状态没有别处读、换类能省下渲染时）
 */
export function select(read: () => unknown, stable = false): Binding {
  return { [BINDING]: true, style: SELECT, args: () => [read()], stable };
}
