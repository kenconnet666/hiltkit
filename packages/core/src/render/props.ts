/**
 * JSX 写在元素上的属性怎么落到 DOM：这里决定“这个键是活的还是一次性的”。
 *
 * 规则只有一条：值是函数就是活的（起一个 renderEffect），不是函数就写一次。
 * 带 `set` 的 Sig 传给表单元素的 value、checked 才是双向绑定。
 * 真正怎么写（property 还是 attribute）交给 `attrs/`。
 */
import { setSx } from '../attrs/host';
import { LATE, TABLE, eventOf, isEventKey, mergeLayers } from '../attrs/rules';
import { spread } from '../attrs/spread';
import { attrValue, bindInput, setAttr } from '../attrs/write';
import { devHooks, onCleanup, renderEffect, untrack } from '../reactivity/kernel';
import { isSig, type Sig } from '../reactivity/sig';

const TWO_WAY = new Set(['value', 'checked']);
const isFormTag = (tag: string) => tag === 'input' || tag === 'textarea' || tag === 'select';
const hyphenate = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-/, '');

let prepareSx: (value: unknown) => unknown = (value) => value;
let onHydrate = (): void => {};
/** 样式入口（`hiltkit/css`）登记自己：不用样式时这边不引用引擎，摇得掉 */
export const registerStyles = (hooks: {
  /** 把 sx 里的函数换成引擎认识的绑定 */
  prepare: (value: unknown) => unknown;
  /** 水合开始时告诉引擎：页面上的类是服务端写好的 */
  onHydrate: () => void;
}): void => {
  prepareSx = hooks.prepare;
  onHydrate = hooks.onHydrate;
};
export const notifyHydrate = (): void => onHydrate();

function twoWay(el: any, key: string, shell: Sig<any>): void {
  const align = () => {
    const current = untrack(shell);
    if (key === 'checked') el.checked = !!current;
    else if (el.value !== String(current ?? '') && Number(el.value) !== current)
      el.value = current ?? '';
  };
  bindInput(el, key, shell, (next: unknown) => {
    shell.set(next);
    // 受控复选框：壳没有采纳这次写入时要退回去，得等浏览器的默认行为结束
    if (key === 'checked') queueMicrotask(align);
  });
  if (key === 'value') el.addEventListener('change', align);
  // 选项后来才出现或被换掉时，选中项要按壳重新对齐
  if (key === 'value' && el.localName === 'select') renderEffect(() => attrValue(el, shell()));
}
const hasFunction = (value: unknown): boolean => {
  if (typeof value === 'function') return true;
  if (Array.isArray(value)) return value.some(hasFunction);
  if (value && typeof value === 'object') return Object.values(value).some(hasFunction);
  return false;
};
/** class、style 里嵌的函数：读出来再交给属性规则 */
export const settle = (value: unknown): unknown => {
  if (typeof value === 'function') return settle(value());
  if (Array.isArray(value)) return value.map(settle);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, settle(item)]));
  }
  return value;
};
function applyProp(el: any, key: string, value: any, tag: string): void {
  if (key === 'children' || key === 'key' || value === undefined) return;
  if (key === 'ref') {
    if (isSig(value)) {
      value.set(el);
      onCleanup(() => value.set(null));
    } else {
      value(el);
      onCleanup(() => value(null));
    }
    return;
  }
  if (isEventKey(key)) {
    const info = eventOf(key);
    const type =
      info.exact ?? (tag.includes('-') && !(info.idl in el) ? hyphenate(info.name) : info.lower);
    el.addEventListener(type, value, info.options);
    return;
  }
  if (key === 'sx') {
    setSx(el, prepareSx(value));
    return;
  }
  if ((key === 'class' || key === 'style') && hasFunction(value)) {
    devHooks?.label('attr', el, key);
    renderEffect(() => setAttr(el, key, settle(value)));
    return;
  }
  if (typeof value === 'function') {
    const bindable = isSig(value) && TWO_WAY.has(key) && isFormTag(tag);
    devHooks?.label(bindable ? 'model' : 'attr', el, key);
    if (bindable) twoWay(el, key, value);
    else renderEffect(() => setAttr(el, key, value()));
    return;
  }
  setAttr(el, key, value);
}
/** 动态键层：把写法换成运行时分层能认的形状。函数值在元素的 effect 里读，所以响应式还在 */
function toLayer(props: any): any {
  const layer: any = {};
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key === 'children' || key === 'key' || value === undefined) continue;
    if (key === 'sx') layer.sx = prepareSx(value);
    else if (key === 'ref') layer.ref = isSig(value) ? (el: unknown) => value.set(el) : value;
    else if (isEventKey(key)) layer[key] = value;
    else if ((key === 'class' || key === 'style') && hasFunction(value)) {
      Object.defineProperty(layer, key, { enumerable: true, get: () => settle(value) });
    } else if (typeof value === 'function') {
      Object.defineProperty(layer, key, { enumerable: true, get: value });
    } else layer[key] = value;
  }
  return layer;
}
/** props 里 `dynamic()` 留下的动态键来源。动态键用 symbol 当键，普通属性遍历看不到它们 */
export const dynamicSources = (props: any): (() => object | null | undefined)[] | undefined => {
  const symbols = Object.getOwnPropertySymbols(props);
  if (!symbols.length) return undefined;
  const found = symbols.map((symbol) => props[symbol]).filter((value) => value?.$$dynamic);
  return found.length ? found : undefined;
};
function applyDynamic(
  el: Element,
  props: any,
  sources: (() => object | null | undefined)[],
  tag: string,
): void {
  // 传 Sig 的双向绑定不进分层，单独接
  const own: any = {};
  for (const key of Object.keys(props)) {
    if (isSig(props[key]) && TWO_WAY.has(key) && isFormTag(tag))
      applyProp(el, key, props[key], tag);
    else own[key] = props[key];
  }
  const layers = sources.map((source) => () => {
    const value = source();
    return value ? toLayer(value) : value;
  });
  spread(el, mergeLayers(toLayer(own), ...layers));
}
/** 元素的全部属性。顺序敏感的键（value、src 这些）放到最后写 */
export function applyProps(el: Element, props: any, tag: string): void {
  const sources = dynamicSources(props);
  if (sources) return applyDynamic(el, props, sources, tag);
  let later: string[] | undefined;
  for (const key in props) {
    const kind = TABLE[key];
    if (typeof kind === 'number' && kind & LATE) (later ??= []).push(key);
    else applyProp(el, key, props[key], tag);
  }
  if (later) for (const key of later) applyProp(el, key, props[key], tag);
}
