/**
 * 事件属性：`onClick`，选项写在后缀里（Capture / Once / Passive，可组合，顺序随意），`on:名字` 是逃生口。
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

/** 选项后缀的全部排列（不重复）：onClickCapture、onClickOnceCapture、onClickCapturePassiveOnce… */
export type EventSuffix =
  | ''
  | 'Capture' | 'Once' | 'Passive'
  | 'CaptureOnce' | 'CapturePassive' | 'OnceCapture' | 'OncePassive' | 'PassiveCapture' | 'PassiveOnce'
  | 'CaptureOncePassive' | 'CapturePassiveOnce' | 'OnceCapturePassive' | 'OncePassiveCapture'
  | 'PassiveCaptureOnce' | 'PassiveOnceCapture';

/** 事件处理函数：currentTarget 是挂监听的那个元素（不是 target） */
export type EventHandler<E extends Event, El> = (event: E & { currentTarget: El }) => void;

/** 由事件表生成 onXxx（含后缀）：参数的 currentTarget 是具体元素 */
export type EventAttrs<El, Map> = {
  [K in keyof Map & string as `on${EventName<K>}${EventSuffix}`]?: EventHandler<Map[K] & Event, El>;
};

/** `on:my-Event`：键名原样当事件名，给大小写敏感的自定义事件和没有登记的事件 */
export interface EscapeEvents<El> {
  [name: `on:${string}`]: EventHandler<Event, El> | undefined;
}
