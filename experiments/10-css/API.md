# CSS API 一页纸（10-css 实验定稿）

引擎在 `engine/`；元素上的 class / style / sx 落点在 `03-publish/packages/runtime/attrs.js`，sx 拆分和开发模式热更新在 `03-publish/packages/compiler/index.mjs`。
断言与基准：`node 10-css/run.mjs [--only=sx,recipe,conditions,theme,priority,ssr,dev,size,bench]`。

## 1. 元素上写 `sx`

```tsx
import { create, defineTokens, recipe, createTheme } from '@hilt/css';

const styles = create({
  root: { padding: '_md', color: { default: '_text', ':hover': '_accent', _selected: '_accentText' } },
  active: { fontWeight: 600 },
  bar: (width: number) => ({ width, height: 6 }), // 动态样式：值变过的属性转成行内变量，类名不变
});

<div
  sx={[styles.root, active && styles.active, styles.bar(width), { marginTop: '_md' }]}
  class={userClass}   // 使用方的 class / style 与引擎各管各的，互相不冲掉
  style={{ outline: '1px solid red' }}
/>;
```

- 跨组件层按 JSX 书写顺序合并，靠后的优先；一个元素只有一个生成类。普通值整体替换前面的同名属性，条件对象逐项合并（条件里的 `null` 表示不改）。
- 编译器把 sx 数组拆开：静态项（`styles.root`、冻住提到模块顶层的字面量）原样放进数据，**不起 effect**；
  依赖状态的项换成 `select(() => active() && styles.active)`、`bind(styles.bar, () => [width()])`（`@hilt/css/abi`，不是用户 API），
  一个元素最多一个 effect 管全部动态项。认不出的写法也走 `select`，不会出错。
- 引擎只换自己的类和 `--x-*` 变量；`class`、`style`、第三方库与过渡动画加的类不受影响（`attrs.js` 的 `Host`）。

## 2. 配方

```tsx
const button = recipe({
  name: 'Button',                                  // data-scope，主题层按它找定制
  parts: ['root', 'icon', 'label'],
  base: { root: { display: 'inline-flex' }, icon: { flexShrink: 0 } },
  variants: {
    variant: { solid: { root: { backgroundColor: '_accent' } }, soft: { root: { backgroundColor: '_fill' } } },
    size: { sm: { root: { fontSize: 12 }, icon: { width: 12 } }, lg: { root: { fontSize: 16 }, icon: { width: 20 } } },
  },
  compound: [{ when: { variant: 'solid', size: 'lg' }, root: { paddingInline: 24 } }],
  defaults: { variant: 'solid', size: 'sm' },
});

const Button = _component(({ variant, size, children, ...rest }) => {
  const s = useRecipe(button, { variant, size });  // 活对象；不要主题层时直接 button({ variant, size })
  return (
    <button {...s.root} {...rest}>                  {/* s.root = { sx, 'data-scope': 'button', 'data-part': 'root' } */}
      <i {...s.icon} />
      <span {...s.label}>{children}</span>
    </button>
  );
});
```

- 叠加顺序：基础 < 档位 < 组合档位 < 主题层定制 < 使用方 `sx`。
- 部件惰性创建；部件只读自己用到的档位，档位变了只有读了它的部件更新；档位不是活的时部件创建时算一次、不起 effect。
- 响应式档位：`size={{ base: 'sm', md: 'lg' }}`（键是 `defineConditions` 里 `_md` 这样的 @ 规则别名）。实验里有（约 35 行），**建议 v1 不开**（库里 0 处使用）。
- 主题层：`provideStyles({ Button: { base: {...}, variants: { size: { xl: { root: {...} } } } } })`（context，原型链，子树生效）；
  provider 组件可以直接返回 children，运行时会带上组件体里 provide 出来的 context。

## 3. 条件

```ts
color: { default: '_text', ':hover': '_accent', _selected: '_accentText', '@media (min-width: 768px)': '_lg' }
```

- 原生伪类写原样（库里 255 处原样、`_hover` 只有 2 处）；别名只留“一个状态有几种 DOM 写法”的：`_selected`（aria-selected / data-selected）、
  `_disabled`、`_checked`、`_pressed`、`_expanded`、`_open`、`_invalid`、`_current`，和环境 `_forcedColors`、`_reducedMotion`、`_rtl`。
- 自定义：`defineConditions({ _loading: '[data-loading]', _md: '@media (min-width: 768px)', _wide: '@container (min-width: 400px)' })`（入口处调用，名字以 `_` 开头）。
- 容器查询、`@media`、`@starting-style`、`when.ancestor/descendant(伪类, marker)` 都是条件键；`when` 的兄弟三个无人使用，建议删。
- 状态变化只改 DOM 属性时，类名不变、规则不增；用 `cond && styles.x` 表达 n 个布尔状态会长到 2ⁿ 个组合类（实测 4 个状态 16 个类）。

## 4. 主题

```ts
export const t = defineTokens('vtp', {                // 每组一个变量组（--vtp-colors-accent），同时登记 '_md' 这样的短写
  colors: { text: '#1c2024', accent: '#3e63dd' }, space: { md: '8px' },
});
export const dark = createTheme(t, { colors: { text: '#edeef0' }, space: { md: '10px' } });  // 一个类，可跨组
<section sx={[dark]}>…</section>                                   // 局部、嵌套都是 CSS 继承；同一 sx 里后者覆盖
<p sx={[themeStyle(t.colors, { accent: userColor })]} />            // 运行时随便给的颜色：行内变量，不进规则表
```

- 全局切换：把主题类挂在 `<html>` 或根元素的 sx 上，换类即可，组件不渲染、DOM 只改一处（实测）。
- 首屏防闪烁：`<script>${themeBootScript({ themes: { light, dark } })}</script>` 在 `<head>` 里按 localStorage / 系统偏好把主题类加到 `<html>`；
  `renderStyleTag(html, { include: themeBootClasses(themes) })` 保证候选主题的规则都在首屏样式里。

## 5. SSR

```ts
const body = renderToString(() => <App />);
const head = renderStyleTag(body, { include: themeBootClasses(themes) }); // <style data-hilt-css data-names="…">，放 head 最前
```

客户端第一次用引擎时接管这张表（`data-names` 登记为已插入）；服务端与接管后的页面动态样式一律写成变量，两边类名一致。

## 6. 优先级与配置

```ts
configure({ specificity: 'where' });                                        // :where(.c)，使用方任何选择器都能盖过
configure({ layer: 'components', layerOrder: 'theme, base, components, utilities' }); // Tailwind v4 项目
```

| | 使用方单类 vs 组件 @media / :hover | Tailwind 工具类（@layer utilities）| preflight（@layer base）|
| --- | --- | --- | --- |
| `.c`（plain） | 组件赢 | 组件赢 | 组件赢 |
| `:where(.c)` | 使用方赢 | 组件赢 | 组件赢 |
| `@layer components` + 声明顺序 | 使用方赢 | 使用方赢 | 组件赢 |

必须在第一条规则插入前调用；SSR 与客户端用同一份配置。

## 7. 开发

`configure({ dev: true })` + 编译器 `dev: true`：顶层 `create` / `recipe` 包 `hotStyles(id, …)`（热更新原地改写、类名不变）；类名 `Button-root-x1abc`；
`<style>` 里是规则原文，每条前有 `/* 由哪些片段组成 */` 注释；部件元素带 `data-scope` / `data-part`。生产：只有 `x1abc` 类名，规则走 `insertRule`。
