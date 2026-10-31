/**
 * 事件属性：`onClick`，选项写在后缀里（Capture / Once / Passive，可组合，顺序随意；单个后缀精确类型，组合后缀见 ComboEvents），`on:名字` 是逃生口。
 * 事件表来自 lib.dom（HTMLElementEventMap、SVGElementEventMap），参数的 currentTarget 是具体元素。
 *
 * 运行时（09-attr/attrs.js）把 onXxx 整个转小写当事件名，所以类型里每个事件只登记一种驼峰写法；
 * lib.dom 的事件名全小写，多个单词的要手写一张驼峰表（EventCamelCase），其余 Capitalize。
 */

/**
 * 不规则的才列，其余仍然 Capitalize。scripts/check-events.mjs 会对照 lib.dom 的事件表，
 * 找出名字较长又不在这里的事件，防止漏登记。
 */
interface EventCamelCase {
  animationcancel: 'AnimationCancel'; animationend: 'AnimationEnd'; animationiteration: 'AnimationIteration';
  animationstart: 'AnimationStart'; auxclick: 'AuxClick'; beforeinput: 'BeforeInput'; beforematch: 'BeforeMatch';
  beforetoggle: 'BeforeToggle'; canplay: 'CanPlay'; canplaythrough: 'CanPlayThrough';
  compositionend: 'CompositionEnd'; compositionstart: 'CompositionStart'; compositionupdate: 'CompositionUpdate';
  contextlost: 'ContextLost'; contextmenu: 'ContextMenu'; contextrestored: 'ContextRestored'; cuechange: 'CueChange';
  dblclick: 'DblClick'; dragend: 'DragEnd'; dragenter: 'DragEnter'; dragleave: 'DragLeave'; dragover: 'DragOver';
  dragstart: 'DragStart'; durationchange: 'DurationChange'; focusin: 'FocusIn'; focusout: 'FocusOut';
  formdata: 'FormData'; fullscreenchange: 'FullscreenChange'; fullscreenerror: 'FullscreenError';
  gotpointercapture: 'GotPointerCapture'; keydown: 'KeyDown'; keypress: 'KeyPress'; keyup: 'KeyUp';
  loadeddata: 'LoadedData'; loadedmetadata: 'LoadedMetadata'; loadstart: 'LoadStart';
  lostpointercapture: 'LostPointerCapture'; mousedown: 'MouseDown'; mouseenter: 'MouseEnter';
  mouseleave: 'MouseLeave'; mousemove: 'MouseMove'; mouseout: 'MouseOut'; mouseover: 'MouseOver'; mouseup: 'MouseUp';
  pointercancel: 'PointerCancel'; pointerdown: 'PointerDown'; pointerenter: 'PointerEnter';
  pointerleave: 'PointerLeave'; pointermove: 'PointerMove'; pointerout: 'PointerOut'; pointerover: 'PointerOver';
  pointerrawupdate: 'PointerRawUpdate'; pointerup: 'PointerUp'; ratechange: 'RateChange'; scrollend: 'ScrollEnd';
  securitypolicyviolation: 'SecurityPolicyViolation'; selectionchange: 'SelectionChange';
  selectstart: 'SelectStart'; slotchange: 'SlotChange'; timeupdate: 'TimeUpdate'; touchcancel: 'TouchCancel';
  touchend: 'TouchEnd'; touchmove: 'TouchMove'; touchstart: 'TouchStart'; transitioncancel: 'TransitionCancel';
  transitionend: 'TransitionEnd'; transitionrun: 'TransitionRun'; transitionstart: 'TransitionStart';
  volumechange: 'VolumeChange'; webkitanimationend: 'WebkitAnimationEnd';
  webkitanimationiteration: 'WebkitAnimationIteration'; webkitanimationstart: 'WebkitAnimationStart';
  webkittransitionend: 'WebkitTransitionEnd';
}
type EventName<K extends string> = K extends keyof EventCamelCase ? EventCamelCase[K] : Capitalize<K>;

/** 单个选项后缀（含无后缀）：每个事件登记 4 个精确类型的键 */
export type EventSuffix = '' | 'Capture' | 'Once' | 'Passive';

/** 事件处理函数：currentTarget 是挂监听的那个元素（不是 target） */
export type EventHandler<E extends Event, El> = (event: E & { currentTarget: El }) => void;

/** 由事件表生成 onXxx（含单个后缀）：参数的 currentTarget 是具体元素 */
export type EventAttrs<El, Map> = {
  [K in keyof Map & string as `on${EventName<K>}${EventSuffix}`]?: EventHandler<Map[K] & Event, El>;
};

/**
 * 组合后缀（onClickCaptureOnce、onWheelOncePassive…，顺序随意）：用 12 个模式索引签名接住，不展开成属性。
 * 全部展开是 16 倍的键（每个标签 1700 多个），组件每次转发 rest 都要为这些键付出代价（见 results/15-types.txt）；
 * 代价是组合后缀的事件名只检查“以合法后缀结尾”、事件对象是通用的 Event（要精确类型就标注参数：(e: MouseEvent & { currentTarget: HTMLDivElement }) => …）。
 * 方法签名写法让参数双向协变，所以标注成具体事件类型的处理函数也能传。
 */
type LooseHandler<El> = { bivarianceHack(event: Event & { currentTarget: El }): void }['bivarianceHack'];
export interface ComboEvents<El> {
  [name: `on${string}CaptureOnce`]: LooseHandler<El> | undefined;
  [name: `on${string}CapturePassive`]: LooseHandler<El> | undefined;
  [name: `on${string}OnceCapture`]: LooseHandler<El> | undefined;
  [name: `on${string}OncePassive`]: LooseHandler<El> | undefined;
  [name: `on${string}PassiveCapture`]: LooseHandler<El> | undefined;
  [name: `on${string}PassiveOnce`]: LooseHandler<El> | undefined;
  [name: `on${string}CaptureOncePassive`]: LooseHandler<El> | undefined;
  [name: `on${string}CapturePassiveOnce`]: LooseHandler<El> | undefined;
  [name: `on${string}OnceCapturePassive`]: LooseHandler<El> | undefined;
  [name: `on${string}OncePassiveCapture`]: LooseHandler<El> | undefined;
  [name: `on${string}PassiveCaptureOnce`]: LooseHandler<El> | undefined;
  [name: `on${string}PassiveOnceCapture`]: LooseHandler<El> | undefined;
}

/** `on:my-Event`：键名原样当事件名，给大小写敏感的自定义事件和没有登记的事件 */
export interface EscapeEvents<El> {
  [name: `on:${string}`]: EventHandler<Event, El> | undefined;
}
