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
  /** 比 MUI 默认的 4 px 小，显得专业：按钮、输入框 2 px，弹框 3 px */
  radii: { none: '0', xs: '1px', sm: '2px', md: '3px', lg: '4px', full: '9999px' },
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
  /** 和 MUI 按钮的实际高度相近，取整数 */
  sizes: { controlSm: '30px', controlMd: '36px', controlLg: '42px', buttonMin: '64px' },
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
  /** 对应 MUI 的 caption、小按钮、body2、body1、h6、h5 */
  fontSizes: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px', xxl: '24px' },
  /** 只有两种字重：靠字重分层次，不靠加粗到 700 */
  fontWeights: { regular: '400', medium: '500' },
  lineHeights: { tight: '1.334', normal: '1.5' },
  /** fast 悬停等状态变化，比 MUI 的 250 ms 快，桌面上跟手；enter、exit 弹层进出场；ripple 波纹 */
  durations: {
    fast: motion(150),
    enter: motion(225),
    exit: motion(195),
    ripple: motion(450),
  },
  /** MUI 的曲线：standard 是 easeInOut，enter 是 easeOut，exit 是 easeIn，sharp 给随时可能回来的抽屉 */
  easings: {
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    enter: 'cubic-bezier(0, 0, 0.2, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
    sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
  },
});

declare module 'hiltkit/css' {
  interface TokenSets {
    hiltkit: typeof t;
  }
}
