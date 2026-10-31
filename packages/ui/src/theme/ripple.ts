/**
 * 波纹：按下时从指针位置扩散，按住时一直在，松开才淡出；键盘按 Enter、空格时从中心扩散。
 *
 *   const ripple = useRipple(() => props.ripple);
 *   <button sx={rippleStyles.host} {...ripple}>
 *
 * 颜色跟随文字，实底和描边按钮上都合适。时长取主题 token：开启“减少动态效果”时是 0，这时不出波纹。
 * 用 Web Animations 而不是样式表：波纹元素是运行时插进去的，按住和松开要分两段控制。
 * 默认开启，`<Provider ripple={false}>` 全局关，组件的 ripple 属性单独覆盖。
 */
import { read, type Prop } from 'hiltkit';
import { create } from 'hiltkit/css';
import { useRippleEnabled } from '../provider/locale';

/** 宿主元素要的样式：波纹相对它定位，超出圆角的部分裁掉 */
export const rippleStyles = create({ host: { position: 'relative', overflow: 'hidden' } });

const FADE_MS = 160;

/** 主题里的时长：`360ms` -> 360。样式没加载时当作 0，不出波纹 */
function rippleDuration(host: Element): number {
  const text = getComputedStyle(host).getPropertyValue('--hk-durations-ripple').trim();
  const value = parseFloat(text);
  return Number.isFinite(value) ? value : 0;
}

const isDisabled = (host: Element) => host.matches(':disabled, [aria-disabled="true"]');

/** 在 event.currentTarget 上开始一个波纹 */
export function startRipple(event: PointerEvent | KeyboardEvent): void {
  const host = event.currentTarget;
  if (!(host instanceof HTMLElement) || isDisabled(host)) return;
  const keyboard = event instanceof KeyboardEvent;
  // 按住键不放的重复事件不算；右键不算
  if (keyboard && (event.repeat || (event.key !== 'Enter' && event.key !== ' '))) return;
  if (!keyboard && (event as PointerEvent).button !== 0) return;
  const duration = rippleDuration(host);
  if (!duration) return;

  const rect = host.getBoundingClientRect();
  const x = keyboard ? rect.width / 2 : (event as PointerEvent).clientX - rect.left;
  const y = keyboard ? rect.height / 2 : (event as PointerEvent).clientY - rect.top;
  // 圆心到最远的角的距离：扩散完正好盖满整个元素
  const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
  const ripple = document.createElement('span');
  ripple.setAttribute('aria-hidden', 'true');
  ripple.dataset.ripple = '';
  ripple.style.cssText = `position:absolute;left:${x - radius}px;top:${y - radius}px;width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;pointer-events:none;background:color-mix(in srgb, currentColor 14%, transparent);`;
  host.append(ripple);
  const expand = ripple.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], {
    duration,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    fill: 'forwards',
  });

  const targets: [string, EventTarget][] = keyboard
    ? [
        ['keyup', host],
        ['blur', host],
      ]
    : [
        ['pointerup', window],
        ['pointercancel', window],
        ['pointerleave', host],
      ];
  const release = () => {
    for (const [type, target] of targets) target.removeEventListener(type, release);
    // 点得很快时也要把扩散播完，否则波纹一闪就没了
    void expand.finished
      .catch(() => {})
      .then(
        () =>
          ripple.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' })
            .finished,
      )
      .catch(() => {})
      .finally(() => ripple.remove());
  };
  for (const [type, target] of targets) target.addEventListener(type, release);
}

export interface RippleHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

/** 组件里用：展开到宿主元素上。own 是组件自己的 ripple 属性，没写时跟随 Provider */
export function useRipple(own?: Prop<boolean | undefined>): RippleHandlers {
  const enabled = useRippleEnabled();
  const handler = (event: PointerEvent | KeyboardEvent) => {
    if (read(own) ?? enabled()) startRipple(event);
  };
  return { onPointerDown: handler, onKeyDown: handler };
}
