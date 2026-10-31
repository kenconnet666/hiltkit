/**
 * 单个属性写到元素上，以及原生表单的双向绑定。
 *
 * 规则来自 `rules.ts`。这里解决的都是 DOM 自己的怪癖：哪些键是 property、哪些是 attribute、
 * 自定义元素和 SVG 的差别、value 要等 option 出现才能选中。水合时大多数写法不碰 DOM，服务端已经写好了。
 */
import { hydrating } from '../hydration';
import { renderEffect } from '../reactivity/kernel';
import { setClass, setStyle } from './host';
import {
  ATTR,
  BOOL,
  CHILD,
  CLASS,
  KIND_MASK,
  PROP,
  PROP_ONLY,
  STYLE,
  TABLE,
  URL_ATTR,
  XHTML,
  YESNO,
  unsafeUrl,
  warn,
} from './rules';

/** SVG、MathML：除了子内容，一律是 attribute */
const MODE_SVG = 1;
/** 自定义元素：有同名 property 就写 property */
const MODE_CUSTOM = 2;
export const modeOf = (el: Element): number =>
  el.namespaceURI !== XHTML ? MODE_SVG : el.localName.indexOf('-') > 0 ? MODE_CUSTOM : 0;
export const isCustomMode = (mode: number): boolean => (mode & MODE_CUSTOM) !== 0;

const NS: Record<string, string> = {
  xlink: 'http://www.w3.org/1999/xlink',
  xml: 'http://www.w3.org/XML/1998/namespace',
};
const NULL_OF: Record<string, unknown> = { boolean: false, number: 0, string: '' };
const DEFAULT_OF: Record<string, string> = {
  checked: 'defaultChecked',
  selected: 'defaultSelected',
  muted: 'defaultMuted',
};
const DEFAULT_VALUE_TYPES = new Set([
  'checkbox',
  'radio',
  'hidden',
  'submit',
  'reset',
  'button',
  'image',
  'file',
]);

/** 普通 attribute：null、undefined 移除；false 是 "false"（aria-expanded、draggable、spellcheck 要的就是它） */
export function attrStr(el: Element, name: string, value: unknown, mode = 0): void {
  if (hydrating) return;
  const ns = mode & MODE_SVG ? NS[name.slice(0, name.indexOf(':'))] : undefined;
  if (value == null) {
    if (ns) el.removeAttributeNS(ns, name.slice(name.indexOf(':') + 1));
    else el.removeAttribute(name);
    return;
  }
  // on* 不会作为 attribute 写出去：字符串形式的内联处理函数是 XSS 入口
  if (name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110)
    return warn(`${name} 不是事件键（事件写成 onClick），也不会写成 attribute`);
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol')
    return warn(`${name} 收到 ${typeof value}，已忽略`);
  if (ns) el.setAttributeNS(ns, name, value as string);
  else el.setAttribute(name, value as string);
}
/** 布尔 attribute：真值 -> ""，字符串原样，其余移除 */
export function attrBool(el: Element, name: string, value: unknown): void {
  if (hydrating) return;
  const on = typeof value === 'string' ? value : value ? '' : null;
  if (on === null) el.removeAttribute(name);
  else el.setAttribute(name, on);
}
/** value：先同步 default（attribute，和服务端同形）再写当前值；值没变不写，免得光标跳 */
export function attrValue(el: any, value: unknown): void {
  const tag = el.localName;
  // select 的值服务端写不到元素上（落在 option 上），水合时也要装上对齐 option 的观察器
  if (hydrating && tag !== 'select') return;
  if (value == null) {
    el.removeAttribute('value');
    // 复选框、按钮这些 input 的 value 就是 attribute，再赋值会写回一个空 attribute，和服务端不同形
    if (
      tag === 'input' ? !DEFAULT_VALUE_TYPES.has(el.type) : tag === 'textarea' || tag === 'select'
    )
      el.value = '';
    return;
  }
  const text = String(value);
  if (tag === 'option') return el.setAttribute('value', text);
  if (tag === 'input') {
    if (el.getAttribute('value') !== text) el.setAttribute('value', text);
  } else if (tag === 'textarea' && el.defaultValue !== text) el.defaultValue = text;
  if (el.value !== text) el.value = text;
  if (tag === 'select') keepSelect(el, text);
}
/** checked、selected、muted：写 property，并镜像 default*（muted 属性写在克隆出来的模板里不生效，必须写 property） */
export function attrState(el: any, name: string, value: unknown): void {
  if (hydrating) return;
  const on = !!value;
  el[name] = on;
  el[DEFAULT_OF[name]!] = on;
}
/** 只有 property 的键：null 变成该类型的零值。子内容键水合时不写，服务端已经输出了 */
export function attrProp(el: any, name: string, value: unknown): void {
  if (hydrating && CHILD[name]) return;
  el[name] = value == null ? (NULL_OF[typeof el[name]] ?? null) : value;
}
/** <select value>：option 后来才出现（异步、列表重排）时，选中项要跟着重新对齐 */
function keepSelect(el: any, text: string): void {
  el.$value = text;
  if (el.$observer) return;
  el.$observer = new MutationObserver(() => (el.value = el.$value));
  el.$observer.observe(el, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['value'],
  });
}

/** value 已经是“要写的值”：null 表示移除；调用方负责把 undefined 换成 null 或落回下层 */
export function write(el: any, name: string, entry: number, value: unknown, mode: number): void {
  let kind = entry & KIND_MASK;
  if (kind === URL_ATTR) {
    if (unsafeUrl(value)) {
      warn(`${name} 是 javascript: 链接，已拦截`);
      value = null;
    }
    kind = ATTR;
  } else if (kind === YESNO) {
    if (typeof value === 'boolean') value = value ? 'yes' : 'no';
    kind = ATTR;
  }
  if (mode & MODE_SVG) kind = kind === PROP_ONLY && CHILD[name] ? PROP_ONLY : ATTR;
  else if (
    mode & MODE_CUSTOM &&
    kind <= PROP_ONLY &&
    (name in el || (value !== null && typeof value === 'object') || typeof value === 'function')
  ) {
    // 自定义元素的 property 服务端写不出来：水合时也要写
    el[name] = value;
    return;
  }
  if (kind === BOOL) attrBool(el, name, value);
  else if (kind === PROP) {
    if (name === 'value') attrValue(el, value);
    else attrState(el, name, value);
  } else if (kind === PROP_ONLY) attrProp(el, name, value);
  else attrStr(el, name, value, mode);
}

/** 通用入口：不知道键的种类（SVG、自定义元素、动态键）时用。undefined 当作 null */
export function setAttr(el: Element, key: string, value: unknown): void {
  let name = key;
  let entry = TABLE[key];
  if (typeof entry === 'string') {
    name = entry;
    entry = TABLE[name];
  }
  const kind = (entry as number | undefined) ?? ATTR;
  if (value === undefined) value = null;
  switch (kind & KIND_MASK) {
    case CLASS:
      return setClass(el, value);
    case STYLE:
      return setStyle(el, value);
    default:
      return write(el, name, kind, value, modeOf(el));
  }
}

/**
 * 原生元素的双向绑定。属性还是原生属性，这里只是多接一个事件，并处理手写容易错的地方：
 * 中文输入法组合期间不写回；number、range 按数字读回。
 */
export function bindInput(
  el: any,
  key: string,
  read: () => unknown,
  writeBack: (value: any) => void,
): void {
  renderEffect(() => {
    const value = read();
    if (hydrating) return;
    if (key === 'files') return;
    if (key === 'value') {
      const text = value == null ? '' : String(value);
      if (el.value !== text) el.value = text;
    } else if (el[key] !== value) el[key] = value;
  });
  const eventName =
    key === 'open' ? 'toggle' : key === 'value' && el.localName !== 'select' ? 'input' : 'change';
  const numeric = el.type === 'number' || el.type === 'range';
  const readBack = () => {
    if (key !== 'value') return el[key];
    const value = el.value;
    return numeric && value !== '' ? Number(value) : value;
  };
  el.addEventListener(eventName, (event: InputEvent) => {
    if (event.isComposing) return;
    writeBack(readBack());
  });
  if (eventName === 'input') el.addEventListener('compositionend', () => writeBack(readBack()));
}
