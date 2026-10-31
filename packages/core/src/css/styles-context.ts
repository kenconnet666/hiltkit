/**
 * 主题层对配方的定制（createUi / Provider 的 styles）：挂在 context 上，按层叠加（外层在前），
 * 组件里 `useRecipe(button, selection)` 把各层里属于这个配方的扩展交给配方。
 * context 走运行时的原型链（provide 只新建一层），组件深度不影响查找成本。
 */
import { createContext, inject, provide } from '../reactivity/kernel';
import type { Recipe, RecipeExtension } from './recipe';

/** 一层定制：配方名 → 扩展 */
export type StylesLayer = Readonly<Record<string, RecipeExtension>>;

const stylesContext = createContext<readonly StylesLayer[]>([]);

/**
 * 在当前组件的子树里追加一层定制：`provideStyles({ Button: { variants: { size: { xl: { root: { fontSize: 24 } } } } } })`。
 * layer 对象要稳定（写在模块里或 createUi 的配置里），配方按扩展对象缓存
 */
export function provideStyles(layer: StylesLayer) {
  provide(stylesContext, [...inject(stylesContext), layer]);
}

/** 配方 + 当前 context 里各层的定制：`const s = useRecipe(button, { size })` */
export function useRecipe<R extends Recipe<string, never>>(
  recipe: R,
  selection?: Parameters<R>[0],
): ReturnType<R> {
  const extensions = inject(stylesContext)
    .map((layer) => (recipe.name ? layer[recipe.name] : undefined))
    .filter(Boolean);
  return recipe(selection, ...(extensions as RecipeExtension[])) as ReturnType<R>;
}
