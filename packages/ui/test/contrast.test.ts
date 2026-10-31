// 三套内置主题的对比度：改色值时这里把关
import { describe, expect, test } from 'vitest';
import { contrast } from '../src/theme/contrast';
import { darkPalette, lightPalette, navyPalette, type ThemeColors } from '../src/theme/palettes';

/** 文字 4.5，控件边界和图形 3（WCAG 1.4.3、1.4.11） */
const RULES: readonly (readonly [keyof ThemeColors, keyof ThemeColors, number])[] = [
  ['text', 'surface', 4.5],
  ['text', 'canvas', 4.5],
  ['text', 'elevated', 4.5],
  ['textSecondary', 'surface', 4.5],
  ['textSecondary', 'canvas', 4.5],
  ['onAccent', 'accent', 4.5],
  ['onAccent', 'accentHover', 4.5],
  ['accentText', 'surface', 4.5],
  ['accentText', 'elevated', 4.5],
  ['onBad', 'bad', 4.5],
  ['ok', 'surface', 4.5],
  ['warn', 'surface', 4.5],
  ['bad', 'surface', 4.5],
  ['border', 'surface', 3],
  ['focus', 'surface', 3],
  ['chart1', 'surface', 3],
  ['chart2', 'surface', 3],
  ['chart3', 'surface', 3],
  ['chart4', 'surface', 3],
  ['chart5', 'surface', 3],
];

for (const [name, palette] of [
  ['亮色', lightPalette],
  ['暗色', darkPalette],
  ['深蓝', navyPalette],
] as const) {
  describe(name, () => {
    for (const [front, back, least] of RULES) {
      test(`${front} 在 ${back} 上不低于 ${least}`, () => {
        const ratio = contrast(palette.colors[front], palette.colors[back]);
        expect(ratio).toBeDefined();
        expect(ratio!).toBeGreaterThanOrEqual(least);
      });
    }
  });
}
