/**
 * 动态样式（create 里写成函数的命名空间）与编译器生成的响应式绑定：
 *   bind(styles.bar, () => [item.width])：参数变化时只改元素上的变量
 *   select(() => item.hot && styles.hot)：选中的样式变化时就地换组合类
 * 二者是编译器的输出（abi.ts），用户在 sx 里写的是 `styles.bar(item.width)`、`item.hot && styles.hot`。
 */
import { eachLeaf, tableOf, type LeafEntry, type StyleObject } from './declarations';
import { collectParts } from './resolve';
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
  type StylePart,
} from './fragment';
import { hash, variablesOnly } from './sheet';

/**
 * 动态样式的变量名：按属性与条件（同 StyleX 的 --x-属性）。不注册 @property：类里引用变量的元素，
 * 自己的行内一定写着这个变量（同一次求值产出类与值），不会用到祖先继承下来的值；注册反而让样式重算慢 15–20%
 */
const dynamicVar = (property: string, chain: readonly string[]) =>
  chain.length ? `--x-${property}-${hash(chain.join(''))}` : `--x-${property}`;

const EMPTY: Readonly<Record<string, string>> = Object.freeze({});

/**
 * 动态样式：一直没变过的属性直接写进类里（多半是常量，同手写，元素上不挂变量）；
 * 值一旦和第一次不同，这个属性就永久转成变量（类里写 var(--x-属性)、值进行内样式）。
 * 一个动态命名空间最多产生“属性数 + 1”种类，不随取值增长；转成变量之后值怎么变类都不变。
 */
export function dynamic(factory: (...args: never[]) => StyleObject, label?: string): DynamicStyle {
  const first = new Map<string, string>();
  const varying = new Set<string>();
  const shapes = new Map<string, readonly StylePart[]>();
  // 参数都是原始值时按参数记住结果：重新求值时同样的参数不再调用工厂、展开声明。
  // 有属性新转成变量时结果会变，清空；条目太多（连续变化的值）时也清空，不无限增长
  const memo = new Map<string, Evaluated>();
  let memoAlways = false;
  const evaluate = (args: readonly unknown[]): Evaluated => {
    // 水合前（同页先挂载的孤岛）记住的结果可能把值写进了类，水合后不能再用
    if (memoAlways !== variablesOnly()) {
      memoAlways = !memoAlways;
      memo.clear();
    }
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
    if (!shared) shapes.set(shape, (shared = [fragment(tableOf(leaves), label)]));
    return { parts: shared, inline };
  };
  const style = (...args: never[]) => {
    const { parts, inline } = evaluate(args);
    const result = [parts[0], inline] as const;
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
    if (arg !== null && type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'undefined')
      return undefined;
    key += `${type[0]}${String(arg)}\u0001`;
  }
  return key;
}

/** 任意函数当求值入口：返回值按 sx 的规则展开（片段、数组、对象字面量、假值） */
const callers = new WeakMap<object, Evaluator>();
function callerOf(fn: (...args: never[]) => unknown): Evaluator {
  let evaluator = callers.get(fn);
  if (!evaluator) {
    evaluator = {
      [EVALUATE]: (args) => {
        const parts: StylePart[] = [];
        const inline: Record<string, string> = {};
        collectParts(fn(...(args as never[])), parts, inline);
        return { parts, inline };
      },
    };
    callers.set(fn, evaluator);
  }
  return evaluator;
}

/**
 * 编译器对 sx 里“静态函数、动态参数”的调用的输出：`styles.bar(item.width)` → `bind(styles.bar, () => [item.width()])`。
 * 参数变化时只改元素上的变量，不重新组合类。函数不是 create 里的动态样式时按普通函数调用，结果照 sx 规则展开
 */
export function bind<Args extends unknown[]>(style: (...args: Args) => unknown, args: () => NoInfer<Args>): Binding {
  const evaluator = EVALUATE in style ? (style as unknown as Evaluator) : callerOf(style as never);
  return { [BINDING]: true, style: evaluator, args };
}

const NONE: Evaluated = { parts: [], inline: EMPTY };
const selected = new WeakMap<StylePart, Evaluated>();

/** select 的求值：单个片段、固定类按对象缓存，假值不选，其余（数组、对象字面量、动态样式的结果）现算 */
const SELECT: Evaluator = {
  [EVALUATE]: ([value]) => {
    if (!value) return NONE;
    if (typeof value === 'object' && (FRAGMENT in value || CLASS in value)) {
      let result = selected.get(value as StylePart);
      if (!result) selected.set(value as StylePart, (result = { parts: [value as StylePart], inline: EMPTY }));
      return result;
    }
    const parts: StylePart[] = [];
    const inline: Record<string, string> = {};
    collectParts(value, parts, inline);
    return { parts, inline };
  },
};

/**
 * 编译器对 sx 里依赖状态的项的输出：`item.hot && styles.hot` → `select(() => item.hot() && styles.hot)`。
 * 渲染时算一次、不追踪；状态变化时元素上的 effect 换掉这一段、重新组合，就地换组合类。
 * 读取函数里没认出的表达式（`props.sx`、`sizes[size]`）也是同一条路
 */
export function select(read: () => unknown): Binding {
  return { [BINDING]: true, style: SELECT, args: () => [read()] };
}
