// 属性写到元素上：单项写法（编译器知道标签和属性名时直接选好）、分层合并后的 spread、_bind 的事件接线。
// 规则表、扫描、class / style 合成在 rules.js，服务端和编译器用同一份。
import { computed, onCleanup, renderEffect, untrack, warnings } from './reactive.js';
import {
  ATTR, BOOL, CHILD, CLASS, GETTER, KIND_MASK, PROP, PROP_ONLY, STABLE, STYLE, TABLE, UNSAFE_SPREAD, URL, XHTML, YESNO,
  classOf, classString, config, eventOf, isDynamicLayer, layersOf, resolve, scan, setterIn, sourceOf, styleFromValue, styleOf, sxValues, tierOf, unsafeUrl, warn,
} from './rules.js';

// 水合：服务端已经写好了，大多数写法不碰 DOM，只记状态
export let hydrating = false;
export const setHydrating = (value) => (hydrating = value);

const SVG = 1; //    SVG / MathML：除了子内容，一律是 attribute
const CUSTOM = 2; // 自定义元素：有同名 property 就写 property
export const modeOf = (el) => (el.namespaceURI !== XHTML ? SVG : el.localName.indexOf('-') > 0 ? CUSTOM : 0);

const NS = { xlink: 'http://www.w3.org/1999/xlink', xml: 'http://www.w3.org/XML/1998/namespace' };
const NULL_OF = { boolean: false, number: 0, string: '' };
const DEFAULT_OF = { checked: 'defaultChecked', selected: 'defaultSelected', muted: 'defaultMuted' };
const DEFAULT_VALUE_TYPES = new Set(['checkbox', 'radio', 'hidden', 'submit', 'reset', 'button', 'image', 'file']);

// ---- 单项写法（编译器直接调用）----
/** 普通 attribute：null / undefined 移除；false 是 "false"（aria-expanded、draggable、spellcheck 要的就是它） */
export function attrStr(el, name, value, mode = 0) {
  if (hydrating) return;
  if (value == null) {
    const ns = mode & SVG && NS[name.slice(0, name.indexOf(':'))];
    return ns ? el.removeAttributeNS(ns, name.slice(name.indexOf(':') + 1)) : el.removeAttribute(name);
  }
  // on* 不会作为 attribute 写出去：字符串形式的内联处理函数是 XSS 入口
  if (name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110) return warn(`${name} 不是事件键（事件写成 onClick），也不会写成 attribute`);
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') return warn(`${name} 收到 ${typeof value}，已忽略`);
  const ns = mode & SVG && NS[name.slice(0, name.indexOf(':'))];
  if (ns) el.setAttributeNS(ns, name, value);
  else el.setAttribute(name, value);
}
/** 布尔 attribute：真值 -> ""，字符串原样，其余移除 */
export function attrBool(el, name, value) {
  if (hydrating) return;
  const on = typeof value === 'string' ? value : value ? '' : null;
  if (on === null) el.removeAttribute(name);
  else el.setAttribute(name, on);
}
/** value：先同步 default（attribute，和服务端同形）再写当前值；值没变不写，免得光标跳 */
export function attrValue(el, value) {
  const tag = el.localName;
  // select 的值服务端写不到元素上（落在 option 上），水合时也要装上对齐 option 的观察器
  if (hydrating && tag !== 'select') return;
  if (value == null) {
    el.removeAttribute('value');
    // 复选框、按钮这些 input 的 value 就是 attribute，再赋值会写回一个空 attribute，和服务端不同形
    if (tag === 'input' ? !DEFAULT_VALUE_TYPES.has(el.type) : tag === 'textarea' || tag === 'select') el.value = '';
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
/** checked / selected / muted：写 property，并镜像 default*（muted 属性写在克隆出来的模板里不生效，必须写 property） */
export function attrState(el, name, value) {
  if (hydrating) return;
  const on = !!value;
  el[name] = on;
  el[DEFAULT_OF[name]] = on;
}
/** 只有 property 的键：null 变成该类型的零值。子内容键水合时不写，服务端已经输出了 */
export function attrProp(el, name, value) {
  if (hydrating && CHILD[name]) return;
  el[name] = value == null ? (NULL_OF[typeof el[name]] ?? null) : value;
}
/** <select value>：option 后来才出现（异步、列表重排）时，选中项要跟着重新对齐 */
function keepSelect(el, text) {
  el.$value = text;
  if (el.$observer) return;
  el.$observer = new MutationObserver(() => (el.value = el.$value));
  el.$observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
}

/** value 已经是“要写的值”：null 表示移除；调用方负责把 undefined 换成 null 或落回下层 */
function write(el, name, kind, value, mode) {
  kind &= KIND_MASK;
  if (kind === URL) {
    if (unsafeUrl(value)) {
      warn(`${name} 是 javascript: 链接，已拦截`);
      value = null;
    }
    kind = ATTR;
  } else if (kind === YESNO) {
    if (typeof value === 'boolean') value = value ? 'yes' : 'no';
    kind = ATTR;
  }
  if (mode & SVG) kind = kind === PROP_ONLY && CHILD[name] ? PROP_ONLY : ATTR;
  else if (mode & CUSTOM && kind <= PROP_ONLY && (name in el || (value !== null && typeof value === 'object') || typeof value === 'function')) {
    // 自定义元素的 property 服务端写不出来：水合时也要写
    el[name] = value;
    return;
  }
  if (kind === BOOL) attrBool(el, name, value);
  else if (kind === PROP) (name === 'value' ? attrValue(el, value) : attrState(el, name, value));
  else if (kind === PROP_ONLY) attrProp(el, name, value);
  else attrStr(el, name, value, mode);
}

// ---- class、style、sx 落到同一个元素 ----
const tokens = (text) => (text ? (text.match(/\S+/g) ?? []) : []);
const IMPORTANT = /\s*!important\s*$/i;
const NO_VARS = Object.freeze({});
/**
 * 一个元素上 class、style 的写入口。三个来源各管各的：使用方的 class / style、引擎的类与变量。
 * 每次只增删“自己上次给过的和这次要给的”之间的差，元素上别人加的类（第三方库、过渡动画）、
 * 别人设的行内样式一个不碰；水合时只记状态、不写 DOM。
 * 引擎的 watch 也经这里写（setClass、setVar、removeVar），所以引擎不碰 DOM。
 */
class Host {
  constructor(el) {
    this.el = el;
    this.own = [];
    this.engine = [];
    this.ownStyle = undefined;
    this.vars = NO_VARS;
  }
  swap(previous, next, other) {
    if (hydrating) return next;
    const el = this.el;
    // 元素上还没有类（绝大多数第一次写）：整串写，比逐个 classList.add 快一个量级
    if (!previous.length && !other.length && next.length && !el.hasAttribute('class')) {
      el.setAttribute('class', next.join(' '));
      return next;
    }
    const removed = previous.filter((name) => !next.includes(name) && !other.includes(name));
    const added = next.filter((name) => !previous.includes(name));
    // 一换一（组合类换了）只改一次 class
    if (removed.length === 1 && added.length === 1) el.classList.replace(removed[0], added[0]);
    else {
      for (const name of removed) el.classList.remove(name);
      for (const name of added) el.classList.add(name);
    }
    return next;
  }
  setOwn(text) {
    this.own = this.swap(this.own, tokens(text), this.engine);
  }
  setClass(text) {
    this.engine = this.swap(this.engine, tokens(text), this.own);
  }
  writeProperty(name, value, clear) {
    const style = this.el.style;
    // 新值不合法时 setProperty 不生效，旧值不能留着
    if (clear) style.removeProperty(name);
    if (IMPORTANT.test(value)) style.setProperty(name, value.replace(IMPORTANT, ''), 'important');
    else style.setProperty(name, value);
    if (config.dev && style.getPropertyValue(name) === '') warn(`style ${name}: ${value} 无效，浏览器忽略了它（数字不会补 px）`);
  }
  /** next 是 Map：只删自己写过的属性；用户写的 style 盖住引擎的同名变量，用户不写了露出变量 */
  setStyle(next) {
    const previous = this.ownStyle;
    this.ownStyle = next;
    if (hydrating) return;
    let rewrite = false;
    if (previous) {
      for (const name of previous.keys()) {
        if (next.has(name)) continue;
        if (name in this.vars) this.el.style.setProperty(name, this.vars[name]);
        else this.el.style.removeProperty(name);
        rewrite = true;
      }
    }
    // 简写和长写互相影响：一个变了，排在它后面的都要重写；删掉一个可能抹掉别的，全部重写
    for (const [name, value] of next) {
      if (!rewrite && previous?.get(name) !== value) rewrite = true;
      if (rewrite) this.writeProperty(name, value, previous !== undefined);
    }
  }
  setVar(name, value) {
    if (this.vars === NO_VARS) this.vars = {};
    this.vars[name] = value;
    if (!hydrating && !this.ownStyle?.has(name)) this.el.style.setProperty(name, value);
  }
  removeVar(name) {
    delete this.vars[name];
    if (!hydrating && !this.ownStyle?.has(name)) this.el.style.removeProperty(name);
  }
  /** 引擎给的整组变量：和现在的比，只写变了的 */
  setVars(next) {
    const previous = this.vars;
    this.vars = next === NO_VARS ? NO_VARS : { ...next };
    if (hydrating) return;
    const own = this.ownStyle;
    for (const name in next) if (previous[name] !== next[name] && !own?.has(name)) this.el.style.setProperty(name, next[name]);
    for (const name in previous) if (!(name in next) && !own?.has(name)) this.el.style.removeProperty(name);
  }
}
const hostOf = (el) => (el.$$host ??= new Host(el));

/** 单独一个 class={x}（不经过 spread） */
export const setClass = (el, value) => hostOf(el).setOwn(classString(value));
/** 单独一个 style={x}（不经过 spread） */
export const setStyle = (el, value) => hostOf(el).setStyle(styleFromValue(value));

/** 算一次 sx，把类和变量交给 host；引擎有响应式绑定时起 watch，换值前停掉上一个 */
function applySx(host, values, stop) {
  stop?.();
  if (!values.some(Boolean)) {
    host.setClass('');
    host.setVars(NO_VARS);
    return undefined;
  }
  if (!config.sx) throw new Error('sx 需要样式引擎：先导入创建样式的模块（create、recipe…）');
  const composed = config.sx(...values);
  host.setClass(composed.class ?? '');
  host.setVars(composed.style ?? NO_VARS);
  return composed.watch?.(host);
}
/** 单独一个 sx={[...]} 且编译器已经拆好（静态项是数据，动态项是 bind / select）：不经过 spread，不起 effect */
export const setSx = (el, value) => void applySx(hostOf(el), [value]);

/** 通用入口：编译器不知道键的种类（SVG、自定义元素、动态键）时用。undefined 当作 null */
export function setAttr(el, key, value) {
  let name = key;
  let kind = TABLE[key];
  if (typeof kind === 'string') kind = TABLE[(name = kind)];
  kind ??= ATTR;
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

// ---- 事件 ----
// 一个元素上每个事件键一个原生监听；触发时才从上往下读各层的处理函数，所以处理函数换了不用重新绑定。
const hyphenate = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-/, '');
/** 没有 on<名字> IDL 属性的真实事件：IDL 探测会漏掉它们（桌面浏览器上连 touchstart 都没有） */
const NO_IDL = new Set(['focusin', 'focusout', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerrawupdate']);
/**
 * onXxx 一律转小写。自定义元素上的非原生名字（onSlChange）转连字符 sl-change；
 * 其他元素上的非原生名字（组件回调 onUpdate 漏到了原生元素）照样监听（无害），开发期给出提示
 */
function eventType(el, info, mode) {
  if (info.exact) return info.exact;
  if (info.idl in el || NO_IDL.has(info.lower)) return info.lower;
  if (mode & CUSTOM) return hyphenate(info.name);
  warn(`on${info.name} 不是 <${el.localName}> 的原生事件：组件回调 prop 漏到了原生元素？用 omit 去掉；自定义事件写成 on:事件名`);
  return info.lower;
}
function fire(layers, key, event) {
  let first;
  let list;
  for (let i = layers.length - 2; i >= 0; i -= 2) {
    const source = sourceOf(layers[i]);
    if (source == null || layers[i + 1]?.has(key)) continue;
    const handler = source[key];
    if (typeof handler !== 'function') continue; // 只认函数：字符串形式的处理函数永远不执行
    if (first === undefined) first = handler;
    else (list ??= [first]).push(handler);
  }
  if (list === undefined) return first?.(event);
  // 多层：靠后的先执行，preventDefault 或 stopImmediatePropagation 之后下层跳过
  let stopped = false;
  const original = event.stopImmediatePropagation;
  event.stopImmediatePropagation = function () {
    stopped = true;
    original.call(this);
  };
  for (const handler of list) {
    handler(event);
    if (stopped || event.defaultPrevented) break;
  }
}
/** 编译器生成：单层事件。名字和选项编译期已经算好 */
export const on = (el, type, handler, options) => el.addEventListener(type, handler, options);
function listen(el, layers, key, mode) {
  const forwarded = boundHandler(layers, key);
  if (forwarded) return bindForwarded(el, layers, key, forwarded);
  const info = eventOf(key);
  const type = eventType(el, info, mode);
  el.addEventListener(type, (event) => fire(layers, key, event), info.options);
}

// ---- _bind ----
const BOUND = Symbol('hilt.bound');
/** 编译器生成的回写函数：记下它绑的是哪个 prop，好查出“绑到了只读 prop 上”。这件事类型层拦不住 */
const pendingBinds = new Set();
export function bound(write, key) {
  write[BOUND] = key;
  if (!pendingBinds.size) queueMicrotask(reportUnusedBinds);
  pendingBinds.add(write);
  return write;
}
function reportUnusedBinds() {
  for (const write of pendingBinds) warnings.push(`_bind 绑到了只读 prop：${write[BOUND]}。子组件要声明成 ${write[BOUND]} = _bindable(默认值)`);
  pendingBinds.clear();
}
export function markBindingUsed(props, handler) {
  const layers = layersOf(props);
  for (let i = 0; i < layers.length; i += 2) {
    const source = sourceOf(layers[i]);
    if (source == null || layers[i + 1]?.has(handler)) continue;
    const write = source[handler];
    if (write?.[BOUND]) pendingBinds.delete(write);
  }
}
function boundHandler(layers, key) {
  for (let i = layers.length - 2; i >= 0; i -= 2) {
    const source = sourceOf(layers[i]);
    if (source == null || layers[i + 1]?.has(key)) continue;
    if (source[key]?.[BOUND]) return source[key];
  }
  return undefined;
}
/** 绑定经 ...rest 转交到了原生元素：在这里接上事件，属性本身走普通的路 */
function bindForwarded(el, layers, key, forwarded) {
  pendingBinds.delete(forwarded);
  const target = forwarded[BOUND];
  bindInput(el, target, () => resolve(layers, target), (next) => forwarded(next), [], true);
}
/**
 * 原生元素的双向绑定。属性还是原生属性，这里只是多接一个事件，并处理几个手写容易错的地方：
 * 中文输入法组合期间不写回；number、range 按数字读回；多选组按元素的 value 增删数组。
 */
export function bindInput(el, key, read, writeBack, mods = [], listenOnly = false) {
  const group = mods.includes('group');
  if (!listenOnly) {
    renderEffect(() => {
      const value = read();
      if (hydrating) return;
      if (group) el.checked = value.includes(el.value);
      else if (key === 'files') return;
      else if (key === 'value') {
        const text = value == null ? '' : String(value);
        if (el.value !== text) el.value = text;
      } else if (el[key] !== value) el[key] = value;
    });
  }
  const eventName = key === 'open' ? 'toggle' : key === 'value' && !mods.includes('lazy') && el.localName !== 'select' ? 'input' : 'change';
  const numeric = mods.includes('number') || el.type === 'number' || el.type === 'range';
  const readBack = () => {
    if (group) {
      const list = untrack(read);
      return el.checked ? [...list, el.value] : list.filter((item) => item !== el.value);
    }
    if (key !== 'value') return el[key];
    let value = el.value;
    if (mods.includes('trim')) value = value.trim();
    if (numeric && value !== '') value = Number(value);
    return value;
  };
  el.addEventListener(eventName, (event) => {
    if (event.isComposing) return;
    writeBack(readBack());
  });
  if (eventName === 'input') el.addEventListener('compositionend', () => writeBack(readBack()));
}

// ---- ref ----
/** ref 拿到元素；元素卸载时拿到 null，不留指向已移除节点的引用 */
export function setRef(el, ref) {
  if (!ref) return;
  ref(el);
  onCleanup(() => ref(null));
}

// ---- spread ----
/** 读出来是稳定属性包的函数层，换成静态层（只读一次，不追踪） */
function settle(layers) {
  for (let i = 0; i < layers.length; i += 2) {
    if (typeof layers[i] !== 'function') continue;
    const value = untrack(layers[i]);
    if (value?.[STABLE]) layers[i] = value;
  }
  return layers;
}
function bindKey(el, layers, name, kind, mode) {
  let last = GETTER;
  renderEffect(() => {
    const value = resolve(layers, name);
    if (value === last) return;
    last = value;
    write(el, name, kind, value === undefined ? null : value, mode);
  });
  // 实验 17-bind：父级传的变量带着写入，经 {...rest} 落到原生元素：接上事件
  if (name === 'value' || name === 'checked') {
    const set = setterIn(layers, name);
    if (set) bindInput(el, name, () => resolve(layers, name), set, [], true);
  }
}
const track = (reactive, apply) => (reactive ? renderEffect(apply) : apply());
/** class、style、sx 分开跟踪：谁是响应式的谁起 effect，互不牵连（class 变了不重算 sx） */
function bindStyling(el, layers, acc, accGetter) {
  const host = hostOf(el);
  if (acc & 1) track(accGetter & 1, () => host.setOwn(classOf(layers)));
  if (acc & 2) track(accGetter & 2, () => host.setStyle(styleOf(layers)));
  if (acc & 4) {
    let stop;
    track(accGetter & 4, () => {
      stop = applySx(host, sxValues(layers), stop);
    });
  }
}

/**
 * props 是普通对象或 merge() 的结果。静态键写一次，getter 键一个 effect；
 * 有动态键层（函数来源）时整个元素一个 effect，逐键对比上一次写进去的值。
 */
export function spread(el, props) {
  const layers = layersOf(props);
  const mode = modeOf(el);
  if (isDynamicLayer(layers) && isDynamicLayer(settle(layers))) return spreadDynamic(el, layers, mode);
  const { names, kinds, vals, acc, accGetter, late, events, refs } = scan(layers, false);
  // 顺序敏感的键分三轮写：EARLY（loading、sizes、sandbox）、其余、LATE（value、src、href）
  for (let tier = late ? 0 : 1; tier < (late ? 3 : 2); tier++) {
    for (let i = 0; i < names.length; i++) {
      if (late && tierOf(kinds[i]) !== tier) continue;
      if (UNSAFE_SPREAD[names[i]]) {
        warn(`${names[i]} 不能经 spread 写入，请在 JSX 里显式写成属性`);
        continue;
      }
      if (vals[i] === GETTER) bindKey(el, layers, names[i], kinds[i], mode);
      else write(el, names[i], kinds[i], vals[i], mode);
    }
  }
  if (acc) bindStyling(el, layers, acc, accGetter);
  if (events) for (const key of events) listen(el, layers, key, mode);
  if (refs) for (const ref of refs) setRef(el, ref);
}

function spreadDynamic(el, layers, mode) {
  const resolved = layers.map((layer, i) => {
    if (i % 2 || typeof layer !== 'function') return layer;
    const cell = computed(layer);
    return () => cell.value;
  });
  const written = new Map();
  const bound = new Set();
  const host = hostOf(el);
  let seen = 0; // 出现过的累加型键：消失之后还要算一次，把自己写的清掉
  let refs;
  let first = true;
  renderEffect(() => {
    const plan = scan(resolved, true);
    const { names, kinds, vals } = plan;
    for (let tier = 0; tier < 3; tier++) {
      for (let i = 0; i < names.length; i++) {
        if (tierOf(kinds[i]) !== tier || UNSAFE_SPREAD[names[i]]) continue;
        if (written.get(names[i]) === vals[i] && written.has(names[i])) continue;
        written.set(names[i], vals[i]);
        write(el, names[i], kinds[i], vals[i], mode);
      }
    }
    for (const name of [...written.keys()]) {
      if (names.includes(name)) continue;
      written.delete(name);
      write(el, name, TABLE[name] ?? ATTR, null, mode);
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
