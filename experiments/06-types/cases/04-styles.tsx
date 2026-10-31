/**
 * 第 6 条：sx、css.create、css.recipe。
 */
import { css, type PartProps } from 'exp06';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

// ---- css.create：静态与动态 -----------------------------------------------------------------

const styles = css.create({
  root: {
    padding: '_md',
    color: { default: '_text', ':hover': '_accent', _selected: 'red' },
    display: 'flex',
    margin: 0,
    width: '100%',
    border: '1px solid red',
    backgroundColor: 'var(--bg)',
    gap: '_sm',
    fontSize: ['_sm', '1rem'], // 回退值数组
    paddingInline: { default: '_md', '@media (min-width: 600px)': { default: '_lg', _hover: '_xs' } },
  },
  bar: (w: string) => ({ width: w, color: '_text', '--bar-width': w }),
  raw: { transform: 'translateX(0)' },
});

assertType<Equal<keyof typeof styles, 'root' | 'bar' | 'raw'>>();

// ---- sx 的取值 ---------------------------------------------------------------------------

export const Sx = _component<{ active?: boolean; count: number }>(({ active, count }) => (
  <>
    <div sx={styles.root} />
    <div sx={[styles.root, active && styles.root, styles.bar('1px'), { marginTop: '_md' }]} />
    {/* 嵌套数组、假值 */}
    <div sx={[[styles.root, null, undefined, false], [[styles.raw]], true]} />
    <div sx={null} />
    <div sx={undefined} />
    {/* 动态样式的结果是 [样式组, 行内变量] */}
    <div sx={styles.bar('2px')} />
    {/* 对象字面量里也有条件、token */}
    <div sx={{ color: { default: '_text', _hover: '_accent', ':focus-visible': '_accent' } }} />
    {/* svg 等所有原生元素都有 sx */}
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
    {/* @ts-expect-error 用错组：颜色 token 写在 padding 上 */}
    <div sx={{ padding: '_text' }} />
    {/* @ts-expect-error 组合 token 不支持（'_sm _md'） */}
    <div sx={{ padding: '_sm _md' }} />
    {/* @ts-expect-error 拼错条件别名 */}
    <div sx={{ color: { default: '_text', _selectd: 'red' } }} />
    {/* @ts-expect-error 条件取值必须有 default */}
    <div sx={{ color: { _hover: '_accent' } }} />
    {/* @ts-expect-error 条件别名之外的键必须是 : @ [ 开头 */}
    <div sx={{ color: { default: '_text', hover: '_accent' } }} />
    {/* @ts-expect-error 字符串不能当样式 */}
    <div sx="padding: 1px" />
    {/* @ts-expect-error 数字 0 不是假值（count && styles.x 的 0 会泄漏；与 React 的 {0} 同类问题，这里选择拦下） */}
    <div sx={[count && styles.root]} />
    {/* @ts-expect-error 另一种 sx 取值：普通对象 { class } */}
    <div sx={{ class: 'a' }} />
    {/* 做不到：csstype 的取值是开放字符串，display: 'flxe' 这类拼错的关键字不报错（只有 token 能校验） */}
    <div sx={{ display: 'flxe' }} />
    {/* @ts-expect-error 动态函数不能直接当 sx（要先调用） */}
    <div sx={styles.bar} />
  </>
));

// ---- create 里的反例 -------------------------------------------------------------------------

css.create({
  // @ts-expect-error create 里拼错 token
  a: { padding: '_mdd' },
});
css.create({
  // @ts-expect-error create 里拼错属性
  a: { pading: 1 },
});
css.create({
  a: { color: '_text' },
  // 动态样式里的值不校验 token（运行时才知道），也允许 string 变量
  b: (c: string, n: number) => ({ color: c, width: n }),
});
// 做不到：动态样式的返回值不做拼写检查（Loose 带 --x 的索引签名，且返回值不是新鲜字面量）
const dynamicTypo = css.create({ b: (w: string) => ({ widht: w }) });
void dynamicTypo;
css.create({
  // @ts-expect-error 静态样式里不能写 --x 自定义属性（保持弱类型以便查拼写）；走动态样式或 defineVars
  a: { '--x': '1px' },
});

// ---- 用 string 变量写静态样式：被拦（NotToken 的代价）------------------------------------------

const someString: string = '1px';
css.create({
  // @ts-expect-error 静态样式的值必须是字面量；string 变量走动态样式
  a: { padding: someString },
});

// ---- css.recipe --------------------------------------------------------------------------------

const button = css.recipe({
  name: 'Button',
  parts: ['root', 'icon'],
  base: { root: { display: 'inline-flex', color: { default: '_text', _disabled: '_textDisabled' } } },
  variants: {
    size: { sm: { root: { fontSize: '_sm' } }, md: {} },
    fullWidth: { true: { root: { width: '100%' } }, false: {} },
  },
  compound: [{ when: { size: 'sm', fullWidth: true }, root: { paddingInline: 0 } }],
  defaults: { size: 'md' },
});

export const Btn = _component<PartProps<'button'> & { size?: 'sm' | 'md'; wide?: boolean }>(
  ({ size, wide, ...rest }) => {
    const s = button({ size, fullWidth: wide });
    assertType<Equal<keyof typeof s, 'root' | 'icon'>>();
    return (
      <button {...s.root} {...rest}>
        <svg {...s.icon} />
      </button>
    );
  },
);

button();
button({});
button({ size: 'sm' });
button({ size: null, fullWidth: undefined });
// @ts-expect-error 档位取值 'xl' 不存在
button({ size: 'xl' });
// @ts-expect-error 布尔档位收 boolean
button({ fullWidth: 'yes' });
// @ts-expect-error 档位名不存在
button({ tone: 'a' });

// 返回值的部件名从 parts 推出
const parts = button();
parts.root;
// @ts-expect-error 没有 body 部件
parts.body;

// recipe 定义里的反例
css.recipe({
  parts: ['root'],
  base: {
    // @ts-expect-error 没声明的部件
    body: { display: 'flex' },
  },
});
css.recipe({
  parts: ['root'],
  variants: {
    size: {
      sm: {
        // @ts-expect-error 档位里的部件也要在 parts 里
        icon: { fontSize: '_sm' },
      },
    },
  },
});
css.recipe({
  parts: ['root'],
  variants: {
    size: {
      // 混写正确与拼错的属性：必须报错（不能因为“弱类型有交集”而放过）
      // @ts-expect-error pading 拼错
      sm: { root: { display: 'flex', pading: 0 } },
    },
  },
});
css.recipe({
  parts: ['root'],
  variants: { size: { sm: {}, md: {} } },
  // @ts-expect-error defaults 取值必须在档位里
  defaults: { size: 'xl' },
});
css.recipe({
  parts: ['root'],
  variants: { size: { sm: {}, md: {} } },
  // @ts-expect-error compound 的 when 取值也检查
  compound: [{ when: { size: 'xl' }, root: { display: 'flex' } }],
});

// ---- 部件属性包展开到元素 -------------------------------------------------------------------

export const Spread = _component<{}>(() => {
  const s = button();
  return (
    <div>
      <button {...s.root} />
      <button {...s.root} type="submit" onClick={(e) => e.currentTarget.disabled} />
      <span {...s.root} />
      <svg {...s.icon} />
      <input {...s.root} />
      {/* @ts-expect-error 属性包是对象，不能当 sx 之外的属性用 */}
      <button hidden={s.root} />
    </div>
  );
});

// 带 sx 的 PartProps 展开：用户的 sx 覆盖/合并由编译器规则决定，类型上两个 sx 并存
export const Merge = _component<PartProps<'button'>>(({ ...rest }) => {
  const s = button();
  return <button {...s.root} {...rest} sx={[s.root.sx, rest.sx]} />;
});

// ---- 应用扩展 token（cases/theme.d.ts 里的模块扩展）-----------------------------------------------

css.create({ a: { padding: '_xl', color: '_danger' } });
css.create({
  // @ts-expect-error _danger 登记在颜色组，不能写在 padding 上
  a: { padding: '_danger' },
});
