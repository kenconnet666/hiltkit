/**
 * 片段与组合类：create 的每个命名空间是一个片段（声明表）；attrs 把一个元素的片段合成一个类，第一次出现时插入规则。
 * 记下“组合类 ← 片段”的关系，热更新换了片段的声明时按原类名改写规则。
 */
import { merge, serialize, SELF, type Declarations } from './declarations';
import { hash, insert, isInserted } from './sheet';

/** 片段上的声明表 */
export const FRAGMENT = Symbol('style fragment');
/** 固定类（createTheme 的主题类、defineMarker 的标记类）上的 [去重键, 类名] */
export const CLASS = Symbol('style class');
/** 动态样式的结果（[片段, 行内变量]）的标记 */
export const DYNAMIC = Symbol('style dynamic');
/** css.bind 的结果的标记 */
export const BINDING = Symbol('style binding');
/** 动态样式函数上的求值入口 */
export const EVALUATE = Symbol('style evaluate');

/** 绑定算一次的结果：参与组合的一段样式（动态样式的片段只随形状变）与行内变量 */
export interface Evaluated {
  /** 这一段样式：动态样式的片段（值变过的属性写成 var(--x-属性)，没变过的写死），或 css.select 选中的样式 */
  readonly part: StylePart;
  /** 行内变量：变量名 → 这次的值 */
  readonly inline: Readonly<Record<string, string>>;
}
/** 绑定求值的入口：动态样式、css.select 的选择 */
export interface Evaluator {
  /** 按参数求值（有记忆），attrs 与元素上的绑定用 */
  readonly [EVALUATE]: (args: readonly unknown[]) => Evaluated;
}
/** create 里的函数：调用得到 [片段, 行内变量] */
export interface DynamicStyle extends Evaluator {
  (...args: never[]): readonly [StylePart, Readonly<Record<string, string>>];
}

/** create 的一个命名空间（对外的类型是 CompiledStyles） */
export interface Fragment {
  /** 声明表；热更新时换成新的 */
  readonly [FRAGMENT]: Declarations;
}
/** 固定类：同一去重键（主题的变量组、标记名）在一次 attrs 里后者覆盖前者 */
export interface ClassStyle {
  /** [去重键, 类名] */
  readonly [CLASS]: readonly [key: string, className: string];
}

/** 参与组合的一段样式：片段，或固定类（主题、标记） */
export type StylePart = Fragment | ClassStyle;

/** 一个响应式绑定：动态样式（或 css.select 的选择）与读参数的函数 */
export interface Binding {
  /** 标记：attrs 据此认出绑定 */
  readonly [BINDING]: true;
  /** 绑定的动态样式，或 css.select 的选择 */
  readonly style: Evaluator;
  /** 读参数的函数：effect 里调用，读到的响应式值变化时重新求值 */
  readonly args: () => readonly unknown[];
  /** 读取函数只读渲染函数外面的来源（编译器判断）：重新渲染时换上新的读取函数即可，不必重跑 effect */
  readonly stable: boolean;
}

/** 新的片段；声明表可写：热更新时换成新的（hotStyles），片段对象本身不变，用到它的缓存、已渲染的类照样有效 */
export const fragment = (table: Declarations): Fragment =>
  Object.defineProperty({}, FRAGMENT, { value: table, writable: true }) as Fragment;

/** 是 create 产出的片段 */
export const isFragment = (value: unknown): value is Fragment =>
  typeof value === 'object' && value !== null && FRAGMENT in value;

/** 组合类 → 组成它的片段；片段 → 用到它的组合类（热更新改了片段时据此改写规则） */
const composites = new Map<string, readonly Fragment[]>();
const usedBy = new WeakMap<Fragment, Set<string>>();

/** 组合一组片段：类名是规则内容的哈希，第一次出现时插入 */
export function composite(fragments: readonly Fragment[]): string {
  const rules = serialize(merge(fragments.map((part) => part[FRAGMENT])));
  if (!rules.length) return '';
  const name = `x${hash(rules.join(''))}`;
  if (!isInserted(name))
    insert(
      name,
      rules.map((rule) => rule.replaceAll(SELF, name)),
    );
  if (!composites.has(name)) {
    composites.set(name, fragments);
    for (const part of fragments) {
      let names = usedBy.get(part);
      if (!names) usedBy.set(part, (names = new Set()));
      names.add(name);
    }
  }
  return name;
}

/** 组合类由哪些片段组成；不是引擎生成的组合类时 undefined（行内样式按它查回声明表，见 inline.ts） */
export const compositeFragments = (name: string): readonly Fragment[] | undefined =>
  composites.get(name);

/** 片段换成新的声明表，用到它的组合类按原类名重写规则 */
export function replaceFragment(target: Fragment, table: Declarations) {
  (target as { [FRAGMENT]: Declarations })[FRAGMENT] = table;
  for (const name of usedBy.get(target) ?? []) {
    const fragments = composites.get(name)!;
    const rules = serialize(merge(fragments.map((part) => part[FRAGMENT])));
    insert(
      name,
      rules.map((rule) => rule.replaceAll(SELF, name)),
    );
  }
}
