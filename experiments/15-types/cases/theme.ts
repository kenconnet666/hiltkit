/**
 * 应用的 tokens 与条件别名：定义和类型层登记写在一起。
 * 登记是一行声明合并，类型直接取自 defineTokens / defineConditions 的返回值，所以名字只写一次。
 */
import { defineConditions, defineTokens } from '@hilt/css';

export const t = defineTokens('vtp', {
  colors: {
    text: '#1c2024',
    textDisabled: '#8b8d98',
    accent: '#3e63dd',
    accentText: '#ffffff',
    bg: '#ffffff',
    border: '#d9d9e0',
    fill: { default: '#f0f0f3', '@media (prefers-color-scheme: dark)': '#2a2a2e' },
  },
  space: { none: 0, xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
  fontSizes: { sm: '12px', md: '14px', lg: '16px' },
  radii: { sm: '4px', md: '8px', full: '9999px' },
});

export const conditions = defineConditions({
  _loading: '[data-loading]',
  _md: '@media (min-width: 700px)',
  _wide: '@container (min-width: 400px)',
});

declare module '@hilt/css' {
  interface TokenSets {
    vtp: typeof t;
  }
  interface ConditionSets {
    app: typeof conditions;
  }
}
