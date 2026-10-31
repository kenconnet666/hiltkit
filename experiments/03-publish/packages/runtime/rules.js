// 属性规则：浏览器（attrs.js）、服务端（server.js）、编译器共用同一张表、同一套分层扫描与 class / style 合成，
// 三边写出来的东西才会一致。这里没有任何 DOM 依赖。
//
// 分层：JSX 里属性的书写顺序就是层次，靠后的层优先。层数组是 [来源, 隐藏键集合, 来源, 隐藏键集合 ...]，
// 来源是对象，或返回对象的函数（{...(cond ? a : b)} 编译出来的动态键层）。
// 两类属性：
//   覆盖型（普通属性）  从上往下第一个不是 undefined 的值赢；null = 明确移除（盖住下层）；undefined = 落回下层
//   累加型（class、style、事件、ref、sx）  每层都出力；undefined / null / false 只是不出力，不盖下层。要盖住用 omit

export const XHTML = 'http://www.w3.org/1999/xhtml';

/** sx 是样式引擎的钩子：(...各层的 sx 值) => ({ class?, style?, watch? })，由创建样式的模块登记；dev 控制开发期警告 */
export const config = { dev: true, sx: undefined };
export const warn = (message) => config.dev && console.warn(`[attr] ${message}`);
export const registerStyleEngine = (engine) => (config.sx = engine);

// ---- 键的种类：一次查表决定怎么写 ----
export const ATTR = 0; //       默认：setAttribute（SSR 同形）
export const BOOL = 1; //       布尔 attribute：true -> ""，false/null -> 移除，字符串原样（hidden="until-found"、popover="manual"）
export const PROP = 2; //       表单状态：写 property，同时镜像成 default* attribute（和 SSR 解析出来的 DOM 同形）
export const PROP_ONLY = 3; //  只有 property（没有 attribute，或 attribute 语义不同）：SSR 写不出来，客户端挂载后补
export const URL = 4; //        带 URL 的 attribute：拦截 javascript:
export const YESNO = 5; //      translate：true -> "yes"，false -> "no"
export const CLASS = 8;
export const STYLE = 9;
export const SX = 10;
export const REF = 11;
export const SKIP = 12;
export const LATE = 16; //      顺序敏感：排在同一元素的其他属性之后写（type / min / max / step 之后才写 value；srcset 之后才写 src）
export const EARLY = 32; //     顺序敏感：排在最前面写（loading、sizes、sandbox 要先于 src）
export const tierOf = (kind) => (kind & EARLY ? 0 : kind & LATE ? 2 : 1);
export const KIND_MASK = 15;

export const TABLE = Object.create(null);
const add = (kind, names) => names.split(' ').forEach((name) => (TABLE[name] = kind));
add(
  BOOL,
  'allowfullscreen async autofocus autoplay controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple nomodule novalidate open playsinline popover readonly required reversed webkitdirectory disablepictureinpicture disableremoteplayback',
);
add(PROP, 'checked selected muted');
add(PROP | LATE, 'value');
add(PROP_ONLY, 'indeterminate volume srcObject files currentTime playbackRate scrollTop scrollLeft innerHTML textContent');
add(URL, 'action formaction xlink:href data');
// src / href 要最后写：img 的 srcset、sizes、loading，iframe 的 sandbox、allow，link 的 rel、as 都要先于它
add(URL | LATE, 'href src');
add(EARLY, 'loading sizes sandbox allow referrerpolicy crossorigin rel as');
add(YESNO, 'translate');
add(CLASS, 'class');
add(STYLE, 'style');
add(SX, 'sx');
add(REF, 'ref');
add(SKIP, 'children');
/** React 拼写的别名：只在编译期改名最省事；运行时 spread 里碰到也认（并在开发期提示） */
export const ALIAS = {
  className: 'class',
  htmlFor: 'for',
  acceptCharset: 'accept-charset',
  httpEquiv: 'http-equiv',
  readOnly: 'readonly',
  noValidate: 'novalidate',
  formNoValidate: 'formnovalidate',
  autoFocus: 'autofocus',
  autoPlay: 'autoplay',
  playsInline: 'playsinline',
  allowFullScreen: 'allowfullscreen',
  isMap: 'ismap',
  noModule: 'nomodule',
};
for (const key in ALIAS) TABLE[key] = ALIAS[key];
/** 规范名 -> 别名，读 getter 键时两个名字都要看 */
const REVERSE = Object.fromEntries(Object.entries(ALIAS).map(([alias, name]) => [name, alias]));

/** 只有 property、没有 attribute 的子内容键：在 SVG / MathML 上也是 property */
export const CHILD = { innerHTML: 1, textContent: 1 };
/** 服务端绝不通过 spread 写出来的键：来源不可信时（{...userData}）最容易出事 */
export const UNSAFE_SPREAD = { innerHTML: 1, outerHTML: 1, srcdoc: 1 };

export const isEventKey = (key) => {
  if (key.charCodeAt(0) !== 111 || key.charCodeAt(1) !== 110) return false;
  const c = key.charCodeAt(2);
  return c <= 90 && (c >= 65 || c === 58); // onClick（大写字母）或 on:exact-name；小写 onclick 不是事件键
};

/** javascript: 链接。浏览器会忽略 scheme 里的制表符、换行和开头的控制字符 */
export const unsafeUrl = (value) => typeof value === 'string' && /^javascript:/i.test(value.replace(/[\u0000- ]/g, ''));

// ---- 事件键：选项写在键名后缀里，不看值，编译期就能定下来 ----
const eventInfo = new Map();
/** onClickCapture -> { name: 'Click', lower: 'click', idl: 'onclick', options: { capture: true } }；on:my-Event -> { exact } */
export function eventOf(key) {
  let info = eventInfo.get(key);
  if (info) return info;
  let name = key.slice(2);
  if (name[0] === ':') info = { exact: name.slice(1) }; // 键名原样当事件名，给大小写敏感的自定义事件
  else {
    let options;
    for (let m; (m = /(Capture|Once|Passive)$/.exec(name)) && name.length > m[0].length; name = name.slice(0, -m[1].length)) {
      (options ??= {})[m[1].toLowerCase()] = true;
    }
    const lower = name.toLowerCase();
    info = { name, lower, idl: `on${lower}`, options };
  }
  eventInfo.set(key, info);
  return info;
}

// ---- 分层 ----
export const LAYERS = Symbol('hilt.layers');
export const GETTER = Symbol('getter');
/**
 * 属性包声明自己稳定：同一个对象永远是这个内容（recipe 的部件属性包；里面随状态变的部分在 sx 的绑定里，不在对象上）。
 * 编译器对 {...s.root} 这类成员表达式的展开保守地包成读取函数，spread 发现读出来的是稳定的包，就当静态层用
 */
export const STABLE = Symbol.for('hilt.stable');
export const layersOf = (props) => props[LAYERS] ?? [props, undefined];
/** merge、omit 的结果：只有落到元素上时（绝大多数情况）不需要读属性，所以不是 Proxy；传给组件、作者要读时才建 view */
export class Layers {
  constructor(layers) {
    this[LAYERS] = layers;
  }
}
export function merge(...sources) {
  const layers = [];
  for (const source of sources) {
    if (!source) continue;
    const inner = source[LAYERS];
    if (inner) layers.push(...inner);
    else layers.push(source, undefined);
  }
  return new Layers(layers);
}
const UNION = Symbol('union');
/** 两个隐藏键集合的并集：编译器传来的是模块级的 Set，同一对集合只算一次 */
function unionOf(a, b) {
  const cache = (a[UNION] ??= new Map());
  let merged = cache.get(b);
  if (!merged) cache.set(b, (merged = new Set([...a, ...b])));
  return merged;
}
export function omit(props, keys) {
  const hide = keys instanceof Set ? keys : new Set(keys);
  const inner = layersOf(props);
  if (inner.length === 2) return new Layers([inner[0], inner[1] ? unionOf(inner[1], hide) : hide]);
  const layers = [];
  for (let i = 0; i < inner.length; i += 2) layers.push(inner[i], inner[i + 1] ? unionOf(inner[i + 1], hide) : hide);
  return new Layers(layers);
}
export const sourceOf = (source) => (typeof source === 'function' ? source() : source);
const hasGetter = (source, key) => Object.getOwnPropertyDescriptor(source, key)?.get !== undefined;
/** 实验 17-bind：这个键最上面那层的 setter。父级传的是能写回的变量时才有 */
export function setterIn(layers, key) {
  for (let i = layers.length - 2; i >= 0; i -= 2) {
    const source = sourceOf(layers[i]);
    if (source == null || layers[i + 1]?.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor) return descriptor.set ? (value) => descriptor.set.call(source, value) : undefined;
  }
  return undefined;
}
export const setterOf = (props, key) => setterIn(layersOf(props), key);
/** 这个键在这些层里有没有 getter 或动态层：决定要不要起 effect */
export function isDynamicLayer(layers) {
  for (let i = 0; i < layers.length; i += 2) if (typeof layers[i] === 'function') return true;
  return false;
}

/**
 * 一趟扫描所有层（从上往下），每个键第一个定下来的赢，不建 Set / Map。
 * dyn = true：把值直接读出来（动态键层的 effect 里、服务端）；false：getter 键只记 GETTER，留给各自的 effect。
 * 返回 names / kinds / vals 三个平行数组；累加型的键只记标记（acc 位：1 class、2 style、4 sx），accGetter 同样的位表示它有 getter。
 */
export function scan(layers, dyn) {
  const names = [];
  const kinds = [];
  const vals = [];
  let acc = 0;
  let accGetter = 0;
  let late = false;
  let events;
  let refs;
  for (let i = layers.length - 2; i >= 0; i -= 2) {
    const source = sourceOf(layers[i]);
    if (source == null) continue;
    const hidden = layers[i + 1];
    for (const key of Object.keys(source)) {
      if (hidden !== undefined && hidden.has(key)) continue;
      let name = key;
      let kind = TABLE[key];
      if (typeof kind === 'string') {
        if (config.dev) warn(`${key} 在运行时 spread 里按别名处理，请写成 ${kind}`);
        kind = TABLE[(name = kind)];
      }
      if (kind === undefined) {
        if (isEventKey(key)) {
          if (events === undefined) events = [key];
          else if (!events.includes(key)) events.push(key);
          continue;
        }
        kind = ATTR;
      }
      const base = kind & KIND_MASK;
      if (base >= CLASS) {
        if (base === REF) {
          if (typeof source.ref === 'function') (refs ??= []).unshift(source.ref);
        } else if (base !== SKIP) {
          const bit = base === CLASS ? 1 : base === STYLE ? 2 : 4;
          acc |= bit;
          if (!dyn && hasGetter(source, key)) accGetter |= bit;
        }
        continue;
      }
      if (names.includes(name)) continue;
      if (!dyn && hasGetter(source, key)) {
        names.push(name);
        kinds.push(kind);
        vals.push(GETTER);
        late ||= (kind & (LATE | EARLY)) !== 0;
        continue;
      }
      const value = source[key];
      if (value === undefined) continue;
      names.push(name);
      kinds.push(kind);
      vals.push(value);
      late ||= (kind & (LATE | EARLY)) !== 0;
    }
  }
  return { names, kinds, vals, acc, accGetter, late, events, refs };
}

/** 覆盖型键的当前值：从上往下第一个不是 undefined 的；getter 键的 effect 用它 */
export function resolve(layers, name) {
  const other = REVERSE[name];
  for (let i = layers.length - 2; i >= 0; i -= 2) {
    const source = sourceOf(layers[i]);
    if (source == null || layers[i + 1]?.has(name)) continue;
    let value = source[name];
    if (value === undefined && other !== undefined) value = source[other];
    if (value !== undefined) return value;
  }
  return undefined;
}

// ---- class：字符串 / 数组 / 对象（clsx 的规则），各层从下往上拼接 ----
export function classString(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let out = '';
    for (const item of value) {
      const part = classString(item);
      if (part) out = out ? `${out} ${part}` : part;
    }
    return out;
  }
  if (value && typeof value === 'object') {
    let out = '';
    for (const key of Object.keys(value)) if (value[key]) out = out ? `${out} ${key}` : key;
    return out;
  }
  return ''; // undefined / null / false / 数字：不出力
}
export function classOf(layers, extra) {
  let out = '';
  for (let i = 0; i < layers.length; i += 2) {
    const source = sourceOf(layers[i]);
    if (source == null || layers[i + 1]?.has('class')) continue;
    const part = classString(source.class !== undefined ? source.class : source.className);
    if (part) out = out ? `${out} ${part}` : part;
  }
  return extra ? (out ? `${out} ${extra}` : extra) : out;
}

// ---- style：字符串与对象混用，按属性合并，靠后的层优先 ----
const cssNames = new Map();
/** backgroundColor / background-color / --x / WebkitX / msX 都认 */
export function cssName(key) {
  let name = cssNames.get(key);
  if (name === undefined) {
    if (key.startsWith('--')) name = key;
    else {
      name = key === 'cssFloat' ? 'float' : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      if (name.startsWith('ms-')) name = `-${name}`;
    }
    cssNames.set(key, name);
  }
  return name;
}
/** 逐字符切分：分号和冒号在括号、引号里不算（url(data:...;base64,...)） */
function parseStyle(text, map) {
  let depth = 0;
  let quote = '';
  let start = 0;
  let colon = -1;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ':' && depth === 0 && colon < 0) colon = i;
    else if ((c === ';' && depth === 0) || c === undefined) {
      if (colon > 0) {
        const name = text.slice(start, colon).trim();
        const value = text.slice(colon + 1, i).trim();
        if (name && value) map.set(name.startsWith('--') ? name : name.toLowerCase(), value);
      }
      start = i + 1;
      colon = -1;
    }
  }
}
/** 对象里：undefined 落回下层；null / false / '' 移除（也盖住下层）；数字不补 px（csstype 里长度只收 0 和字符串） */
function addStyle(map, value) {
  if (typeof value === 'string') return parseStyle(value, map);
  // merge 留下的各层，按顺序合并
  if (Array.isArray(value)) {
    for (const layer of value) addStyle(map, layer);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item === undefined) continue;
    const name = cssName(key);
    if (item === null || item === false || item === '') map.delete(name);
    else map.set(name, String(item));
  }
}
/** base 是 sx 引擎给的行内变量，垫在最底下（服务端用）：用户写的 style 能盖住它 */
export function styleOf(layers, base) {
  const map = new Map();
  if (base) addStyle(map, base);
  for (let i = 0; i < layers.length; i += 2) {
    const source = sourceOf(layers[i]);
    if (source != null && !layers[i + 1]?.has('style')) addStyle(map, source.style);
  }
  return map;
}
export const styleFromValue = (value) => {
  const map = new Map();
  addStyle(map, value);
  return map;
};
export const styleText = (map) => [...map].map(([name, value]) => `${name}:${value}`).join(';');

export function sxValues(layers) {
  const values = [];
  for (let i = 0; i < layers.length; i += 2) {
    const source = sourceOf(layers[i]);
    if (source != null && !layers[i + 1]?.has('sx') && source.sx !== undefined) values.push(source.sx);
  }
  return values;
}

// ---- 组件读合并后的 props：Proxy 视图 ----
/**
 * 组件内部直接读 onChange、ref 时，各层的都要算数，和落到元素上时同一条规则：靠后的层先执行，
 * preventDefault 之后下层不再执行。只有一层时原样返回，不多一层函数
 */
function readHandlers(layers, key) {
  const handlers = [];
  for (let i = layers.length - 2; i >= 0; i -= 2) {
    const source = sourceOf(layers[i]);
    if (source == null || layers[i + 1]?.has(key)) continue;
    const handler = source[key];
    if (typeof handler === 'function') handlers.push(handler);
  }
  if (handlers.length < 2) return handlers[0];
  return (event) => {
    let result;
    for (const handler of handlers) {
      result = handler(event);
      if (event?.defaultPrevented) break;
    }
    return result;
  };
}
export function readKey(layers, key) {
  if (key === 'class') return classOf(layers) || undefined;
  if (key === 'style') {
    const map = styleOf(layers);
    return map.size ? Object.fromEntries(map) : undefined;
  }
  if (key === 'sx') {
    const values = sxValues(layers);
    return values.length > 1 ? values : values[0];
  }
  if (key === 'ref' || isEventKey(key)) return readHandlers(layers, key);
  return resolve(layers, key);
}
export function hasKey(layers, key) {
  for (let i = 0; i < layers.length; i += 2) {
    const source = sourceOf(layers[i]);
    if (source != null && !layers[i + 1]?.has(key) && key in source) return true;
  }
  return false;
}
export function keysOf(layers) {
  const keys = new Set();
  for (let i = 0; i < layers.length; i += 2) {
    const source = sourceOf(layers[i]);
    if (source == null) continue;
    for (const key of Object.keys(source)) if (!layers[i + 1]?.has(key)) keys.add(key);
  }
  return keys;
}
const traps = {
  // symbol 键不是属性（spread 会探测 STABLE）：不能往下走，键名判断只认字符串
  get: (view, key) => (key === LAYERS ? view.layers : typeof key === 'symbol' ? undefined : readKey(view.layers, key)),
  has: (view, key) => key === LAYERS || hasKey(view.layers, key),
  ownKeys: (view) => [...keysOf(view.layers)],
  getOwnPropertyDescriptor: (view, key) =>
    hasKey(view.layers, key) ? { configurable: true, enumerable: true, get: () => readKey(view.layers, key) } : undefined,
};
/** 轻量的 Layers 换成能读属性的视图；普通对象和已经是视图的原样返回 */
export const viewOf = (props) => (props instanceof Layers ? new Proxy({ layers: props[LAYERS] }, traps) : props);
