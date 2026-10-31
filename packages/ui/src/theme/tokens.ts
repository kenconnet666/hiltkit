/**
 * 主题 token：组件和应用的样式都从这里取，不写裸值。
 *
 * 和传统的 CSS 变量不同，token 可以在样式里直接写，有补全，写错类型报错：
 *
 *   create({ row: { color: '_text', borderBottomColor: '_borderWeak', paddingBlock: '_sm', borderRadius: '_sm' } });
 *
 * 短写按属性查组（color 查 colors，paddingBlock 查 space），要跨组写 '_durations.lg'。
 * 值里夹着 token 时用模板字符串：`opacity ${t.durations.md} ${t.easings.enter}`。
 * 这里的取值就是亮色主题；别的主题只覆盖 colors、shadows，尺寸和动效所有主题相同。
 *
 * 这个模块有副作用（登记短写、写 :root 上的变量），package.json 的 sideEffects 里列了它：
 * 短写是字符串，打包器看不出依赖，摇掉后类型仍然通过，运行时才报找不到 token。
 */
import { defineTokens } from 'hiltkit/css';
import { lightPalette } from './palettes';

const reduce = '@media (prefers-reduced-motion: reduce)';
/** 时长：开启“减少动态效果”时都变成 0，组件不用单独判断 */
const motion = (ms: number) => ({ default: `${ms}ms`, [reduce]: '0ms' });

export const t = defineTokens('hk', {
  colors: { ...lightPalette.colors },
  shadows: { none: 'none', ...lightPalette.shadows },
  /** 偏硬朗：按钮、输入框 3 px，弹框 4 px */
  radii: { none: '0', xs: '2px', sm: '3px', md: '4px', lg: '6px', full: '9999px' },
  /** 留白是主要的分层手段，所以档位拉得开 */
  space: {
    none: '0',
    xxs: '2px',
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
    xxxl: '48px',
  },
  sizes: { controlSm: '28px', controlMd: '32px', controlLg: '40px' },
  borderWidths: {
    none: '0',
    // 1 倍屏画不出半像素，浏览器可能画得时有时无：只在高分屏上用 0.5 px
    hairline: { default: '1px', '@media (min-resolution: 2dppx)': '0.5px' },
    thin: '1px',
    thick: '2px',
  },
  fonts: {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    mono: 'ui-monospace, "SF Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace',
  },
  fontSizes: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px', xxl: '28px' },
  /** 只有两种字重：靠字重分层次，不靠加粗到 700 */
  fontWeights: { regular: '400', medium: '500' },
  lineHeights: { tight: '1.3', normal: '1.5' },
  /** press 按下反馈，fast 悬停，enter 弹框进场，drawer 抽屉进场，ripple 波纹 */
  durations: {
    press: motion(75),
    fast: motion(120),
    exit: motion(90),
    enter: motion(160),
    drawer: motion(220),
    ripple: motion(360),
  },
  easings: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    enter: 'cubic-bezier(0.2, 0, 0, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
  opacities: { disabled: '0.5' },
});

declare module 'hiltkit/css' {
  interface TokenSets {
    hiltkit: typeof t;
  }
}
