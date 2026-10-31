// sx、create、token 短写（按属性分组）、条件、keyframes 的类型正负例。
import { derived, merge, sig } from 'hilt';
import { create, keyframes } from 'hilt/css';
import { t } from './theme';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

// ---- create：静态与动态 ----
export const styles = create({
  root: {
    padding: '_md',
    color: { default: '_text', ':hover': '_accent', _selected: '_accentText', '@media (min-width: 768px)': '_text' },
    display: 'flex',
    margin: 0,
    width: '100%',
    border: '1px solid red',
    backgroundColor: 'var(--bg)',
    gap: '_sm',
    fontSize: '_lg',
    borderRadius: '_md',
    paddingInline: { default: '_md', '@media (min-width: 600px)': { default: '_lg', _hover: '_xs' } },
    marginTop: '_space.xl', // 带组名的写法
    transition: ['opacity 1s', 'none'], // 回退值数组
    height: 40, // 数字补单位，sx 里长度收数字
  },
  active: { fontWeight: 600, opacity: 0.5 },
  bar: (width: number) => ({ width, height: 6 }), // 动态样式：参数任意，返回松散的取值
  tinted: (c: string) => ({ color: c, '--bar-color': c }),
  raw: { transform: 'translateX(0)' },
});
assertType<Equal<keyof typeof styles, 'root' | 'active' | 'bar' | 'tinted' | 'raw'>>();
// 带 label（开发插件填的可读名字）
export const labeled = create({ a: { color: '_text' } }, 'file.a');

// ---- token 短写按属性分组：补全与校验 ----
export const groups = create({
  space: { padding: '_md', paddingTop: '_none', margin: '_xl', gap: '_lg', top: '_sm', inset: '_xs' },
  colors: { color: '_text', backgroundColor: '_accent', borderColor: '_border', outlineColor: '_bg', fill: '_text', stroke: '_accent' },
  fontSizes: { fontSize: '_md' },
  radii: { borderRadius: '_full', borderTopLeftRadius: '_sm' },
  // 带组名的写法可以跨组取值：宽度用 space 组
  cross: { width: '_space.md', height: '_space.lg', color: '_colors.accent' },
  // 值也可以写普通 CSS 值
  plain: { padding: '4px 8px', color: 'rgb(0 0 0 / 50%)', gap: 'calc(1px + 2px)', margin: 'auto', width: 'min(100%, 10px)' },
});

declare const someString: string;
export const Bad = create({
  // @ts-expect-error 拼错 token
  a: { padding: '_mdd' },
  // @ts-expect-error 用错组：颜色 token 写在 padding 上
  b: { padding: '_text' },
  // @ts-expect-error 用错组：space token 写在 color 上
  c: { color: '_md' },
  // @ts-expect-error radii 组没有 _lg
  d: { borderRadius: '_lg' },
  // @ts-expect-error 组合 token 不支持
  e: { padding: '_sm _md' },
  // @ts-expect-error 带组名的写法校验组名
  f: { width: '_spac.md' },
  // @ts-expect-error 拼错属性名
  g: { pading: '_md' },
  // @ts-expect-error 条件取值必须有 default
  h: { color: { ':hover': '_accent' } },
  // @ts-expect-error 拼错条件别名
  i: { color: { default: '_text', _selectd: 'red' } },
  // @ts-expect-error 条件键必须是别名或以 : @ [ 开头
  j: { color: { default: '_text', hover: '_accent' } },
  // @ts-expect-error 条件里的 token 同样校验
  k: { color: { default: '_text', ':hover': '_nope' } },
  // @ts-expect-error 嵌套条件里的 token 同样校验
  l: { padding: { default: '_md', '@media (min-width: 1px)': { default: '_text' } } },
  // @ts-expect-error 回退数组里的 token 同样校验
  m: { padding: ['_mdd', '1px'] },
  // @ts-expect-error 静态样式不收 string 变量（动态样式才行）
  n: { padding: someString },
  // @ts-expect-error 静态样式里不能写 CSS 自定义属性
  o: { '--x': '1' },
});

// 做不到：带组名的写法只校验组名，组里的 token 名不校验（列成字面量联合会让每个属性的补全多出几十条）
export const qualifiedNotChecked = create({ a: { width: '_space.nope' } });

// ---- 动态样式的反例 ----
export const BadDynamic = create({
  // @ts-expect-error 动态样式返回的属性名也检查
  a: (w: number) => ({ widht: w }),
  // @ts-expect-error 返回值不是对象
  b: (w: number) => w,
});

// ---- sx 的取值 ----
const active = sig(false);
const width = sig(10);
const tone = derived(() => (active() ? styles.active : undefined));
declare const count: number;
declare const color: string;

export const Sx = (
  <>
    <div sx={styles.root} />
    <div sx={[styles.root, active() && styles.active, styles.bar(width()), { marginTop: '_md' }]} />
    <div sx={[styles.tinted(color), styles.bar(2)]} />
    {/* 嵌套数组、假值 */}
    <div sx={[[styles.root, null, undefined, false], [[styles.raw]], true]} />
    <div sx={null} />
    <div sx={undefined} />
    <div sx={styles.bar(2)} />
    {/* 函数：返回样式项、假值、数组，依赖变了只换这一项 */}
    <div sx={() => active() && styles.active} />
    <div sx={[styles.root, () => active() && styles.active, () => styles.bar(width()), () => [styles.raw, { marginTop: '_md' }]]} />
    <div sx={[tone, () => (active() ? [styles.active, styles.raw] : null)]} />
    <div sx={[() => () => styles.root]} />
    {/* 对象字面量里也有条件、token */}
    <div sx={{ color: { default: '_text', _hover: '_accent', ':focus-visible': '_accent' } }} />
    <div sx={[{ padding: '_md' }, { padding: { default: '_sm', _md: '_lg' } }]} />
    {/* defineConditions 增加的别名：_loading（属性选择器）、_md（@media）、_wide（@container） */}
    <div sx={{ opacity: { default: 1, _loading: 0.5 }, fontSize: { default: '_sm', _md: '_lg', _wide: '_md' } }} />
    {/* 所有原生元素都有 sx */}
    <svg sx={styles.root}>
      <path sx={[styles.raw]} />
    </svg>
    <input sx={styles.root} />

    {/* ---- 反例 ---- */}
    {/* @ts-expect-error 拼错属性名 */}
    <div sx={{ pading: '_md' }} />
    {/* @ts-expect-error 拼错属性名（数组里的对象字面量也检查） */}
    <div sx={[styles.root, { marginTopp: '_md' }]} />
    {/* @ts-expect-error 拼错 token */}
    <div sx={{ padding: '_mdd' }} />
    {/* @ts-expect-error 用错组 */}
    <div sx={{ padding: '_text' }} />
    {/* @ts-expect-error 拼错的条件别名 */}
    <div sx={{ color: { default: '_text', _loadng: 'red' } }} />
    {/* @ts-expect-error 字符串不能当样式 */}
    <div sx="padding: 1px" />
    {/* @ts-expect-error 数字 0 不是假值（count && styles.x 的 0 会泄漏） */}
    <div sx={[count && styles.root]} />
    {/* @ts-expect-error 另一种取值：普通对象 { class } */}
    <div sx={{ class: 'a' }} />
    {/* @ts-expect-error 动态样式的函数不能直接当 sx（要先调用） */}
    <div sx={styles.bar} />
    {/* @ts-expect-error 函数返回的东西同样检查 */}
    <div sx={() => ({ pading: '_md' })} />
    {/* @ts-expect-error 函数返回字符串 */}
    <div sx={[() => 'padding: 1px']} />
    {/* @ts-expect-error 函数返回数字 */}
    <div sx={() => count} />
    {/* 做不到：csstype 的取值是开放字符串，没有 token 的属性写错关键字（display: 'flxe'）不报错 */}
    <div sx={{ display: 'flxe' }} />
  </>
);

// t 的变量引用只是字符串：用在夹在值中间的位置
export const interpolated = create({ box: { boxShadow: `0 0 0 1px ${t.colors.accent}`, padding: `calc(${t.space.md} * 2)` } });

// 做不到：以插值开头的模板字符串，类型是 `${string} 0`，可能以 _ 开头，在有 token 的属性上被拒（把插值包进 calc() 或放在字面量后面）
export const interpolatedFirst = create({
  // @ts-expect-error 以插值开头
  box: { padding: `${t.space.md} 0` },
});

// ---- keyframes ----
export const spin: string = keyframes({ from: { transform: 'rotate(0)' }, '50%': { opacity: 0.5 }, to: { transform: 'rotate(360deg)' } });
// @ts-expect-error 步骤名只有 from、to、百分比
keyframes({ middle: { opacity: 1 } });
// @ts-expect-error 属性名同样检查
keyframes({ from: { opacty: 1 } });
export const animated = create({ spinner: { animationName: spin, animationDuration: '2s' } });

// ---- merge 和 sx：数组、函数在合并后仍是合法的 sx ----
const own = { sx: [styles.root, () => active() && styles.active] };
const rest = { sx: { margin: 0 }, class: 'x' };
<div {...merge(own, rest)} />;
<div {...merge(own, { class: ['a'], 'data-x': 1 })} />;
