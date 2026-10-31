/**
 * 配方（recipe）：一个组件的部件 × 档位 × 默认值写在一处，渲染时拿到每个部件的属性包（同 Panda 的 sva）。
 *
 *   const button = recipe({
 *     name: 'Button',                              // 组件名：部件的 data-scope，主题层按它找定制
 *     parts: ['root', 'icon'],
 *     base: { root: { display: 'inline-flex' }, icon: { flexShrink: 0 } },
 *     variants: {
 *       size: { sm: { root: { fontSize: '_sm' } }, md: { root: { fontSize: '_md' }, icon: { width: 20 } } },
 *       fullWidth: { true: { root: { width: '100%' } } },        // 布尔档位写 true / false 键
 *     },
 *     compound: [{ when: { size: 'sm', fullWidth: true }, root: { paddingInline: 0 } }],
 *     defaults: { size: 'md' },
 *   });
 *
 *   // 组件里：传进去的是活对象（编译器把函数体同一层的对象字面量里的响应式变量写成访问器）
 *   const s = button({ size, fullWidth });
 *   <button {...s.root} {...rest}><Icon {...s.icon} /></button>
 *
 * s.root 是部件属性包 `{ sx, 'data-scope': 'button', 'data-part': 'root' }`，直接展开到元素上：
 *   - 惰性：s 上的部件第一次读才创建（表格、菜单几十个部件，渲染到的才付成本）；
 *   - 细粒度：部件只读自己用到的档位（有这个部件样式的档位，加上涉及它的组合档位的条件），
 *     档位变了只有读了它的部件的元素更新，别的部件不动、不重算；
 *   - 传进来的档位不是活的（没有访问器）时，部件的样式在创建时算一次，不起 effect；
 *   - 叠加顺序固定：基础 < 档位 < 组合档位 < 主题层的定制（扩展）< 使用方的 sx（元素上后写的 sx）。
 *
 * 响应式档位：档位的值可以写成 `{ base: 'sm', md: 'lg' }`，键是 defineConditions 里 `_md` 这样的 @media / @container 别名；
 * 每个取值的样式整个包进对应的条件里（只生成用到的“断点 × 取值”）。含响应式取值的组合档位不匹配。
 *
 * 主题层定制（createUi / Provider 的 styles）：`button(selection, ...extensions)` 追加扩展，
 * 扩展里的 base 与各档位排在配方之后，可以给配方没有的档位取值（`provideStyles`、`useRecipe` 见 styles-context.ts）。
 */
import './register';
import { create } from './create';
import { stats } from './bindings';
import { CONDITIONS, type Declarations } from './declarations';
import { BINDING, EVALUATE, FRAGMENT, fragment, type Binding, type Evaluated, type Fragment } from './fragment';
import { HOT, hotUpdate } from './hot';

/** 每个部件的样式（可以只写其中几个） */
export type PartStyles<P extends string> = Partial<Record<P, object>>;
type Variants<P extends string> = Record<string, Record<string, PartStyles<P>>>;

/** 取值的键是 'true' / 'false' 时，调用侧收 boolean */
type ValueOf<K> = K extends 'true' | 'false' ? boolean : K;
/** 调用配方时的档位选择 */
export type VariantSelection<V> = { [Name in keyof V]?: ValueOf<keyof V[Name]> | null | undefined };

/** 配方的定义 */
export interface RecipeConfig<P extends string, V extends Variants<P>> {
  /** 组件名（`'Button'`）：部件的 data-scope 用它，主题层按它找 createUi / Provider 里的定制 */
  name?: string;
  parts: readonly P[];
  /** 不分档位的基础样式 */
  base?: PartStyles<P>;
  variants?: V;
  /** 几个档位同时取某些值时追加的样式 */
  compound?: readonly ({ when: VariantSelection<V> } & PartStyles<P>)[];
  /** 不传时的档位取值 */
  defaults?: VariantSelection<V>;
}

/** 主题层的定制：基础样式追加在配方之后，档位可以给新的取值。同一个扩展对象反复传入有缓存：写在配置里，别每次渲染新建 */
export interface RecipeExtension<P extends string = string> {
  base?: PartStyles<P>;
  variants?: Readonly<Record<string, Readonly<Record<string, PartStyles<P>>>>>;
}

/** 一个部件的属性包：展开到元素上 */
export interface PartProps {
  readonly sx: readonly unknown[];
  readonly 'data-scope': string;
  readonly 'data-part': string;
}

/** 配方：传档位选择（与扩展），返回每个部件的属性包（惰性） */
export interface Recipe<P extends string, V> {
  (
    selection?: VariantSelection<V> | Readonly<Record<string, unknown>>,
    ...extensions: readonly (RecipeExtension<P> | undefined)[]
  ): Readonly<Record<P, PartProps>>;
  readonly parts: readonly P[];
  readonly name: string | undefined;
}

type Segments = Map<string, Record<string, Fragment>>;

/** 一组样式来源（配方自己，或一个扩展）展开后的状态 */
interface Source {
  /** 'base'、'variant\0档位\0取值'、'compound\0序号' → 这一段各部件的样式（create 的结果，部件第一次用到才展开） */
  segments: Segments;
  /** 档位名（声明顺序） */
  names: readonly string[];
  /** 部件 → 它有样式的档位（含涉及它的组合档位的条件） */
  dimsOfPart: Map<string, Set<string>>;
  compound: readonly { when: Readonly<Record<string, unknown>>; parts: readonly string[] }[];
}

const compile = (styles: object, label: string) => create(styles as Record<string, object>, label) as Record<string, Fragment>;
const partsOfStyles = (styles: object) => Object.keys(styles);

/** 展开一个来源：每段样式各 create 一次（惰性），并记下每个部件涉及哪些档位 */
function source(
  label: string,
  base: object | undefined,
  variants: Readonly<Record<string, Readonly<Record<string, object>>>>,
  compound: readonly ({ when: object } & object)[] = [],
): Source {
  const segments: Segments = new Map();
  const dimsOfPart = new Map<string, Set<string>>();
  const dim = (part: string, name: string) => {
    let set = dimsOfPart.get(part);
    if (!set) dimsOfPart.set(part, (set = new Set()));
    set.add(name);
  };
  if (base) segments.set('base', compile(base, `${label}`));
  for (const [name, values] of Object.entries(variants)) {
    for (const [value, styles] of Object.entries(values)) {
      segments.set(`variant\0${name}\0${value}`, compile(styles, `${label}.${name}=${value}`));
      for (const part of partsOfStyles(styles)) dim(part, name);
    }
  }
  const entries = compound.map((entry, index) => {
    const { when, ...styles } = entry;
    segments.set(`compound\0${index}`, compile(styles, `${label}.compound${index}`));
    const parts = partsOfStyles(styles);
    for (const part of parts) for (const name of Object.keys(when)) dim(part, name);
    return { when: when as Record<string, unknown>, parts };
  });
  return { segments, names: Object.keys(variants), dimsOfPart, compound: entries };
}

const extensionSources = new WeakMap<object, Source>();
const sourceOfExtension = (extension: RecipeExtension, label: string) => {
  let result = extensionSources.get(extension);
  if (!result) {
    result = source(`${label}+`, extension.base, extension.variants ?? {});
    extensionSources.set(extension, result);
  }
  return result;
};

/** 响应式取值在 picked 字符串里的前缀（不会出现在普通取值里） */
const RESPONSIVE = '\u0002';

/** 一个片段整体放进断点条件里（@media / @container）：每个属性的值按条件逐项合并，不整体替换 */
const atBreakpoints = new WeakMap<Fragment, Map<string, Fragment>>();
function atBreakpoint(source: Fragment, breakpoint: string): Fragment {
  let byQuery = atBreakpoints.get(source);
  if (!byQuery) atBreakpoints.set(source, (byQuery = new Map()));
  let result = byQuery.get(breakpoint);
  if (!result) {
    const query = CONDITIONS[`_${breakpoint}`];
    if (!query?.startsWith('@')) {
      throw new Error(`recipe：响应式档位的断点 '${breakpoint}' 没有对应的 @ 规则别名（defineConditions({ _${breakpoint}: '@media …' })）`);
    }
    const table: Declarations = new Map(
      [...source[FRAGMENT]].map(([property, entry]) => [
        property,
        {
          replace: false,
          values: new Map([...entry.values].map(([chain, texts]) => [[query, ...(chain ? chain.split('\0') : [])].join('\0'), texts])),
        },
      ]),
    );
    byQuery.set(breakpoint, (result = fragment(table, source.label)));
  }
  return result;
}

/** 一个部件在一个“配方 + 扩展链”下的计划：用到哪些档位，档位取值 → 样式片段（有缓存） */
interface Plan {
  dims: readonly string[];
  /** 档位取值（规整成字符串）→ 片段列表 */
  results: Map<string, Evaluated>;
}

/** 配方 + 扩展链：计划按部件缓存；扩展链按扩展对象逐层往下 */
interface Chain {
  extensions: readonly Source[];
  plans: Map<string, Plan>;
  next?: WeakMap<object, Chain>;
}

const EMPTY = Object.freeze({});
const STABLE = Symbol.for('hilt.stable');

/** 定义配方（见文件开头） */
export function recipe<const P extends string, const V extends Variants<P> = {}>(
  config: RecipeConfig<P, V>,
): Recipe<P, V> {
  const label = config.name ?? 'recipe';
  const scope = (config.name ?? '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const defaults = (config.defaults ?? {}) as Record<string, unknown>;
  let core = source(label, config.base, config.variants ?? {}, config.compound as never);
  let root: Chain = { extensions: [], plans: new Map() };

  const chainOf = (extensions: readonly (RecipeExtension | undefined)[]): Chain => {
    let node = root;
    for (const extension of extensions) {
      if (!extension) continue;
      node.next ??= new WeakMap();
      let child = node.next.get(extension);
      if (!child) {
        child = { extensions: [...node.extensions, sourceOfExtension(extension, label)], plans: new Map() };
        node.next.set(extension, child);
      }
      node = child;
    }
    return node;
  };

  /** 档位取值 → 字符串：未选、null 用默认值 */
  const pick = (value: unknown, name: string) => {
    const picked = value ?? defaults[name];
    if (picked && typeof picked === 'object') {
      return RESPONSIVE + Object.entries(picked).map(([breakpoint, taken]) => `${breakpoint}=${taken}`).join(';');
    }
    return picked === undefined || picked === null ? '' : String(picked);
  };

  const planOf = (chain: Chain, part: string): Plan => {
    let plan = chain.plans.get(part);
    if (plan) return plan;
    const dims = new Set<string>();
    for (const one of [core, ...chain.extensions]) for (const name of one.dimsOfPart.get(part) ?? []) dims.add(name);
    plan = { dims: [...dims], results: new Map() };
    chain.plans.set(part, plan);
    return plan;
  };

  /** 按档位取值拼出这个部件的片段：基础 < 档位 < 组合档位 < 扩展 */
  const fragmentsOf = (chain: Chain, part: string, plan: Plan, picked: readonly string[]): Evaluated => {
    const key = picked.join('\0');
    const hit = plan.results.get(key);
    if (hit) return hit;
    stats.fragmentBuilds++;
    const value = (name: string) => picked[plan.dims.indexOf(name)] ?? '';
    const parts: Fragment[] = [];
    const push = (segments: Segments, path: string) => {
      const styles = segments.get(path);
      if (styles && part in styles) parts.push(styles[part]!);
    };
    for (const one of [core, ...chain.extensions]) {
      const isCore = one === core;
      push(one.segments, 'base');
      for (const name of one.names) {
        const picked = value(name);
        if (!picked) continue;
        if (!picked.startsWith(RESPONSIVE)) push(one.segments, `variant\0${name}\0${picked}`);
        else {
          for (const item of picked.slice(1).split(';')) {
            const [breakpoint, taken] = item.split('=') as [string, string];
            const styles = one.segments.get(`variant\0${name}\0${taken}`);
            if (styles && part in styles) {
              parts.push(breakpoint === 'base' ? styles[part]! : atBreakpoint(styles[part]!, breakpoint));
            }
          }
        }
      }
      if (isCore) {
        one.compound.forEach(({ when, parts: owners }, index) => {
          if (!owners.includes(part)) return;
          if (Object.entries(when).every(([name, expected]) => value(name) === String(expected)))
            push(one.segments, `compound\0${index}`);
        });
      }
    }
    const result: Evaluated = { parts, inline: EMPTY };
    plan.results.set(key, result);
    return result;
  };

  /** 选择里这个档位是活的（访问器、代理）：值会变，部件要起 effect 读它 */
  const isLive = (selection: object, name: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(selection, name);
    return descriptor ? !!descriptor.get : false;
  };

  const bundleOf = (chain: Chain, selection: Record<string, unknown>, part: string): PartProps => {
    const plan = planOf(chain, part);
    const readAll = () => plan.dims.map((name) => pick(selection[name], name));
    const live = plan.dims.some((name) => isLive(selection, name));
    let sx: unknown[];
    if (!plan.dims.length) sx = fragmentsOf(chain, part, plan, []).parts.slice();
    else if (!live) sx = fragmentsOf(chain, part, plan, readAll()).parts.slice();
    else {
      const evaluator = { [EVALUATE]: (picked: readonly unknown[]) => fragmentsOf(chain, part, plan, picked as string[]) };
      const binding: Binding = { [BINDING]: true, style: evaluator, args: readAll };
      sx = [binding];
    }
    // STABLE：运行时的 spread 据此把 `{...s.root}` 当静态层（编译器对成员表达式的展开保守地包成了读取函数）
    return { sx, 'data-scope': scope, 'data-part': part, [STABLE]: true };
  };

  const proto = Object.create(null) as Record<string, unknown>;
  for (const part of config.parts) {
    Object.defineProperty(proto, part, {
      get(this: { c: Chain; s: Record<string, unknown>; b?: Record<string, PartProps> }) {
        const cache = (this.b ??= Object.create(null) as Record<string, PartProps>);
        return (cache[part] ??= bundleOf(this.c, this.s, part));
      },
      enumerable: true,
    });
  }

  const resolve = (selection: Record<string, unknown> = EMPTY, ...extensions: (RecipeExtension | undefined)[]) => {
    const view = Object.create(proto) as { c: Chain; s: Record<string, unknown> };
    view.c = chainOf(extensions);
    view.s = selection;
    return view;
  };
  Object.defineProperty(resolve, 'parts', { value: config.parts });
  Object.defineProperty(resolve, 'name', { value: config.name, configurable: true });
  // 热更新：同一段的样式原地换声明，片段对象不变，已渲染的类按原类名改写；换上新的档位结构、清掉缓存
  Object.defineProperty(resolve, HOT, {
    value: (next: { [STATE]: { core: Source } }) => {
      const incoming = next[STATE].core;
      for (const [path, styles] of incoming.segments) {
        const previous = core.segments.get(path);
        if (!previous) continue;
        hotUpdate(previous, styles);
        incoming.segments.set(path, previous);
      }
      core = incoming;
      root = { extensions: [], plans: new Map() };
    },
  });
  Object.defineProperty(resolve, STATE, { get: () => ({ core }) });
  return resolve as unknown as Recipe<P, V>;
}

const STATE = Symbol('recipe state');
