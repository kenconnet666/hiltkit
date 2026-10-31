/**
 * 分层属性落到元素：`dynamic()` 动态键走这里。普通元素走 `render/props.ts` 的快路径，不经过分层。
 *
 * 静态键写一次，getter 键一个 effect；有函数来源（动态键层）时整个元素一个 effect，
 * 逐键对比上一次写进去的值，只有变了才写，撤掉的键只清自己写过的。
 */
import { computed, onCleanup, renderEffect, untrack } from '../reactivity/kernel';
import { applySx, hostOf, type Host } from './host';
import {
  ATTR,
  GETTER,
  STABLE,
  TABLE,
  UNSAFE_SPREAD,
  classOf,
  eventOf,
  isDynamicLayer,
  layersOf,
  resolve,
  scan,
  sourceOf,
  styleOf,
  sxValues,
  tierOf,
  warn,
  type EventInfo,
  type LayerList,
} from './rules';
import { isCustomMode, modeOf, write } from './write';

// ---- 事件 ----
// 一个元素上每个事件键一个原生监听；触发时才从上往下读各层的处理函数，所以处理函数换了不用重新绑定。
const hyphenate = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-/, '');
/** 没有 on<名字> IDL 属性的真实事件：IDL 探测会漏掉它们（桌面浏览器上连 touchstart 都没有） */
const NO_IDL = new Set([
  'focusin',
  'focusout',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'pointerrawupdate',
]);
/**
 * onXxx 一律转小写。自定义元素上的非原生名字（onSlChange）转连字符 sl-change；
 * 其他元素上的非原生名字（组件回调 onUpdate 漏到了原生元素）照样监听（无害），开发期给出提示
 */
function eventType(el: Element, info: EventInfo, mode: number): string {
  if (info.exact) return info.exact;
  if (info.idl in el || NO_IDL.has(info.lower)) return info.lower;
  if (isCustomMode(mode)) return hyphenate(info.name);
  warn(
    `on${info.name} 不是 <${el.localName}> 的原生事件：组件回调 prop 漏到了原生元素？自定义事件写成 on:事件名`,
  );
  return info.lower;
}
function fire(layers: LayerList, key: string, event: Event): unknown {
  let first: ((event: Event) => unknown) | undefined;
  let list: ((event: Event) => unknown)[] | undefined;
  for (let i = layers.length - 2; i >= 0; i -= 2) {
    const source = sourceOf(layers[i]);
    if (source == null || (layers[i + 1] as Set<string> | undefined)?.has(key)) continue;
    const handler = source[key];
    if (typeof handler !== 'function') continue; // 只认函数：字符串形式的处理函数永远不执行
    if (first === undefined) first = handler;
    else (list ??= [first]).push(handler);
  }
  if (list === undefined) return first?.(event);
  // 多层：靠后的先执行，preventDefault 或 stopImmediatePropagation 之后下层跳过
  let stopped = false;
  const original = event.stopImmediatePropagation;
  event.stopImmediatePropagation = function (this: Event) {
    stopped = true;
    original.call(this);
  };
  for (const handler of list) {
    handler(event);
    if (stopped || event.defaultPrevented) break;
  }
  return undefined;
}
function listen(el: Element, layers: LayerList, key: string, mode: number): void {
  const info = eventOf(key);
  el.addEventListener(eventType(el, info, mode), (event) => fire(layers, key, event), info.options);
}

/** ref 拿到元素；元素卸载时拿到 null，不留指向已移除节点的引用 */
function setRef(el: Element, ref: (el: Element | null) => void): void {
  ref(el);
  onCleanup(() => ref(null));
}

/** 读出来是稳定属性包的函数层，换成静态层（只读一次，不追踪） */
function settleStable(layers: LayerList): LayerList {
  for (let i = 0; i < layers.length; i += 2) {
    const layer = layers[i];
    if (typeof layer !== 'function') continue;
    const value = untrack(layer as () => unknown) as any;
    if (value?.[STABLE]) layers[i] = value;
  }
  return layers;
}
function bindKey(el: Element, layers: LayerList, name: string, kind: number, mode: number): void {
  let last: unknown = GETTER;
  renderEffect(() => {
    const value = resolve(layers, name);
    if (value === last) return;
    last = value;
    write(el, name, kind, value === undefined ? null : value, mode);
  });
}
const track = (reactive: number, apply: () => void): void => {
  if (reactive) renderEffect(apply);
  else apply();
};
/** class、style、sx 分开跟踪：谁是响应式的谁起 effect，互不牵连（class 变了不重算 sx） */
function bindStyling(host: Host, layers: LayerList, acc: number, accGetter: number): void {
  if (acc & 1) track(accGetter & 1, () => host.setOwn(classOf(layers)));
  if (acc & 2) track(accGetter & 2, () => host.setStyle(styleOf(layers)));
  if (acc & 4) {
    let stop: (() => void) | undefined;
    track(accGetter & 4, () => {
      stop = applySx(host, sxValues(layers), stop);
    });
  }
}

/** props 是普通对象或 mergeLayers() 的结果 */
export function spread(el: Element, props: object): void {
  const layers = layersOf(props);
  const mode = modeOf(el);
  if (isDynamicLayer(layers) && isDynamicLayer(settleStable(layers)))
    return spreadDynamic(el, layers, mode);
  const { names, kinds, vals, acc, accGetter, late, events, refs } = scan(layers, false);
  // 顺序敏感的键分三轮写：EARLY（loading、sizes、sandbox）、其余、LATE（value、src、href）
  for (let tier = late ? 0 : 1; tier < (late ? 3 : 2); tier++) {
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      const kind = kinds[i]!;
      if (late && tierOf(kind) !== tier) continue;
      if (UNSAFE_SPREAD[name]) {
        warn(`${name} 不能经 spread 写入，请在 JSX 里显式写成属性`);
        continue;
      }
      if (vals[i] === GETTER) bindKey(el, layers, name, kind, mode);
      else write(el, name, kind, vals[i], mode);
    }
  }
  if (acc) bindStyling(hostOf(el), layers, acc, accGetter);
  if (events) for (const key of events) listen(el, layers, key, mode);
  if (refs) for (const ref of refs) setRef(el, ref);
}

function spreadDynamic(el: Element, layers: LayerList, mode: number): void {
  // 每个动态层一个 computed：来源没变时，这个元素的 effect 重跑也不用重算来源
  const resolved: LayerList = layers.map((layer, i) => {
    if (i % 2 || typeof layer !== 'function') return layer;
    const cell = computed(layer as () => Record<string, any>);
    return () => cell.value;
  });
  const written = new Map<string, unknown>();
  const bound = new Set<string>();
  const host = hostOf(el);
  let seen = 0; // 出现过的累加型键：消失之后还要算一次，把自己写的清掉
  let refs: ((el: unknown) => void)[] | undefined;
  let first = true;
  renderEffect(() => {
    const plan = scan(resolved, true);
    const { names, kinds, vals } = plan;
    for (let tier = 0; tier < 3; tier++) {
      for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        const kind = kinds[i]!;
        if (tierOf(kind) !== tier || UNSAFE_SPREAD[name]) continue;
        if (written.get(name) === vals[i] && written.has(name)) continue;
        written.set(name, vals[i]);
        write(el, name, kind, vals[i], mode);
      }
    }
    for (const name of [...written.keys()]) {
      if (names.includes(name)) continue;
      written.delete(name);
      write(el, name, (TABLE[name] as number | undefined) ?? ATTR, null, mode);
    }
    seen |= plan.acc;
    if (seen & 1) host.setOwn(classOf(resolved));
    if (seen & 2) host.setStyle(styleOf(resolved));
    // watch 是这个 effect 的子节点，重跑时自动销毁，不用记 stop
    if (seen & 4) applySx(host, sxValues(resolved));
    if (plan.events) {
      for (const key of plan.events) {
        if (bound.has(key)) continue;
        bound.add(key);
        untrack(() => listen(el, resolved, key, mode));
      }
    }
    if (first) refs = plan.refs;
    first = false;
  });
  if (refs) for (const ref of refs) setRef(el, ref);
}
