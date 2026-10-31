/**
 * 运行时样式引擎：写法同 StyleX（create、attrs、createTheme、keyframes、when），实现同 Emotion / zerodep-css：
 * 一个元素一次 attrs 合成一个类，规则在第一次用到时插入；状态变化只改该改的那一处。
 *
 *   - create 只产出“片段”（声明表），不注入；命名空间第一次被读到时才展开。
 *   - attrs(片段…) 按片段对象逐层查缓存（WeakMap 链），命中时不拼字符串、不算哈希，返回同一个结果对象，
 *     Vue 比对 class 相同就不碰 DOM。未命中时合并成一个组合类：`.c{…} .c:hover{…} @media(…){.c.c{…}}`，
 *     类名是内容的哈希，同样的组合只插一次。一个元素只挂一个生成的类，没有原子类之间的优先级问题；
 *     块内按 StyleX 的属性优先级排序（简写在前、长属性在后），条件块按条件优先级排序（:hover < :active < @media）。
 *   - 合并语义：后面的普通值整体替换该属性（同 StyleX，含它的条件值）；条件对象按条件逐项合并，
 *     其中的 null 表示“这个条件不改”（不会像 StyleX 那样把前面的默认值清掉）；顶层的 null 去掉该属性。
 *   - 动态样式（create 里的函数）：一直没变过的属性写进类里；值变过的属性永久转成变量（类里写 var(--x-属性)、
 *     值进元素的行内样式），之后值怎么变类名都不变、不插新规则。
 *   - 响应式绑定（css.bind）：创建元素时只算类名、不追踪依赖，元素创建后由一个 alien-signals effect
 *     直接改元素上的变量，只改那一个变量。
 *   - 按状态选样式（css.select，编译器把 `item.hot && styles.hot` 这类只在样式里读的状态改写成它）：同样不追踪，
 *     状态变化时 effect 换掉那一段样式、重新组合，就地换元素上的组合类（bindings.ts）。
 *   - 状态样式用条件别名（_selected、_disabled…）跟着 DOM 上的 aria / data 属性走：状态变化只改属性，类名不变。
 *   - 主题（createTheme，vars.ts）是一个只改变量的类，换主题只换这个类，组件不用重新渲染。
 *   - 热更新（hotStyles，编译器包在顶层 create / recipe 外面）：模块重新执行时新声明写进旧片段，
 *     用到它的组合类按原类名改写规则，组件不重新渲染。
 *
 * 分成几个模块：declarations（样式对象 → 声明表 → 规则文本）、sheet（样式表）、fragment（片段与组合类）、
 * compose（一个元素的样式 → 类，带缓存）、dynamic（动态样式与 bind、select）、bindings（元素上的响应式绑定）、vars（变量组、主题、标记）、tokens（主题 tokens 的短写）、
 * hot（热更新）；这里是对外的入口。
 */
import { untrack, watchBindings, type BindingEntry } from './bindings';
import {
  cssValue,
  dashify,
  declarations,
  type Leaf,
  type StyleObject,
  type StyleValue,
} from './declarations';
import { compose } from './compose';
import { dynamic } from './dynamic';
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
import { hash, insert, isInserted } from './sheet';

export { CONDITIONS } from './declarations';
export { bind, select } from './dynamic';
export { HOT, hotStyles, hotUpdate } from './hot';
export { hash, renderStyleTag, styleText } from './sheet';
export { inlineStyle, type ConditionMatcher } from './inline';
export { defineTokens } from './tokens';
export { createTheme, defineMarker, defineVars, when } from './vars';

/** attrs 的结果 */
export interface Attrs {
  /** 组合类，加上主题、标记的类 */
  class?: string;
  /** 动态样式的行内变量 */
  style?: Readonly<Record<string, string>>;
  /** 有响应式绑定时：元素创建后调用，起 effect 改变量、换类，返回停止函数 */
  watch?: (element: HTMLElement) => () => void;
}

/** css.create：命名空间第一次被读时展开（惰性）；函数是动态样式 */
export function create<S extends Record<string, unknown>>(namespaces: S): S {
  const result: Record<string, unknown> = {};
  for (const [name, namespace] of Object.entries(namespaces)) {
    if (typeof namespace === 'function') {
      result[name] = dynamic(namespace as (...args: never[]) => StyleObject);
      continue;
    }
    Object.defineProperty(result, name, {
      enumerable: true,
      configurable: true,
      get() {
        const value = fragment(declarations(namespace as StyleObject));
        Object.defineProperty(result, name, { value, enumerable: true, configurable: true });
        return value;
      },
    });
  }
  return result as S;
}

type AttrsArg = StyleValue | boolean | object | readonly AttrsArg[];

/** 直接写的样式对象（`sx={{ marginTop: '_md' }}`）→ 片段：同一个对象按对象记住，每次渲染新建的按内容记住 */
const literalByObject = new WeakMap<object, Fragment>();
const literalByContent = new Map<string, Fragment>();
/** 按内容最多记住多少个（值一直在变的写法会不断出新内容，不无限增长；记不住时重新展开，规则照旧只插一次） */
const LITERAL_LIMIT = 512;

function literal(value: object): Fragment {
  let result = literalByObject.get(value);
  if (result) return result;
  const key = JSON.stringify(value);
  result = literalByContent.get(key);
  if (!result) {
    if (literalByContent.size >= LITERAL_LIMIT) literalByContent.clear();
    literalByContent.set(key, (result = fragment(declarations(value as StyleObject))));
  }
  literalByObject.set(value, result);
  return result;
}

/**
 * 合并样式成元素属性 `{ class, style }`，后面的覆盖前面的；假值忽略，可以嵌套成数组，也可以直接写样式对象。
 * 只有静态片段时返回缓存的同一个对象；有动态样式时 class 走缓存，style 是这次的变量值；
 * 有响应式绑定（bind、select）时再带一个 watch：元素创建后由 effect 改变量、换类（见 watchBindings）
 */
export function attrs(...styles: readonly AttrsArg[]): Attrs {
  const parts: StylePart[] = [];
  let inline: Record<string, string> | undefined;
  let bindings: BindingEntry[] | undefined;
  const addInline = (values: Readonly<Record<string, string>>) => {
    // 还没有属性转成变量时行内为空：不给 style，结果仍是缓存的同一个对象
    for (const _ in values) {
      inline = Object.assign(inline ?? {}, values);
      return;
    }
  };
  const collect = (value: AttrsArg) => {
    if (!value || typeof value !== 'object') return;
    if (BINDING in value) {
      // 渲染时只取这一次的值算类名与首屏的变量，不追踪：参数变化交给元素上的 effect，不让组件重新渲染
      const binding = value as Binding;
      let args: readonly unknown[] = [];
      const { part, inline: values } = untrack(() =>
        binding.style[EVALUATE]((args = binding.args())),
      );
      (bindings ??= []).push({ binding, index: parts.length, args, inline: values });
      parts.push(part);
      addInline(values);
      return;
    }
    if (Array.isArray(value)) {
      if (DYNAMIC in value) {
        parts.push(value[0] as StylePart);
        addInline(value[1] as Record<string, string>);
      } else value.forEach(collect);
      return;
    }
    parts.push(FRAGMENT in value || CLASS in value ? (value as StylePart) : literal(value));
  };
  styles.forEach(collect);

  const composed = compose(parts);
  if (!inline && !bindings) return composed;
  const result: Attrs = inline ? { ...composed, style: inline } : { ...composed };
  if (bindings) result.watch = watchBindings(bindings, parts, composed.class ?? '');
  return result;
}

/* ───────────────────────── 关键帧 ───────────────────────── */

/** css.keyframes：返回动画名，规则第一次调用时插入 */
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
  const name = `x${hash(body)}-B`;
  if (!isInserted(name)) insert(name, [`@keyframes ${name}{${body}}`]);
  return name;
}
