// recipe、createTheme、defineTokens 的返回、defineVars、defineConditions。
import type { HtmlProps } from '@hilt/runtime';
import { create, createTheme, defineConditions, defineVars, recipe, themeStyle } from '@hilt/css';
import { t } from './theme';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

// ---- recipe：推断档位名、取值、部件 ----
const button = recipe({
  name: 'Button',
  parts: ['root', 'icon', 'label'],
  base: { root: { display: 'inline-flex', paddingBlock: '_sm' }, icon: { flexShrink: 0 } },
  variants: {
    variant: { solid: { root: { backgroundColor: '_accent' } }, soft: { root: { backgroundColor: '_fill' } } },
    size: {
      sm: { root: { fontSize: '_sm' }, icon: { width: 12 } },
      lg: { root: { fontSize: '_lg' }, icon: { width: 20 } },
    },
    block: { true: { root: { width: '100%' } } },
  },
  compound: [{ when: { variant: 'solid', size: 'lg' }, root: { paddingInline: '_lg' } }],
  defaults: { variant: 'solid', size: 'sm' },
});

type Selection = NonNullable<Parameters<typeof button>[0]>;
assertType<Equal<Selection['variant'], 'solid' | 'soft' | null | undefined>>();
assertType<Equal<Selection['size'], 'sm' | 'lg' | null | undefined>>();
assertType<Equal<Selection['block'], boolean | null | undefined>>(); // 取值键是 'true' 时调用侧收布尔
assertType<Equal<keyof ReturnType<typeof button>, 'root' | 'icon' | 'label'>>();
assertType<Equal<(typeof button)['parts'], readonly ('root' | 'icon' | 'label')[]>>();

interface ButtonProps extends HtmlProps<'button'> {
  variant?: Selection['variant'];
  size?: Selection['size'];
}
export const Button = _component<ButtonProps>(({ variant, size, children, ...rest }) => {
  const s = button({ variant, size, block: false });
  return (
    <button {...s.root} {...rest}>
      <i {...s.icon} />
      <span {...s.label}>{children}</span>
      <span {...s.root} sx={[s.root.sx, { marginTop: '_xs' }]} />
    </button>
  );
});
export const useRecipe = (
  <>
    <Button variant="soft" size="lg">x</Button>
    {/* @ts-expect-error 档位取值 */}
    <Button variant="ghost" />
  </>
);

button();
button({});
button({ size: 'lg', block: true });
button({ variant: null });
// @ts-expect-error 档位名拼错
button({ varient: 'solid' });
// @ts-expect-error 档位取值拼错
button({ size: 'xl' });
// @ts-expect-error 布尔档位收布尔
button({ block: 'yes' });
// @ts-expect-error 部件不存在
button().footer;

// ---- recipe 定义时的校验 ----
recipe({
  parts: ['root'],
  variants: {
    size: {
      // @ts-expect-error 部件名不在 parts 里
      sm: { rooot: { padding: '_sm' } },
    },
  },
});
recipe({
  parts: ['root'],
  variants: { size: { sm: {}, lg: {} } },
  // @ts-expect-error 默认档位取值不存在
  defaults: { size: 'md' },
});
recipe({
  parts: ['root'],
  variants: { size: { sm: {} } },
  // @ts-expect-error compound 的 when 取值不存在
  compound: [{ when: { size: 'xl' }, root: {} }],
});
recipe({
  parts: ['root'],
  // @ts-expect-error base 里的属性拼写
  base: { root: { dispaly: 'flex' } },
});
recipe({
  parts: ['root'],
  // @ts-expect-error variants 里的 token 同样校验
  variants: { size: { sm: { root: { padding: '_text' } } } },
});

// ---- defineTokens 的返回：t.组.名 是变量引用字符串 ----
assertType<Equal<typeof t.colors.accent, string>>();
export const ref: string = t.space.md;
// @ts-expect-error 没有这个 token
void t.space.nope;
// @ts-expect-error 没有这个组
void t.nope;

// ---- createTheme：覆盖必须是 token 的子集 ----
export const dark = createTheme(t, { colors: { text: '#edeef0', bg: '#000' }, space: { md: '10px' } });
export const brand = createTheme(t.colors, { accent: 'rgb(255, 0, 128)' });
export const responsive = createTheme(t, { colors: { bg: { default: '#fff', '@media (prefers-color-scheme: dark)': '#000' } } });
export const sized = createTheme(t, { space: { md: 10 } });
// @ts-expect-error 没有这个组
createTheme(t, { colour: { text: 'red' } });
// @ts-expect-error 组里没有这个 token
createTheme(t, { colors: { texxt: 'red' } });
// @ts-expect-error 单个变量组：token 名校验
createTheme(t.colors, { nope: 'red' });
// @ts-expect-error 第一个参数不是 tokens
createTheme({ a: 1 }, {});
// @ts-expect-error 取值不是 CSS 值
createTheme(t, { colors: { text: {} } });

export const runtimeColor = (c: string) => themeStyle(t.colors, { accent: c });
// @ts-expect-error themeStyle 同样校验 token 名
themeStyle(t.colors, { accnt: 'red' });

// 主题可以挂到 sx；themeStyle 的结果也是 sx 取值
const styles = create({ row: { color: '_text' } });
export const Themed = _component<{ isDark: boolean; userColor: string }>(({ isDark, userColor }) => (
  <main sx={[isDark ? dark : brand]}>
    <p sx={[styles.row, dark, runtimeColor(userColor)]} />
  </main>
));

// ---- defineVars：组件私有变量组，不进短写 ----
const layout = defineVars('vtp-layout', { navHeight: '56px', gap: { default: '8px', '@media (min-width: 700px)': '16px' } });
export const navHeight: string = layout.navHeight;
export const layoutTheme = createTheme(layout, { navHeight: '64px' });
// @ts-expect-error 变量组里没有这个 token
createTheme(layout, { navHeigth: '64px' });
// 私有变量不进 token 短写：_navHeight 不是合法的 height 值
export const noShort = create({
  // @ts-expect-error defineVars 的变量不登记短写
  nav: { height: '_navHeight' },
});

// ---- defineConditions：返回别名表；别名名必须以 _ 开头，取值是条件 ----
export const extra = defineConditions({ _tablet: '@media (min-width: 900px)', _busy: '[aria-busy="true"]' });
// @ts-expect-error 名字不以 _ 开头
defineConditions({ loading: '[data-loading]' });
// @ts-expect-error 值不是选择器 / @ 规则
defineConditions({ _x: 'hover' });
// theme.ts 里登记的别名（_loading、_md、_wide）在 06-css.tsx 里可用；这里没登记的 _tablet 不可用
export const notRegistered = create({
  // @ts-expect-error _tablet 只定义没登记，类型层不认
  a: { color: { default: '_text', _tablet: '_accent' } },
});
