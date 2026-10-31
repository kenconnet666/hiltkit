/**
 * 弹层的进出场，纯 CSS：配合原生 `<dialog>` 和 `popover`。
 *
 *   进场：打开状态里用 @starting-style 给起始值
 *   离场：display、overlay 加 allow-discrete，关闭后先播完过渡再离开顶层
 *
 * 不用 JS 动画：原生弹层被 Esc、点击外部关闭时 JS 来不及介入。时长和曲线跟 MUI 一样，进场比退场慢。
 * 只动 opacity 和 transform，不引起重新布局。不支持离场过渡的浏览器关闭时立即隐藏，状态不受影响。
 * 用法：`sx={[styles.panel, transitions.fade]}`；模态的遮罩再加 `transitions.backdrop`。
 */
import { create } from 'hiltkit/css';
import { t } from './tokens';

const discrete = (duration: string) =>
  `display ${duration} allow-discrete, overlay ${duration} allow-discrete`;
const leave = (easing: string, ...properties: string[]) =>
  [
    ...properties.map((name) => `${name} ${t.durations.exit} ${easing}`),
    discrete(t.durations.exit),
  ].join(', ');
const arrive = (...properties: string[]) =>
  [
    ...properties.map((name) => `${name} ${t.durations.enter} ${t.easings.enter}`),
    discrete(t.durations.enter),
  ].join(', ');

export const transitions = create({
  /** 对话框、菜单：只淡入淡出，和 MUI 的 Dialog 一样不位移 */
  fade: {
    opacity: {
      default: 0,
      ':modal': { default: 1, '@starting-style': 0 },
      ':popover-open': { default: 1, '@starting-style': 0 },
    },
    transition: {
      default: leave(t.easings.exit, 'opacity'),
      ':modal': arrive('opacity'),
      ':popover-open': arrive('opacity'),
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
      default: leave(t.easings.sharp, 'transform'),
      ':modal': arrive('transform'),
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
        default: leave(t.easings.exit, 'background-color'),
        ':modal': arrive('background-color'),
      },
    },
  },
});
