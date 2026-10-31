# 列表基准（krausest 式）

## 接入接口（加自己的原型看这里）

`run.mjs` 里框架列表是个数组，每项 `{ name, entry, build? }`：

```js
const FRAMEWORKS = [
  { name: 'solid', entry: here('./solid/entry.jsx'), build: buildOptions('solid') },
  // 加自己的原型：
  { name: 'mine', entry: here('./mine/entry.js') },
];
```

- `entry`：入口源码，用 esbuild 打成单文件 IIFE（`lib/browser.mjs` 的 `bundle`，生产模式、minify）。
- `build`（可选）：额外的 esbuild 选项（`plugins` / `alias` / `define`），需要编译 `.jsx` / `.svelte` / `.vue` 时用 `../lib/esbuild-plugin.mjs` 的 `buildOptions(kind)`。
- entry 必须挂 `window.bench`，并自己把 DOM 渲染进 `document.body`，结构是 `<table><tbody>` 下每行 `<tr><td>id</td><td><a>label</a></td><td><a class="remove">x</a></td></tr>`，选中行给 `<tr>` 加 class `danger`：

```js
window.bench = {
  create(n = 1000),   // 清掉旧数据，新建 n 行（id 全局递增）
  replace(n = 1000),  // 全部替换为 n 个新行（语义同 create，run.mjs 在已有 1000 行时调用）
  update(),           // 每 10 行（下标 0、10、20…）label 末尾追加 ' !!!'
  select(i),          // 选中下标 i 的行（tr 带 class danger，同时只有一行）
  swap(),             // 交换下标 1 与 998 两行（DOM 节点要跟着换，不能只改文字）
  remove(i),          // 删除下标 i 的行
  clear(),            // 清空
};
```

- 每个动作可以返回 Promise（框架异步刷新时返回等待刷新完成的 Promise）；`run.mjs` 会 `await` 它，再强制布局才停表。同步刷新的框架直接同步返回。
- `data.js` 的 `makeBench` 提供统一的数据（`buildData`）和 `window.bench` 外壳，原型也可以不用，自己实现上面的接口。
- 运行：在 `experiments` 目录 `node 05-compare/rows/run.mjs [--rounds=7] [--only=solid,svelte5]`。每轮一个新页面，先预热一遍全部动作，再各量一次，多轮取中位数；每个动作后校验 DOM 行数/选中/交换结果，不对会在末尾的「DOM 结果校验」里列出。

## 四个版本的口径

| name | 编译 | 说明 |
| --- | --- | --- |
| `solid` | babel-preset-solid（dom，非 hydratable） | 每行 `createSignal` 存 label；选中用 `createSelector`（krausest 的 Solid 版同样如此） |
| `svelte5` | svelte/compiler，client，非 dev | 行是 `class Row { label = $state() }`，列表 `$state.raw`；动作内 `flushSync()` |
| `vue36-vapor` | vue36 的 compiler-sfc，`vapor: true` | 与 vdom35 共用同一份 `App.vue` / `state.js`；每行 label 是 `shallowRef` |
| `vue35-vdom` | vue 3.5.44 的 compiler-sfc（优化后的 vdom，带 patch flag） | 同上；动作返回 `nextTick()` |

Vue 两个版本构建时都关了 `__VUE_OPTIONS_API__` / `__VUE_PROD_DEVTOOLS__`。

## 不对等之处（解读数据时注意）

- 选中：Solid 用 `createSelector`（O(1)），Svelte / Vue 是每行一个 `selected === row.id` 的绑定（O(n) 次比较，不触发 DOM 写）。
- Svelte 在动作里同步 `flushSync()`；Vue 是微任务刷新，计时里包含 `await nextTick()`。两者都在强制布局之前完成。
- 堆内存只测一次（全新页面、建 10000 行、强制 GC 后），是净增值，不含 DOM 节点本身的原生内存。
