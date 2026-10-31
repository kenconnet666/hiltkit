/**
 * 主题对象：内置三套，用户也可以基于任意一套改。交给 `<Provider theme={...}>`。
 *
 *   const brand = defineTheme(lightTheme, { name: 'brand', colors: { accent: '#0B6E4F' } });
 *
 * 只写主色就够：悬停色和上面的文字色会算出来，其余沿用基础主题。写了也可以覆盖任何一个 token。
 * 对比度不够时上报 HILT008，不拦着。
 */
import { reportIssue } from 'hiltkit';
import { create, createTheme } from 'hiltkit/css';
import { contrast } from './contrast';
import {
  darkPalette,
  lightPalette,
  navyPalette,
  type Palette,
  type ThemeColors,
  type ThemeShadows,
} from './palettes';
import { t } from './tokens';

export interface Theme {
  readonly name: string;
  readonly colorScheme: 'light' | 'dark';
  readonly colors: Readonly<ThemeColors>;
  readonly shadows: Readonly<ThemeShadows>;
  /** 放到容器的 sx 上：换变量，并给子树默认的文字色和字体 */
  readonly style: readonly unknown[];
}

const base = create({
  root: { color: '_text', fontFamily: '_sans', fontSize: '_md', lineHeight: '_normal' },
});

function buildTheme(name: string, palette: Palette): Theme {
  // 第一次用到才生成规则：导入了不用的主题不插样式
  let style: readonly unknown[] | undefined;
  return {
    name,
    colorScheme: palette.colorScheme,
    colors: palette.colors,
    shadows: palette.shadows,
    get style() {
      return (style ??= [
        createTheme(t, { colors: palette.colors, shadows: palette.shadows } as never),
        base.root,
      ]);
    },
  };
}

export const lightTheme: Theme = /* @__PURE__ */ buildTheme('light', lightPalette);
export const darkTheme: Theme = /* @__PURE__ */ buildTheme('dark', darkPalette);
export const navyTheme: Theme = /* @__PURE__ */ buildTheme('navy', navyPalette);

/** 主色上放白字还是深字：选对比度高的 */
function textOn(color: string, light: string, dark: string): string | undefined {
  const onLight = contrast(light, color);
  const onDark = contrast(dark, color);
  if (onLight === undefined || onDark === undefined) return undefined;
  return onLight >= onDark ? light : dark;
}

const CHECKS: readonly (readonly [keyof ThemeColors, keyof ThemeColors, number])[] = [
  ['text', 'surface', 4.5],
  ['textSecondary', 'surface', 4.5],
  ['onAccent', 'accent', 4.5],
  ['accentText', 'surface', 4.5],
  ['border', 'surface', 3],
];

export interface ThemeOptions {
  /** 主题名，写在容器的 data-theme 上 */
  name: string;
  /** 影响原生表单控件和滚动条。不写时沿用基础主题 */
  colorScheme?: 'light' | 'dark';
  colors?: Partial<ThemeColors>;
  shadows?: Partial<ThemeShadows>;
}

/** 基于已有主题改。只写 accent 时，悬停色、上面的文字色、链接色、焦点框都跟着算 */
export function defineTheme(from: Theme, options: ThemeOptions): Theme {
  const { colors: own = {} } = options;
  const derived: Partial<ThemeColors> = {};
  if (own.accent) {
    const mixTo = from.colorScheme === 'dark' ? '#FFFFFF' : '#000000';
    derived.accentHover = `color-mix(in srgb, ${own.accent} 85%, ${mixTo})`;
    derived.accentText = own.accent;
    derived.focus = own.accent;
    const onAccent = textOn(own.accent, '#FFFFFF', '#101114');
    if (onAccent) derived.onAccent = onAccent;
  }
  const colors = { ...from.colors, ...derived, ...own };
  for (const [front, back, least] of CHECKS) {
    const ratio = contrast(colors[front], colors[back]);
    if (ratio !== undefined && ratio < least) {
      reportIssue(
        'HILT008',
        `主题 ${options.name} 的 ${front} 在 ${back} 上对比度只有 ${ratio.toFixed(1)}，要求 ${least}。`,
        `调整 ${front} 或 ${back}。`,
      );
    }
  }
  return buildTheme(options.name, {
    colorScheme: options.colorScheme ?? from.colorScheme,
    colors,
    shadows: { ...from.shadows, ...options.shadows },
  });
}
