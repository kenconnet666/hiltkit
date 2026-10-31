/**
 * 弹层的进出场，纯 CSS：配合原生 `<dialog>` 和 `popover`。
 *
 *   进场：打开状态里用 @starting-style 给起始值
 *   离场：display、overlay 加 allow-discrete，关闭后先播完过渡再离开顶层
 *
 * 不用 JS 动画：原生弹层被 Esc、点击外部关闭时 JS 来不及介入。进场比退场慢，打开有过渡，关闭不拖沓。
 * 只动 opacity 和 transform，不引起重新布局。不支持离场过渡的浏览器关闭时立即隐藏，状态不受影响。
 * 用法：`sx={[styles.panel, transitions.scale]}`；模态的遮罩再加 `transitions.backdrop`。
 */
import { create } from 'hiltkit/css';
import { t } from './tokens';

const discrete = (duration: string) =>
  `display ${duration} allow-discrete, overlay ${duration} allow-discrete`;
const leave = (...properties: string[]) =>
  [
    ...properties.map((name) => `${name} ${t.durations.exit} ${t.easings.exit}`),
    discrete(t.durations.exit),
  ].join(', ');
const arrive = (duration: string, ...properties: string[]) =>
  [...properties.map((name) => `${name} ${duration} ${t.easings.enter}`), discrete(duration)].join(
    ', ',
  );

export const transitions = create({
  /** 对话框、菜单：淡入并轻微上移，幅度小，符合硬朗的风格 */
  scale: {
    opacity: {
      default: 0,
      ':modal': { default: 1, '@starting-style': 0 },
      ':popover-open': { default: 1, '@starting-style': 0 },
    },
    transform: {
      default: 'translateY(4px)',
      ':modal': { default: 'none', '@starting-style': 'translateY(4px)' },
      ':popover-open': { default: 'none', '@starting-style': 'translateY(4px)' },
    },
    transition: {
      default: leave('opacity', 'transform'),
      ':modal': arrive(t.durations.enter, 'opacity', 'transform'),
      ':popover-open': arrive(t.durations.enter, 'opacity', 'transform'),
    },
  },
  /** 抽屉：从行尾滑入 */
  slide: {
    transform: {
      default: 'translateX(100%)',
      ':modal': { default: 'none', '@starting-style': 'translateX(100%)' },
      ':dir(rtl)': {
        default: 'translateX(-100%)',
        ':modal': { default: 'none', '@starting-style': 'translateX(-100%)' },
      },
    },
    transition: {
      default: leave('transform'),
      ':modal': arrive(t.durations.drawer, 'transform'),
    },
  },
  /** 模态遮罩 */
  backdrop: {
    '::backdrop': {
      backgroundColor: {
        default: 'transparent',
        ':modal': { default: '_overlay', '@starting-style': 'transparent' },
      },
      transition: {
        default: leave('background-color'),
        ':modal': arrive(t.durations.enter, 'background-color'),
      },
    },
  },
});
