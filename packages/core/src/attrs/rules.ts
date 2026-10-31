/**
 * 属性规则：浏览器（`write.ts`、`spread.ts`）和服务端（`server/html.ts`）共用同一张表、同一套分层扫描
 * 与 class、style 合成，两边写出来的东西才会一致。这里没有任何 DOM 依赖。
 *
 * 分层：属性的书写顺序就是层次，靠后的层优先。层数组是 [来源, 隐藏键集合, 来源, 隐藏键集合 ...]，
 * 来源是对象，或返回对象的函数（`dynamic()` 产生的动态键层）。
 * 两类属性：
 *   覆盖型（普通属性）  从上往下第一个不是 undefined 的值赢；null = 明确移除（盖住下层）；undefined = 落回下层
 *   累加型（class、style、事件、ref、sx）  每层都出力；undefined、null、false 只是不出力，不盖下层
 */

/** 一层属性来源 */
export type LayerSource =
  Record<string, any> | (() => Record<string, any> | null | undefined) | null | undefined;
/** [来源, 隐藏键集合, 来源, 隐藏键集合 ...] */
export type LayerList = (LayerSource | Set<string> | undefined)[];

export const XHTML = 'http://www.w3.org/1999/xhtml';

/** sx 是样式引擎的钩子：(...各层的 sx 值) => ({ class?, style?, watch? })，由样式模块登记；dev 控制开发期警告 */
export interface SxResult {
  class?: string;
  style?: Record<string, string>;
  /** 引擎有响应式绑定时返回：在元素的 Host 上监听，返回停止函数 */
  watch?: (host: any) => (() => void) | undefined;
}
export const config: { dev: boolean; sx: ((...values: unknown[]) => SxResult) | undefined } = {
  dev: true,
  sx: undefined,
};
export const warn = (message: string): void => {
  if (config.dev) console.warn(`[attr] ${message}`);
};
/** 样式模块登记引擎。运行时不依赖引擎：不用 sx 的应用不会引入它，引擎不进包 */
export const registerStyleEngine = (engine: NonNullable<typeof config.sx>): void => {
  config.sx = engine;
};

// ---- 键的种类：一次查表决定怎么写 ----
export const ATTR = 0; //       默认：setAttribute（SSR 同形）
export const BOOL = 1; //       布尔 attribute：true -> ""，false、null -> 移除，字符串原样（hidden="until-found"、popover="manual"）
export const PROP = 2; //       表单状态：写 property，同时镜像成 default* attribute（和 SSR 解析出来的 DOM 同形）
export const PROP_ONLY = 3; //  只有 property（没有 attribute，或 attribute 语义不同）：SSR 写不出来，客户端挂载后补
export const URL_ATTR = 4; //   带 URL 的 attribute：拦截 javascript:
export const YESNO = 5; //      translate：true -> "yes"，false -> "no"
export const CLASS = 8;
export const STYLE = 9;
export const SX = 10;
export const REF = 11;
export const SKIP = 12;
export const LATE = 16; //      顺序敏感：排在同一元素的其他属性之后写（type、min、max、step 之后才写 value；srcset 之后才写 src）
export const EARLY = 32; //     顺序敏感：排在最前面写（loading、sizes、sandbox 要先于 src）
export const tierOf = (kind: number): number => (kind & EARLY ? 0 : kind & LATE ? 2 : 1);
export const KIND_MASK = 15;

/** 键名 -> 种类；值是字符串时表示别名，指向规范名 */
export const TABLE: Record<string, number | string | undefined> = Object.create(null);
const add = (kind: number, names: string) =>
  names.split(' ').forEach((name) => (TABLE[name] = kind));
add(
  BOOL,
  'allowfullscreen async autofocus autoplay controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple nomodule novalidate open playsinline popover readonly required reversed webkitdirectory disablepictureinpicture disableremoteplayback',
);
add(PROP, 'checked selected muted');
add(PROP | LATE, 'value');
add(
  PROP_ONLY,
  'indeterminate volume srcObject files currentTime playbackRate scrollTop scrollLeft innerHTML textContent',
);
add(URL_ATTR, 'action formaction xlink:href data');
// src、href 要最后写：img 的 srcset、sizes、loading，iframe 的 sandbox、allow，link 的 rel、as 都要先于它
add(URL_ATTR | LATE, 'href src');
add(EARLY, 'loading sizes sandbox allow referrerpolicy crossorigin rel as');
add(YESNO, 'translate');
add(CLASS, 'class');
add(STYLE, 'style');
add(SX, 'sx');
add(REF, 'ref');
add(SKIP, 'children');
/** React 拼写的别名：运行时碰到也认，开发期提示 */
export const ALIAS: Record<string, string> = {
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
/** 规范名 -> 别名，读键时两个名字都要看 */
const REVERSE = Object.fromEntries(Object.entries(ALIAS).map(([alias, name]) => [name, alias]));

/** 只有 property、没有 attribute 的子内容键：在 SVG、MathML 上也是 property */
export const CHILD: Record<string, 1> = { innerHTML: 1, textContent: 1 };
/** 服务端绝不通过 spread 写出来的键：来源不可信时（{...userData}）最容易出事 */
export const UNSAFE_SPREAD: Record<string, 1> = { innerHTML: 1, outerHTML: 1, srcdoc: 1 };

/** onClick（大写字母）或 on:exact-name 是事件键；小写 onclick 不是 */
export const isEventKey = (key: string): boolean => {
  if (key.charCodeAt(0) !== 111 || key.charCodeAt(1) !== 110) return false;
  const c = key.charCodeAt(2);
  return c <= 90 && (c >= 65 || c === 58);
};

// oxlint-disable-next-line no-control-regex -- 要去掉的就是控制字符
const stripControl = (value: string) => value.replace(/[\u0000- ]/g, '');
/** javascript: 链接。浏览器会忽略 scheme 里的制表符、换行和开头的控制字符 */
export const unsafeUrl = (value: unknown): boolean =>
  typeof value === 'string' && /^javascript:/i.test(stripControl(value));

// ---- 事件键：选项写在键名后缀里，不看值 ----
export interface EventInfo {
  /** on:my-Event 的原样事件名，大小写敏感的自定义事件用 */
  exact?: string;
  name: string;
  lower: string;
  idl: string;
  options?: AddEventListenerOptions;
}
const eventInfo = new Map<string, EventInfo>();
/** onClickCapture -> { name: 'Click', lower: 'click', idl: 'onclick', options: { capture: true } }；on:my-Event -> { exact } */
export function eventOf(key: string): EventInfo {
  let info = eventInfo.get(key);
  if (info) return info;
  let name = key.slice(2);
  if (name[0] === ':') info = { exact: name.slice(1), name, lower: name, idl: '' };
  else {
    let options: Record<string, boolean> | undefined;
    for (
      let m;
      (m = /(Capture|Once|Passive)$/.exec(name)) && name.length > m[0].length;
      name = name.slice(0, -m[1]!.length)
    ) {
      (options ??= {})[m[1]!.toLowerCase()] = true;
    }
    const lower = name.toLowerCase();
    info = { name, lower, idl: `on${lower}`, ...(options ? { options } : {}) };
  }
  eventInfo.set(key, info);
  return info;
}

// ---- 分层 ----
export const LAYERS = Symbol('hilt.layers');
export const GETTER = Symbol('getter');
/**
 * 属性包声明自己稳定：同一个对象永远是这个内容（recipe 的部件属性包；里面随状态变的部分在 sx 的绑定里，不在对象上）。
 * spread 发现函数层读出来是稳定的包，就当静态层用，不起 effect
 */
export const STABLE = Symbol.for('hilt.stable');
export const layersOf = (props: any): LayerList => props[LAYERS] ?? [props, undefined];
/** 合并的结果。只有落到元素上时（绝大多数情况）不需要读属性，所以不是 Proxy */
export class Layers {
  [LAYERS]: LayerList;
  constructor(layers: LayerList) {
    this[LAYERS] = layers;
  }
}
/** 把几份属性叠成分层。动态键（`dynamic()`）落到元素时用 */
export function mergeLayers(...sources: LayerSource[]): Layers {
  const layers: LayerList = [];
  for (const source of sources) {
    if (!source) continue;
    const inner = (source as any)[LAYERS];
    if (inner) layers.push(...inner);
    else layers.push(source, undefined);
  }
  return new Layers(layers);
}
export const sourceOf = (source: unknown): Record<string, any> | null | undefined =>
  (typeof source === 'function' ? source() : source) as Record<string, any> | null | undefined;
const hiddenAt = (layers: LayerList, i: number) => layers[i + 1] as Set<string> | undefined;
const hasGetter = (source: object, key: string) =>
  Object.getOwnPropertyDescriptor(source, key)?.get !== undefined;
/** 这些层里有没有函数来源（动态键层）：决定要不要整个元素一个 effect */
export function isDynamicLayer(layers: LayerList): boolean {
  for (let i = 0; i < layers.length; i += 2) if (typeof layers[i] === 'function') return true;
  return false;
}

/** scan 的结果：names、kinds、vals 是平行数组 */
export interface ScanPlan {
  names: string[];
  kinds: number[];
  vals: unknown[];
  /** 累加型的键：1 class、2 style、4 sx */
  acc: number;
  /** 同样的位，表示它有 getter */
  accGetter: number;
  late: boolean;
  events: string[] | undefined;
  refs: ((el: unknown) => void)[] | undefined;
}
/**
 * 一趟扫描所有层（从上往下），每个键第一个定下来的赢，不建 Set、Map。
 * dyn = true：把值直接读出来（动态键层的 effect 里、服务端）；false：getter 键只记 GETTER，留给各自的 effect。
 */
export function scan(layers: LayerList, dyn: boolean): ScanPlan {
  const names: string[] = [];
  const kinds: number[] = [];
  const vals: unknown[] = [];
  let acc = 0;
  let accGetter = 0;
  let late = false;
  let events: string[] | undefined;
  let refs: ((el: unknown) => void)[] | undefined;
  for (let i = layers.length - 2; i >= 0; i -= 2) {
    const source = sourceOf(layers[i]);
    if (source == null) continue;
    const hidden = hiddenAt(layers, i);
    for (const key of Object.keys(source)) {
      if (hidden !== undefined && hidden.has(key)) continue;
      let name = key;
      let entry = TABLE[key];
      if (typeof entry === 'string') {
        if (config.dev) warn(`${key} 在运行时 spread 里按别名处理，请写成 ${entry}`);
        name = entry;
        entry = TABLE[name];
      }
      if (entry === undefined) {
        if (isEventKey(key)) {
          if (events === undefined) events = [key];
          else if (!events.includes(key)) events.push(key);
          continue;
        }
        entry = ATTR;
      }
      const kind = entry as number;
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
export function resolve(layers: LayerList, name: string): unknown {
  const other = REVERSE[name];
  for (let i = layers.length - 2; i >= 0; i -= 2) {
    const source = sourceOf(layers[i]);
    if (source == null || hiddenAt(layers, i)?.has(name)) continue;
    let value = source[name];
    if (value === undefined && other !== undefined) value = source[other];
    if (value !== undefined) return value;
  }
  return undefined;
}

// ---- class：字符串、数组、对象（clsx 的规则），各层从下往上拼接 ----
export function classString(value: unknown): string {
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
    for (const key of Object.keys(value))
      if ((value as Record<string, unknown>)[key]) out = out ? `${out} ${key}` : key;
    return out;
  }
  return ''; // undefined、null、false、数字：不出力
}
export function classOf(layers: LayerList, extra?: string): string {
  let out = '';
  for (let i = 0; i < layers.length; i += 2) {
    const source = sourceOf(layers[i]);
    if (source == null || hiddenAt(layers, i)?.has('class')) continue;
    const part = classString(source.class !== undefined ? source.class : source.className);
    if (part) out = out ? `${out} ${part}` : part;
  }
  return extra ? (out ? `${out} ${extra}` : extra) : out;
}

// ---- style：字符串与对象混用，按属性合并，靠后的层优先 ----
const cssNames = new Map<string, string>();
/** backgroundColor、background-color、--x、WebkitX、msX 都认 */
export function cssName(key: string): string {
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
function parseStyle(text: string, map: Map<string, string>): void {
  let depth = 0;
  let quote: string | undefined = '';
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
/** 对象里：undefined 落回下层；null、false、'' 移除（也盖住下层）；数字不补 px（csstype 里长度只收 0 和字符串） */
function addStyle(map: Map<string, string>, value: unknown): void {
  if (typeof value === 'string') return parseStyle(value, map);
  // merge 留下的各层，按顺序合并
  if (Array.isArray(value)) {
    for (const layer of value) addStyle(map, layer);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined) continue;
    const name = cssName(key);
    if (item === null || item === false || item === '') map.delete(name);
    else map.set(name, String(item));
  }
}
/** base 是 sx 引擎给的行内变量，垫在最底下（服务端用）：用户写的 style 能盖住它 */
export function styleOf(layers: LayerList, base?: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (base) addStyle(map, base);
  for (let i = 0; i < layers.length; i += 2) {
    const source = sourceOf(layers[i]);
    if (source != null && !hiddenAt(layers, i)?.has('style')) addStyle(map, source.style);
  }
  return map;
}
export const styleFromValue = (value: unknown): Map<string, string> => {
  const map = new Map<string, string>();
  addStyle(map, value);
  return map;
};
export const styleText = (map: Map<string, string>): string =>
  [...map].map(([name, value]) => `${name}:${value}`).join(';');

export function sxValues(layers: LayerList): unknown[] {
  const values: unknown[] = [];
  for (let i = 0; i < layers.length; i += 2) {
    const source = sourceOf(layers[i]);
    if (source != null && !hiddenAt(layers, i)?.has('sx') && source.sx !== undefined)
      values.push(source.sx);
  }
  return values;
}
