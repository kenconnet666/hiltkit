/**
 * 片段与组合类：create 的每个命名空间是一个片段（声明表）；一个元素的 sx 把片段合成一个类，第一次出现时插入规则。
 */
import { config } from './config';
import { merge, serialize, SELF, type Declarations } from './declarations';
import { hash, insert, isInserted } from './sheet';

/** 片段上的声明表 */
export const FRAGMENT = Symbol('style fragment');
/** 固定类（createTheme 的主题类、defineMarker 的标记类）上的 [去重键, 类名] */
export const CLASS = Symbol('style class');
/** 动态样式的结果（[片段, 行内变量]）的标记 */
export const DYNAMIC = Symbol('style dynamic');
/** 响应式绑定（select、recipe 的档位）的标记 */
export const BINDING = Symbol('style binding');
/** 动态样式函数上的求值入口 */
export const EVALUATE = Symbol('style evaluate');

/** 绑定算一次的结果：参与组合的几段样式与行内变量 */
export interface Evaluated {
  /** 这一位置的样式：动态样式的片段（值变过的属性写成 var(--x-属性)，没变过的写死），或 select 选中的样式 */
  readonly parts: readonly StylePart[];
  /** 行内变量：变量名 → 这次的值 */
  readonly inline: Readonly<Record<string, string>>;
}
/** 绑定求值的入口：动态样式、select 的选择 */
export interface Evaluator {
  /** 按参数求值（有记忆），attrs 与元素上的绑定用 */
  readonly [EVALUATE]: (args: readonly unknown[]) => Evaluated;
}
/** create 里的函数：调用得到 [片段, 行内变量] */
export interface DynamicStyle extends Evaluator {
  (...args: never[]): readonly [StylePart, Readonly<Record<string, string>>];
}

/** create 的一个命名空间 */
export interface Fragment {
  /** 声明表 */
  readonly [FRAGMENT]: Declarations;
  /** 开发模式的可读名字（文件、组件、命名空间），进组合类的类名 */
  readonly label?: string;
  /** 内容会不断变化（sx 对象字面量）：服务端规则表限量记住 */
  readonly volatile?: boolean;
}
/** 固定类：同一去重键（主题的变量组、标记名）在一次 sx 里后者覆盖前者 */
export interface ClassStyle {
  /** [去重键, 类名] */
  readonly [CLASS]: readonly [key: string, className: string];
}

/** 参与组合的一段样式：片段，或固定类（主题、标记） */
export type StylePart = Fragment | ClassStyle;

/** 一个响应式绑定：动态样式（或 select 的选择）与读参数的函数 */
export interface Binding {
  readonly [BINDING]: true;
  /** 绑定的动态样式，或 select 的选择 */
  readonly style: Evaluator;
  /** 读参数的函数：effect 里调用，读到的响应式值变化时重新求值 */
  readonly args: () => readonly unknown[];
}

/** 新的片段 */
export function fragment(table: Declarations, label?: string, volatile?: boolean): Fragment {
  const result = Object.defineProperty({}, FRAGMENT, { value: table }) as {
    label?: string;
    volatile?: boolean;
  };
  if (label) result.label = label;
  if (volatile) result.volatile = true;
  return result as Fragment;
}

/** 是 create 产出的片段 */
export const isFragment = (value: unknown): value is Fragment =>
  typeof value === 'object' && value !== null && FRAGMENT in value;

/** 开发模式：组合类 → 组成它的片段；片段 → 用到它的组合类（热更新改了片段时据此改写规则） */
const composites = new Map<string, readonly Fragment[]>();
const usedBy = new WeakMap<Fragment, Set<string>>();

/** 类名里的可读前缀（仅开发模式）：`Button.root` → `Button-root-` */
const readable = (fragments: readonly Fragment[]) => {
  const labels = [...new Set(fragments.map((part) => part.label).filter(Boolean))];
  const text = labels
    .join('_')
    .replace(/[^\w-]+/g, '-')
    .slice(0, 48);
  return text ? `${text}-` : '';
};

/** 开发模式写在规则前面的注释：这个类由哪些片段组成（devtools 的样式表里看得到） */
const commentOf = (fragments: readonly Fragment[]) => {
  const labels = fragments.map((part) => part.label ?? '(无名片段)');
  return `/* ${labels.join(' + ')} */`;
};

/** 组合的结果是不是含 volatile 片段，由 compose 记下 */
export interface Composite {
  name: string;
  volatile: boolean;
}

/** 组合一组片段：类名是规则内容的哈希，第一次出现时插入 */
export function composite(fragments: readonly Fragment[]): Composite {
  const rules = serialize(merge(fragments.map((part) => part[FRAGMENT])));
  if (!rules.length) return { name: '', volatile: false };
  const volatile = fragments.some((part) => part.volatile);
  const name = `${config.dev ? readable(fragments) : ''}x${hash(rules.join(''))}`;
  if (!isInserted(name))
    insert(
      name,
      [
        ...(config.dev ? [commentOf(fragments)] : []),
        ...rules.map((rule) => rule.replaceAll(SELF, name)),
      ],
      volatile,
    );
  if (config.dev && !composites.has(name)) {
    composites.set(name, fragments);
    for (const part of fragments) {
      let names = usedBy.get(part);
      if (!names) usedBy.set(part, (names = new Set()));
      names.add(name);
    }
  }
  return { name, volatile };
}
