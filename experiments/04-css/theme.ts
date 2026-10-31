// 实验用的主题 tokens：基准、断言、构建期预计算（Node 里）共用。
import * as css from './engine/runtime';

const LIGHT = { text: '#1f2328', fill: '#e5e7eb', accent: '#3e63dd', dangerText: '#c0392b' };
const DARK = { text: '#e6edf3', fill: '#374151', accent: '#8da4ef', dangerText: '#ff6b6b' };

export const colors = css.defineVars('b-colors', LIGHT);
export const space = css.defineVars('b-space', { sm: '4px', md: '8px', lg: '16px' });
// 登记后样式里才能写短写：color: '_text'、gap: '_md'
css.defineTokens({ colors, space });

export const lightTheme = css.createTheme(colors, LIGHT);
export const darkTheme = css.createTheme(colors, DARK);
/** 手写 CSS 对照组换主题用：同样的变量、同样的值 */
export const DARK_CSS = Object.entries(DARK)
  .map(([key, value]) => `--b-colors-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
  .join(';');
