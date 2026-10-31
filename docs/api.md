# hiltkit 定稿 API（零编译路线）

代码在 `experiments/18-plain/hiltkit/`。这份文档只写实测过的行为，测试入口见末尾。

## 三条规则

1. **传函数才是活的，传值只取一次。** `{count}`、`{() => count() * 2}` 会更新，`{count()}` 只在创建时取一次。
2. **带 `()` 读，写用方法，对象字段直接赋值。** `count()`、`count.set(1)`、`form().name = 'x'`。
3. **传有 `set` 的 `Sig` 才能写回。** 组件收到值或只读函数时写不到外面。

没有编译器参与：标准 TS JSX（`jsx: react-jsx`、`jsxImportSource: hiltkit`；esbuild 用 `jsx: automatic`）产出描述对象，运行时建 DOM 或字符串。组件函数只执行一次。

## 响应式

```ts
import { sig, derived, effect, onCleanup, untrack, raw, snapshot } from 'hiltkit';

const count = sig(0); // Sig<number>
count(); // 读，并追踪
count.peek(); // 读，不追踪
count.set(1);
count.update((n) => n + 1);
count.inc();
count.dec(2); // 数字才有
const on = sig(false);
on.toggle(); // 布尔才有
const name = sig('');
name.trim(); // 写入时去空格的壳：<input value={name.trim()} />
const tags = sig<string[]>([]);
tags.has('a'); // 多选组用的 Sig<boolean>：写 true 加入，写 false 移除
```

方法在原型上，第一次取用才绑定，摘下来能直接当回调：`onClick={on.toggle}`。类型上 `inc` 只在数字上有，`toggle` 只在布尔上有，写错编译报错。

### 对象和列表

`sig(value)` 默认深代理（普通对象和数组；原始值、`Date`、类实例不代理）。

```ts
const form = sig({ name: '', address: { city: '' } });
form().name = '张三'; // 直接赋值，读这个字段的地方更新
form().address.city = '北京';

const list = sig([{ id: 1, done: false }]);
list().push({ id: 2, done: false });
list()[0]!.done = true;
```

字段要当壳传给别的组件或绑定时，用 `fields` 或 `at`：

```ts
const { name, address } = form.fields();     // 第一层每个字段一个壳，解构出来还是活的
const city = form.at((f) => f.address.city); // 任意深度。可空路径写 f.address?.city
<input value={name} />
<input value={city} />
```

- `at` 只接受字段路径。写成运算（`f.age + 1`）或调方法（`f.name.trim()`）会抛 `TypeError`。
- 路径中间为空时读到 `undefined`，写入抛错。

`sig.raw(value)` 不代理，只能 `set` 整体替换，给大列表和不可变数据用。经 `fields`、`at` 写它的字段会抛错，不会静默失效。

`raw(x)` 取代理背后的原对象；`snapshot(x)` 深拷贝成普通对象（序列化、发请求用）。

### 派生和副作用

```ts
const double = derived(() => count() * 2); // 只读，用到才算，算一次缓存
const fahrenheit = derived(
  () => (c() * 9) / 5 + 32,
  (f) => c.set(((f - 32) * 5) / 9),
); // 给 write 就是 Sig

effect(() => {
  document.title = name();
  return () => {}; // 可选的清理函数
});
onCleanup(() => {}); // 组件或分支销毁时
untrack(() => count());
```

`effect` 挂载后首次执行，服务端不执行。同一轮多次写入合并成一次。`flushSync()` 立刻刷新。

## 组件

```tsx
import { model, read, merge, type Prop, type Model, type Child, type HtmlProps } from 'hiltkit';

interface SwitchProps extends HtmlProps<'input'> {
  checked?: Model<boolean>;
  label?: Prop<string>;
  children?: Child;
}
export function Switch({ checked, label = '', children, ...rest }: SwitchProps) {
  const value = model(checked, false);     // 内部永远是 Sig
  return (
    <label>
      <input type="checkbox" checked={value} {...rest} />
      {label}
      {children}
    </label>
  );
}

<Switch />                    // 不传：自己持有状态
<Switch checked={true} />     // 传值：初值
<Switch checked={ro} />       // 只读函数：跟着变，写入留在本地
<Switch checked={on} />       // Sig：双向
<Switch checked={on() } />    // 值，只取一次（规则 1）
```

| 类型                  | 含义                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| `ReadSig<T>`          | `() => T`                                                                      |
| `ReadOnly<T>`         | 只读来源（普通函数、`derived`），`Sig` 不算                                    |
| `Sig<T>`              | 可读可写，类型不变（`Sig<string>` 不能传给 `Sig<string \| null>`）             |
| `Prop<T>`             | `T \| ReadSig<T>`，组件内用 `read(prop)` 取值                                  |
| `Model<T>`            | `T \| ReadOnly<T> \| Sig<T>`，组件内用 `model(prop, 默认值, onChange?)` 归一化 |
| `Child`               | JSX 能放的一切                                                                 |
| `HtmlProps<'button'>` | 元素的全部属性（class、style、sx、事件、aria、data）                           |

`model` 的第三个参数做受控：写入先生效，`onChange` 之后父级没采纳就退回。

组件就是普通函数，props 用原生解构、原生默认值，`...rest` 也是原生。没有代理，也不改写参数。解构拿到的是传进来的东西本身，所以活不活看调用方传的是什么（规则 1）。

## JSX

```tsx
<p>{count}</p>                         // 传壳
<p>{() => count() * 2}</p>             // 传函数
<p title={title} data-n={() => n()} /> // 属性同理
<input value={name} />                 // 传 Sig 双向
<input value={() => name()} />         // 传函数单向
<div ref={el} />                       // ref={sig} 或 ref={(el) => ...}
<button onClick={(e) => e.clientX} />  // 事件类型按元素推断，currentTarget 也准
```

双向只在 `input`、`textarea`、`select` 的 `value` 和 `checked` 上生效。其余属性收到 `Sig` 就是只读展示。

属性拼写用 HTML 的（`class`，不是 `className`）；`style` 的长度要带单位（`width: '10px'`）；`cond && 'x'` 这种会产生 `false` 的写法类型报错，改成 `() => cond() ? 'x' : undefined`。

### 条件和列表

```tsx
import { when, For } from 'hiltkit';

{() => on() ? <A /> : <B />}                  // 只有真假变了才重建分支
{when(user, (u) => <p>{() => u().name}</p>, () => <Login />)}  // 非空时给 u：不用 !

<For each={items}>{(item, index) => <li>{item.name}{index}</li>}</For>            // 按身份复用，item 是值
<For each={items} by={(item) => item.id}>{(item, index) => <li>{() => item().name}</li>}</For>  // 同键复用，item 是读取函数
```

标准 JSX 把 `key` 拿走给框架，到不了 props，所以这里叫 `by`。`each` 可以是 `Sig` 或函数。

### 属性合并

```tsx
<div {...merge({ class: 'a', onClick: first }, rest, { class: 'b', style: { color: 'red' } })} />
```

对象展开只会覆盖，要合并就显式调 `merge`：`class`、`sx` 拼接；`style` 分层，靠后的盖靠前的；事件都执行，靠后的先执行，`preventDefault` 后跳过前面的；`ref` 都给。

键本身会变时用 `dynamic`：`<div {...dynamic(() => mode() === 'a' ? { title: 'A' } : { 'data-b': 1 })} />`。

## 样式（`hiltkit/css`）

```tsx
import {
  create,
  recipe,
  keyframes,
  defineTokens,
  defineVars,
  createTheme,
  themeStyle,
  defineConditions,
  configure,
  renderStyleTag,
} from 'hiltkit/css';

const styles = create({
  root: { display: 'flex', ':hover': { opacity: 0.8 } },
  active: { fontWeight: 700 },
  bar: (width: string) => ({ width }),
});
<div sx={[styles.root, () => on() && styles.active, () => styles.bar(width())]} />;
```

`sx` 数组里写函数就是活的，依赖变了只换这一项。`recipe` 的档位可以是值、`Sig` 或读取函数：`button({ size: 'lg', tone: toneSig })`。`sx`、`class`、`style` 分开合并，互不覆盖。

### 主题和条件

```ts
export const t = defineTokens('app', { colors: { text: '#111' }, space: { md: '8px' } });
export const aliases = defineConditions({ _md: '@media (min-width: 700px)' });
declare module 'hiltkit/css' {
  interface TokenSets {
    app: typeof t;
  } // 登记后 color: '_text' 有补全，写错报错
  interface ConditionSets {
    app: typeof aliases;
  }
}
const dark = createTheme(t, { colors: { text: '#eee' } }); // 一个只改变量的类，放进 sx
<div sx={() => themeStyle(t, { colors: { text: color() } })} />; // 同样的覆盖写成行内变量，值可以运行时才定
```

主题层定制配方（组件库的主题）：`provideStyles({ Button: { variants: { size: { xl: { root: { fontSize: 24 } } } } } })` 给子树加一层，组件里用 `useRecipe(button, { size })` 取。

按祖先、兄弟的状态取值：

```ts
const card = defineMarker('app-card');
create({
  label: { color: { default: 'black', [relation.ancestor(':hover', card)]: 'blue' as const } },
});
```

计算键的值 TS 会放宽成 `string`，所以要写 `as const`。

防闪烁：`themeBootScript({ themes })` 内联到 head，`renderStyleTag(html, { include: themeBootClasses(themes) })` 带上候选主题。

动态样式（`bar`）的值：服务端渲染和接管过的页面一律写成 CSS 变量；纯客户端页面没变过的值直接写进类，变过一次后转成变量。

## 上下文和服务

```ts
const Theme = createContext('light');
provide(Theme, 'dark');
const theme = inject(Theme);

const Auth = createService(() => ({ user: sig('') }));
Auth.use(); // 第一次用时创建，整个应用一份；服务端按请求隔离
Auth.provide(mock); // 这棵子树用替身
```

## 其他组件

```tsx
<Boundary fallback={(error, retry) => <button onClick={retry}>{error.message}</button>}>…</Boundary>
<Portal to={document.body}>…</Portal>
const Big = lazy(() => import('./big'), { hydrate: 'visible' }); // load | visible | idle | interaction
const id = useId();                                              // 服务端和客户端一致
```

`interaction` 模式下，接管前的第一次点击会在接管后重放一次。

## 入口

```ts
mount(() => <App />, host); // 返回卸载函数
hydrate(() => <App />, host); // 接管服务端输出，返回卸载函数
const body = renderToString(() => <App />);
const head = renderStyleTag(body); // 放进 head 最前面，客户端接管这张表
await preloadLazy(); // 服务端渲染前加载 lazy 组件
```

## 工程配置

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "hiltkit" } }
```

```ts
// vite.config.ts：只有开发期热更新要这个插件，构建不用
import { hiltHot } from 'hiltkit/vite';
export default {
  oxc: { jsx: { runtime: 'automatic', importSource: 'hiltkit' } },
  plugins: [hiltHot()],
}; // Vite 8；更早的版本写 esbuild: { jsx: 'automatic', jsxImportSource: 'hiltkit' }
```

**发布组件库：** 只转 JSX，生成 `.d.ts`，一份 JS 同时给浏览器和服务端。`hiltkit` 放 `peerDependencies`。使用方不需要插件，也不需要重新编译。

`hiltHot` 只在文件末尾追加登记代码，不改写语义。只有全部导出都是组件的文件才就地更新，其余文件交给 Vite 向上找。

## 调试工具

一套协议，多个客户端：页面里的调试内核（`hiltkit/devtools`）提供方法，命令行、MCP、以后的浏览器插件都只是转发。生产构建不带调试内核，只多几处判断（实测见 `experiments/results/18-devtools-cost.txt`）。

```ts
// vite.config.ts：开发服务器注入调试内核，并开一个带令牌的接口
import { hiltDevtools, hiltHot } from 'hiltkit/vite';
export default { plugins: [hiltDevtools(), hiltHot()] };
```

```bash
pnpm exec hiltkit-devtools summary
```

```bash
pnpm exec hiltkit-devtools locate "#save"
```

```bash
pnpm exec hiltkit-devtools record start
```

```json
{ "mcpServers": { "hiltkit": { "command": "pnpm", "args": ["exec", "hiltkit-devtools-mcp"] } } }
```

| 方法       | 回答的问题                                                       |
| ---------- | ---------------------------------------------------------------- |
| `summary`  | 总览，第一个该调的                                               |
| `tree`     | 组件树；`depth`、`limit` 控制范围，`name` 按名字搜               |
| `inspect`  | 组件、effect、信号或元素的详情：props、当前值、依赖、订阅者      |
| `locate`   | 元素来自哪个文件哪一行、哪条组件链                               |
| `issues`   | 框架发现的问题，带编号、位置和修法                               |
| `record`   | 开始或结束录制，下面三个要先录                                   |
| `why`      | 这次更新是谁写了什么引起的，写入的代码位置，触发它的浏览器事件   |
| `timeline` | 录到的写入和运行，按时间排                                       |
| `perf`     | 谁跑得多、谁慢、谁白跑；同类绑定合并统计                         |
| `attrs`    | 属性从哪来：最终值、原始写法、class/style 的各层和合并它们的组件 |
| `set`      | 改信号的值，默认关闭                                             |

**问题编号：** `HILT001` 只取一次（`{count()}`），`HILT002` 水合不一致，`HILT003` effect 抛错，`HILT004` 服务端没设时区，`HILT005` 语言或时区写错，`HILT006` 日期格式不对，`HILT007` 金额没有币种，`HILT008` 自建主题对比度不够。

组件库上报问题用 `reportIssue(编号, 说明, 修法)`。

**边界：**

- 默认只读。`set` 要在页面里调用 `configureDevtools({ allowWrite: true })`。
- 键名匹配密码、令牌、密钥的值，以及绑到密码框上的信号，一律显示 `[已隐藏]`。规则可以用 `configureDevtools({ redact })` 改；不匹配规则的敏感内容（比如存在 `note` 字段里的令牌）隐藏不了。
- 接口要带发现文件里的随机令牌，别的网页不能借用户的浏览器调用。
- MCP 结果标了 `untrustedPageData`：页面内容可能来自用户输入，不能当指令执行。

**限制：**

- 已发布的组件库没有 JSX 行号，只有组件名；压缩过的库连组件名都没有。
- `why` 给的写入位置是 Vite 转换后的行号，可能和源文件差几行。一次录制最多记 2000 个调用栈。
- `attrs` 的分层只覆盖 `class`、`style`、`sx`。其他属性被 `merge` 覆盖后看不到被盖掉的值。
- 还没做：样式规则追踪（`styles`）、内存泄漏检查、浏览器插件。

## 组件库：Provider

`@hiltkit/ui` 的 `Provider` 给一棵子树设语言、时区和文案。可以嵌套，只覆盖写了的属性，其余实时继承上层。

```tsx
import { Provider, useFormat, useLocale, useMessages, commonMessages } from '@hiltkit/ui';
import zhCN from '@hiltkit/ui/locale/zh-CN';

const locale = sig('zh-CN');
<Provider locale={locale} timeZone="Asia/Shanghai" messages={zhCN}>
  <App />
</Provider>;
```

| 属性        | 说明                         | 不写时                             |
| ----------- | ---------------------------- | ---------------------------------- |
| `locale`    | BCP 47 语言标签              | 继承上层，最外层是 `en-US`         |
| `timeZone`  | IANA 时区                    | 继承上层，最外层用运行环境的时区   |
| `messages`  | 语言包，可以只翻一部分       | 继承上层，最后是组件自带的英文     |
| `dir`       | `ltr`、`rtl`                 | 写了 `locale` 按语言，否则继承上层 |
| `hourCycle` | `h12`、`h23`                 | 继承上层，最后按语言               |
| `weekStart` | 1（周一）到 7（周日）        | 继承上层，最后按语言               |
| `calendar`  | 日历，如 `buddhist`          | 继承上层，最后由语言决定           |
| `currency`  | `format.currency` 默认的币种 | 继承上层                           |

属性遵循框架规则：传值只取一次，传函数或 `sig` 才是活的。

**格式化：** 写在函数里才跟着语言变。空值返回空字符串。

```tsx
const format = useFormat();
<td>{() => format.date(order.createdAt)}</td>;
format.time(value);
format.dateTime(value);
format.relative(value);
format.number(1234.5);
format.currency(19.9, 'CNY');
format.list(['甲', '乙']);
```

**时刻和墙上时间：** `Date`、时间戳、带 `Z` 或时差的字符串是时刻，按当前时区换算。没有时区的字符串（`'2026-10-31'`、`'2026-10-31T14:30'`、`'14:30'`）是墙上时间，写的是几点就显示几点。Temporal 的对象用 `toString()` 传。

**读设置：** `useLocale()` 返回读取函数：`locale`、`timeZone`、`dir`、`hourCycle`、`weekStart`、`calendar`、`currency`。

**组件文案：** 每个组件自带英文默认值，语言包只覆盖要翻译的部分。

```tsx
const messages = defineMessages('dialog', {
  close: 'Close',
  remove: (name: string) => `Remove ${name}?`,
});
const t = useMessages(messages);
<button aria-label={() => t().close} />;

// 让语言包检查这组文案：少翻、写错名字都报错
declare module '@hiltkit/ui' {
  interface MessageCatalog {
    dialog: typeof messages.defaults;
  }
}
```

**服务端渲染：** 服务端不知道用户在哪，要传 `timeZone`（用户资料或 Cookie 里的）。没传时按 UTC 输出并上报 `HILT004`，接管本身不改 DOM，挂载后换成浏览器时区，只有用到时区的绑定更新一次，用户会看到时间跳一下。

**DOM：** 最外层和写了 `locale`、`dir` 的 Provider 会放一个 `display: contents` 的 `div` 带 `lang`、`dir`，不影响布局。有严格 CSP（禁止行内样式属性）的服务端渲染页面要注意。

**主题：** 内置 `lightTheme`（默认）、`darkTheme`、`navyTheme`，用 `theme` 属性设置。切换时子树不重建，只换变量。

```tsx
const brand = defineTheme(lightTheme, { name: 'brand', colors: { accent: '#0B6E4F' } });
<Provider theme={brand} />;
```

只写主色时，悬停色、主色上的文字色、链接色、焦点框都会算出来。对比度不够时上报 `HILT008`。

**token 直接写在样式里：** 导入组件库就有补全，写错或用错组都报错。短写按属性找组，要跨组写 `'_durations.fast'`；值里夹着 token 时用模板字符串和 `t`。

```tsx
const styles = create({
  row: { color: '_textSecondary', borderBottomColor: '_borderWeak', paddingBlock: '_sm', borderRadius: '_sm' },
  fade: { transition: `opacity ${t.durations.enter} ${t.easings.enter}` },
});
```

| 组             | 取值                                                                                                                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colors`       | `canvas`、`surface`、`elevated`、`text`、`textSecondary`、`textDisabled`、`borderWeak`、`borderSubtle`、`border`、`borderStrong`、`fillHover`、`fillSelected`、`fillDisabled`、`accent`、`accentHover`、`onAccent`、`accentText`、`focus`、`ok`、`warn`、`bad`、`badFill`、`badFillHover`、`onBad`、`overlay`、`chart1` 到 `chart5` |
| `space`        | `none`、`xxs`、`xs`、`sm`、`md`、`lg`、`xl`、`xxl`、`xxxl`                                                                                                                                                                                                                                                                          |
| `radii`        | `none`、`xs`、`sm`、`md`、`lg`、`full`                                                                                                                                                                                                                                                                                              |
| `sizes`        | `controlSm`、`controlMd`、`controlLg`、`buttonMin`                                                                                                                                                                                                                                                                                  |
| `borderWidths` | `none`、`hairline`、`thin`、`thick`                                                                                                                                                                                                                                                                                                 |
| `fontSizes`    | `xs`、`sm`、`md`、`lg`、`xl`、`xxl`                                                                                                                                                                                                                                                                                                 |
| `fontWeights`  | `regular`、`medium`                                                                                                                                                                                                                                                                                                                 |
| `shadows`      | `none`、`popup`、`modal`                                                                                                                                                                                                                                                                                                            |
| `durations`    | `fast`、`enter`、`exit`、`ripple`                                                                                                                                                                                                                                                                                                   |
| `easings`      | `standard`、`enter`、`exit`、`sharp`                                                                                                                                                                                                                                                                                                |

**设计取值：** 交互状态和浮层投影借鉴 MUI，暖中性色和细线分层借鉴 Claude Desktop，主色和危险色比 MUI 深，按钮 2 px 圆角、弹框 3 px。

**波纹和动效：** `Button` 自带波纹：按住时一直在，松开才淡出，键盘按 Enter、空格时从中心扩散。`<Provider ripple={false}>` 全局关闭，组件的 `ripple` 属性单独覆盖；自己的组件用 `useRipple` 和 `rippleStyles.host`。弹层用原生 `dialog` 配 `transitions.fade`、`transitions.slide`、`transitions.backdrop`。开启“减少动态效果”时，时长 token 都变成 0。

**还没做：** 弹层传送到 body 后的 `lang`、`dir`（做弹层组件时处理）；相对时间自动刷新。

## 已知代价

- `{count()}` 只取一次，TS 查不出。组件体和 `For` 的行里开发期有警告，辅助函数里可能没有。
- 迁移真实组件时代码变长：`ui.tsx` 从 322 行到 439 行（约 94 行是补上的真实类型），`() =>` 从 8 个到 63 个，`read(` 从 0 个到 43 个。
- 默认深代理读写比每字段一个 `sig` 慢约 2~3 倍，大列表用 `sig.raw`。
- 类型的限制：
  - `input` 不按 `type` 分支，`type="text"` 绑 `Sig<number>` 不报错。
  - 布尔属性不收字符串，包括 `''`。
  - 内置 `Omit<HtmlProps<…>>` 会让 `onClickCapture` 这类后缀事件退回通用 `Event`，要用 `HtmlProps<K, Managed>`。
  - `relation` 的值要写 `as const`。
- 完整类型的成本：1000 个组件检查 4.5 s、583 MB，比宽松类型每个组件多约 3 ms（`experiments/results/18-types.txt`）。

## 与 Vue 对比

Chromium，生产构建，串行运行，机器上有后台负载（IDE 等），看比例比看绝对值可靠。来源分三批：

- 列表创建和服务端渲染：优化后重测，`experiments/results/18-after-fix.txt`，开始时负载 20%。
- 接管、纯客户端挂载、产物：优化后重测，`experiments/results/18-vue-after-fix.txt`，开始时负载 66%，波动较大。
- 其余：优化前，`experiments/results/18-final.txt`，开始时负载 14%。这些场景不走改动的列表和 SSR 路径。

| 项目                                | Vue 3.5     | Vue 3.6 Vapor | hiltkit     |
| ----------------------------------- | ----------- | ------------- | ----------- |
| 同一组组件的产物 gzip               | 25.0 KB     | 34.3 KB       | **13.2 KB** |
| 1 万个 v-model 开关：创建           | 561 ms      | 671 ms        | **261 ms**  |
| 每个开关的内存                      | 4.89 KB     | 4.01 KB       | **0.78 KB** |
| 全部切换                            | 1263 ms     | 377 ms        | **57 ms**   |
| 1 万个三层按钮：创建                | 704 ms      | 1417 ms       | **387 ms**  |
| 每个按钮的内存                      | 5.90 KB     | 6.31 KB       | **0.36 KB** |
| 全部更新                            | 272 ms      | 795 ms        | **27 ms**   |
| 1 万行列表：创建（含布局）          | 645 ms      | **569 ms**    | 620 ms      |
| 1 万行列表：创建（只算脚本）        | 124 ms      | **98 ms**     | 141 ms      |
| 每 10 行改文字（只算脚本，1000 行） | 3.0 ms      | **0.7 ms**    | **0.7 ms**  |
| 交换两行（只算脚本）                | 2.1 ms      | **0.3 ms**    | 0.7 ms      |
| 1 万行纯元素：服务端渲染            | **2.8 ms**  | 未测          | 25.7 ms     |
| 1 万个三层按钮：服务端渲染          | 269 ms      | 未测          | **67 ms**   |
| 1 万行：接管                        | 120 ms      | 未测          | **100 ms**  |
| 1 万行：纯客户端挂载                | 166 ms      | 未测          | **159 ms**  |
| 单文件转换                          | **1.05 ms** | 1.14 ms       | 1.54 ms     |

**hiltkit 的好处：**

- 组件多、嵌套深的页面明显更快、更省内存，因为组件只是普通函数，没有实例。
- 组件库不需要重新编译，发布物就是一份 JS 和 `.d.ts`，使用方不装插件。
- 类型就是普通 TS：泛型组件、props、事件都不需要 `vue-tsc`。
- 产物约为 Vue 3.5 的一半。
- 属性合并、CSS、SSR 样式都是内置的。

**Vue 更好的地方：**

- 纯元素的服务端渲染快约 9 倍。模板编译几乎等于手写字符串（手写 2.6 ms），不编译追不上。一旦有组件，hiltkit 反而快约 4 倍；Vue 不用模板、改用 `h()` 时要 40 ms，比 hiltkit 慢。
- Vapor 的长列表创建更快（含布局少 8%，只算脚本少 30%）。hiltkit 含布局已略好于 Vue 3.5，只算脚本还慢 14%。
- 生态完整：Router、Pinia、Devtools、Transition、KeepAlive、Suspense、现成组件库。hiltkit 都没有。
- 模板能替你决定什么是活的，不用写 `() =>`，也没有 `{count()}` 只取一次的坑。
- 长期在生产环境使用过，hiltkit 只跑过实验和迁移的一组组件。

**没测的：** Vue 的开发速度（实验里没有配对应插件）；Vapor 的服务端渲染；真实大型应用；真机和低端设备。Vapor 尚未稳定，数字可能变。

**hiltkit 的开发速度（`dev.mjs`）：**

| 组件数 | 服务器就绪 | 首次打开 | 改组件生效 | 改样式生效 |
| ------ | ---------- | -------- | ---------- | ---------- |
| 300    | 162 ms     | 2.6 s    | 94 ms      | 95 ms      |
| 1000   | 44 ms      | 6.8 s    | 194 ms     | 196 ms     |

改组件时上层状态保留，没有整页刷新。

## 测试入口

在仓库根目录运行：

| 命令                    | 内容                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`        | 全仓库类型，含 `packages/core/test/types` 的正例和负例                                                                                 |
| `pnpm test`             | Vitest 单元测试（真浏览器）                                                                                                            |
| `pnpm test:integration` | 集成测试：行为、水合、组件库发布、真实组件迁移、随机测试、内存泄漏、调试工具；组件库的服务端渲染、时区水合、摇树、只走构建产物的使用方 |
| `pnpm check:packages`   | 发布产物的 `exports` 检查                                                                                                              |
