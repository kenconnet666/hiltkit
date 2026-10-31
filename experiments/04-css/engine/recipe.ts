/**
 * 配方（recipe）：一个组件的部件 × 档位 × 默认值写在一处，渲染时一次调用拿到每个部件的样式（同 Panda 的 sva）。
 *
 *   const button = recipe({
 *     name: 'Button',                              // 组件名：部件的 data-scope，组件库按它找主题定制
 *     parts: ['root', 'icon'],
 *     base: { root: { display: 'inline-flex', color: { default: '_text', _disabled: '_textDisabled' } } },
 *     variants: {
 *       size: { sm: { root: { fontSize: '_sm' } }, md: { root: { fontSize: '_md' } } },
 *       fullWidth: { true: { root: { width: '100%' } } },        // 布尔档位写 true / false 键
 *     },
 *     compound: [{ when: { size: 'sm', fullWidth: true }, root: { paddingInline: 0 } }],
 *     defaults: { size: 'md' },
 *   });
 *   const s = button({ size, fullWidth });       // { root: [...样式], icon: [...] }，按档位组合缓存
 *   <button {...css.attrs(s.root, sx)} />
 *
 * 每个部件的样式是 create 的结果（片段，用到时才展开），合并时后者覆盖前者，
 * 所以“基础 < 档位 < 组合档位 < 扩展 < 调用方的 sx”的顺序由 attrs 的参数顺序保证。
 *
 * 扩展（主题定制）：调用时追加 `button(selection, 扩展…)`，扩展里的 base 与各档位的样式排在配方自己的之后；
 * 扩展可以给配方没有的档位取值（`variants: { size: { xl: { root: {…} } } }`）。组件库把 createUi / Provider 的
 * styles 配置交给这里（@zerodep-dev/vue-tsx-pro-ui 的 useRecipe）。
 */
import type { DocumentedStyles } from './documented';
import { HOT, hotUpdate } from './hot';
import type { CompiledStyles } from './index';
import { create } from './runtime';

/** 每个部件的样式（可以只写其中几个；同 css.create 的一组，属性带说明） */
export type PartStyles<P extends string> = Partial<Record<P, DocumentedStyles>>;
/** 档位：档位名 → 取值 → 各部件的样式 */
type Variants<P extends string> = Record<string, Record<string, PartStyles<P>>>;

/** 取值的键是 'true' / 'false' 时，调用侧收 boolean */
type ValueOf<K> = K extends 'true' | 'false' ? boolean : K;
/** 调用配方时的档位选择 */
export type VariantSelection<V> = {
  [Name in keyof V]?: ValueOf<keyof V[Name]> | null | undefined;
};

/** 配方的定义 */
export interface RecipeConfig<P extends string, V extends Variants<P>> {
  /** 组件名（`'Button'`）：部件的 data-scope 用它，组件库按它找 createUi / Provider 里的主题定制 */
  name?: string;
  /** 部件名 */
  parts: readonly P[];
  /** 不分档位的基础样式 */
  base?: PartStyles<P>;
  /** 档位 */
  variants?: V;
  /** 几个档位同时取某些值时追加的样式 */
  compound?: readonly ({ when: VariantSelection<V> } & PartStyles<P>)[];
  /** 不传时的档位取值 */
  defaults?: VariantSelection<V>;
}

/**
 * 配方的扩展（主题定制）：基础样式追加在配方的之后，档位可以给新的取值（使用方扩展了档位接口时）。
 * 同一个扩展对象反复传入时结果有缓存：扩展写在配置里，不要每次渲染新建
 */
export interface RecipeExtension<P extends string = string> {
  /** 追加在配方之后的基础样式 */
  base?: PartStyles<P>;
  /** 档位名 → 取值 → 各部件的样式（已有的取值追加在配方之后，新的取值只用这里的） */
  variants?: Readonly<Record<string, Readonly<Record<string, PartStyles<P>>>>>;
}

/** 编译后的样式（create 的结果） */
type Compiled = CompiledStyles;

/** 配方：传档位选择（与扩展），返回每个部件的样式数组（交给 css.attrs） */
export interface Recipe<P extends string, V> {
  (
    selection?: VariantSelection<V> | Readonly<Record<string, unknown>>,
    ...extensions: readonly (RecipeExtension<P> | undefined)[]
  ): Readonly<Record<P, readonly Compiled[]>>;
  /** 部件名 */
  readonly parts: readonly P[];
  /** 组件名（定义时给了 name） */
  readonly name: string | undefined;
}

/** 组合缓存：没有扩展时直接查 results；有扩展时按扩展对象逐层往下 */
interface CacheNode<P extends string> {
  results: Map<string, Record<P, Compiled[]>>;
  next?: WeakMap<object, CacheNode<P>>;
}

/** 定义配方（见文件开头） */
export function recipe<const P extends string, const V extends Variants<P> = {}>(
  config: RecipeConfig<P, V>,
): Recipe<P, V> {
  let state = build(config);
  let cache: CacheNode<P> = { results: new Map() };

  const resolve = (
    selection: Readonly<Record<string, unknown>> = {},
    ...extensions: readonly (RecipeExtension<P> | undefined)[]
  ) => {
    let node = cache;
    const added: ExtensionState<P>[] = [];
    for (const extension of extensions) {
      if (!extension) continue;
      node.next ??= new WeakMap();
      let child = node.next.get(extension);
      if (!child) node.next.set(extension, (child = { results: new Map() }));
      node = child;
      added.push(extensionState(extension));
    }
    const names = added.length
      ? [...new Set([...state.names, ...added.flatMap((extension) => extension.names)])]
      : state.names;
    const picked = names.map((name) => {
      const value = selection[name] ?? state.defaults[name];
      return value === undefined || value === null
        ? undefined
        : String(value as string | number | boolean);
    });
    const key = picked.join('\0');
    const hit = node.results.get(key);
    if (hit) return hit;
    const result = Object.fromEntries(
      state.parts.map((part) => [part, [] as Compiled[]]),
    ) as Record<P, Compiled[]>;
    const push = (styles: Record<P, Compiled> | undefined) => {
      if (!styles) return;
      for (const part of state.parts) if (part in styles) result[part].push(styles[part]);
    };
    const pushVariants = (segments: Map<string, Record<P, Compiled>>) =>
      names.forEach((name, index) => {
        const value = picked[index];
        if (value !== undefined) push(segments.get(`variant\0${name}\0${value}`));
      });
    push(state.segments.get('base'));
    pushVariants(state.segments);
    state.compound.forEach(({ when }, index) => {
      const matches = Object.entries(when).every(
        ([name, value]) => picked[names.indexOf(name)] === String(value),
      );
      if (matches) push(state.segments.get(`compound\0${index}`));
    });
    for (const extension of added) {
      push(extension.segments.get('base'));
      pushVariants(extension.segments);
    }
    node.results.set(key, result);
    return result;
  };
  Object.defineProperty(resolve, 'parts', { get: () => state.parts });
  Object.defineProperty(resolve, 'name', { value: config.name, configurable: true });
  // 热更新（runtime.ts 的 hotStyles）：同一段的样式原地换声明，片段对象不变，已渲染的类按原类名改写；
  // 换上新的档位结构、清掉组合缓存
  Object.defineProperty(resolve, HOT, {
    value: (next: Recipe<P, V>) => {
      const incoming = (next as unknown as { [STATE]: RecipeState<P> })[STATE];
      for (const [path, styles] of incoming.segments) {
        const previous = state.segments.get(path);
        if (!previous) continue;
        hotUpdate(previous, styles);
        incoming.segments.set(path, previous);
      }
      state = incoming;
      cache = { results: new Map() };
    },
  });
  Object.defineProperty(resolve, STATE, { get: () => state });
  return resolve as unknown as Recipe<P, V>;
}

const STATE = Symbol('recipe state');

/** 配方展开后的状态：每段样式（create 的结果）按路径存，热更新时整体换成新的 */
interface RecipeState<P extends string> {
  parts: readonly P[];
  names: readonly string[];
  defaults: Readonly<Record<string, unknown>>;
  /** 'base'、'variant\0档位\0取值'、'compound\0序号' → 这一段各部件的样式 */
  segments: Map<string, Record<P, Compiled>>;
  compound: readonly { when: Readonly<Record<string, unknown>> }[];
}

/** 扩展展开后的状态：同配方，没有组合档位 */
interface ExtensionState<P extends string> {
  names: readonly string[];
  segments: Map<string, Record<P, Compiled>>;
}

const compile = <P extends string>(styles: object) =>
  create(styles as Record<string, Record<string, unknown>>) as unknown as Record<P, Compiled>;

/** 档位的每个取值各 create 一次（惰性：第一次用到时才展开） */
function variantSegments<P extends string>(
  variants: Readonly<Record<string, Readonly<Record<string, object>>>>,
  segments: Map<string, Record<P, Compiled>>,
) {
  for (const [name, values] of Object.entries(variants)) {
    for (const [value, styles] of Object.entries(values)) {
      segments.set(`variant\0${name}\0${value}`, compile<P>(styles));
    }
  }
}

/** 每段样式各 create 一次，之后按档位组合查表 */
function build<P extends string, V extends Variants<P>>(
  config: RecipeConfig<P, V>,
): RecipeState<P> {
  const { parts, base = {}, variants = {} as V, compound = [], defaults = {} } = config;
  const segments = new Map<string, Record<P, Compiled>>([['base', compile<P>(base)]]);
  variantSegments(variants, segments);
  compound.forEach((entry, index) => {
    const { when, ...styles } = entry;
    void when;
    segments.set(`compound\0${index}`, compile<P>(styles));
  });
  return {
    parts,
    names: Object.keys(variants),
    defaults: defaults as Record<string, unknown>,
    segments,
    compound: compound.map(({ when }) => ({ when: when as Record<string, unknown> })),
  };
}

const extensions = new WeakMap<object, ExtensionState<string>>();

/** 扩展按对象展开一次 */
function extensionState<P extends string>(extension: RecipeExtension<P>): ExtensionState<P> {
  let result = extensions.get(extension) as ExtensionState<P> | undefined;
  if (!result) {
    const segments = new Map<string, Record<P, Compiled>>();
    if (extension.base) segments.set('base', compile<P>(extension.base));
    variantSegments(extension.variants ?? {}, segments);
    result = { names: Object.keys(extension.variants ?? {}), segments };
    extensions.set(extension, result as ExtensionState<string>);
  }
  return result;
}
