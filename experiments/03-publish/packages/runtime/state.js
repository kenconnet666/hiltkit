// 深层响应式代理：_state(...) 的运行时。
// 对标 Svelte 5 的 $state（属性级 signal、读到才建、嵌套读到才包），
// 数组 / 集合 / 身份 的处理参考 Vue 3.5（改写数组方法、写入存原对象）。
//
// 约定：
//  - 原对象树里永远只有原对象（写入时 raw 化），第三方库拿到 raw(p) 看不到代理。
//  - signal 只是“通知点”，值始终从原对象读；写入先改原对象再通知。
//  - 没人追踪就不建 signal（options.lazySignals），只读遍历不产生额外内存。
import { devHooks, signal, isTracking } from './reactive.js';

/** lazySignals：只在追踪上下文里建属性 signal；设为 false 就是 Svelte 的行为（任何读都建） */
export const options = { lazySignals: true, warn: (message) => console.warn(message) };

const HANDLER = Symbol('state.handler');
const ABSENT = Symbol('absent'); // 属性不存在时 signal 里放的占位值
const handlers = new WeakMap(); // 原对象 -> Handler；代理 -> Handler 走 get 陷阱，省一张表
const WELL_KNOWN = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map((name) => Symbol[name])
    .filter((value) => typeof value === 'symbol'),
);
const hasOwn = Object.hasOwn;
const arrayProto = Array.prototype;

/** 取原对象；不是代理就原样返回 */
export function raw(value) {
  if (typeof value !== 'object' || value === null) return value;
  return value[HANDLER]?.target ?? value;
}

/**
 * 按需包成深层代理：普通对象（含 null 原型）、数组、Map、Set。
 * 其余（类实例、Date、Promise、DOM、冻结 / 不可扩展对象……）原样返回：
 * 判断依据是“原型白名单”，不是黑名单，所以未知的宿主对象天然安全。
 */
export function state(value) {
  if (typeof value !== 'object' || value === null) return value;
  const known = handlers.get(value);
  if (known !== undefined) return known.proxy;
  if (value[HANDLER] !== undefined) return value; // 已经是代理
  const Kind = handlerClass(value);
  if (Kind === undefined) return value;
  const handler = new Kind(value);
  handlers.set(value, handler);
  return handler.proxy;
}
const wrap = state;

function handlerClass(value) {
  // 冻结对象必须放过：代理的 get 返回值与不可写不可配置属性不一致会直接 TypeError
  if (!Object.isExtensible(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  // null 原型 = 字典对象，lodash 的 isPlainObject 也认；但 Object.prototype 本身不能包（p.__proto__ 会读到它）
  if (proto === Object.prototype || (proto === null && value !== Object.prototype)) return ObjectHandler;
  if (proto === arrayProto) return Array.isArray(value) ? ArrayHandler : undefined;
  if (proto === Map.prototype || proto === Set.prototype) return CollectionHandler;
  return undefined;
}

/** 开发期用：编译器把 `a === b` 改写成它，代理与原对象“同一个东西却不相等”时给出警告 */
export function strictEquals(a, b) {
  const equal = a === b;
  if (!equal && typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && raw(a) === raw(b)) {
    options.warn('比较的是代理和它的原对象：它们引用同一份数据但 === 为 false，请统一用代理（或都用 raw()）比较');
  }
  return equal;
}

/**
 * 去代理的深拷贝，读取会经过代理，所以在 effect 里调用即深度订阅。
 * 拷贝：普通对象、数组、Map、Set（键也拷贝）、Date，保留循环 / 共享引用结构。
 * 访问器求值成数据属性（快照是某一时刻的值，不带 setter）。其他值（类实例、函数、Promise……）按引用保留。
 */
export function snapshot(value) {
  return clone(value, new Map());
}

function clone(value, seen) {
  if (typeof value !== 'object' || value === null) return value;
  const source = raw(value);
  let copy = seen.get(source);
  if (copy !== undefined) return copy;
  const proto = Object.getPrototypeOf(source);
  if (proto === Date.prototype) return new Date(source.getTime());
  if (proto === arrayProto && Array.isArray(source)) {
    seen.set(source, (copy = []));
    for (const item of value) copy.push(clone(item, seen));
  } else if (proto === Map.prototype) {
    seen.set(source, (copy = new Map()));
    for (const [key, item] of value) copy.set(clone(key, seen), clone(item, seen));
  } else if (proto === Set.prototype) {
    seen.set(source, (copy = new Set()));
    for (const item of value) copy.add(clone(item, seen));
  } else if (proto === Object.prototype || proto === null) {
    seen.set(source, (copy = proto === null ? Object.create(null) : {}));
    for (const key of Object.keys(value)) {
      // '__proto__' 作为自有键（JSON.parse 能造出来）不能走赋值
      Object.defineProperty(copy, key, { value: clone(value[key], seen), writable: true, enumerable: true, configurable: true });
    }
  } else {
    return value;
  }
  return copy;
}

/** 代理的公共部分：属性 signal 表、“结构变化”signal，由具体陷阱表驱动 */
class Handler {
  constructor(target) {
    this.target = target;
    this.sources = undefined; // Map<key, Signal | null>；null = 访问器 / 只读，不由这里订阅
    this.shape = undefined; // 键集合（对象）/ 任意内容变化（数组、Map、Set）的 signal
    this.proxy = new Proxy(target, this);
  }

  /** 订阅“键集合 / 整体内容”，每次结构变化换一个新令牌值，保证一定通知 */
  trackShape() {
    if (isTracking()) void (this.shape ??= signal(undefined)).value;
  }

  bump() {
    if (this.shape !== undefined) this.shape.value = {};
  }
}

class ObjectHandler extends Handler {
  get(target, key, receiver) {
    if (key === HANDLER) return this;
    // 热路径：没人追踪时一个函数调用都不多做
    if ((!options.lazySignals || isTracking()) && (typeof key !== 'symbol' || !WELL_KNOWN.has(key))) this.track(key);
    // receiver 是代理：getter 里的 this.x 也会被追踪
    const value = Reflect.get(target, key, receiver);
    return typeof value === 'object' && value !== null ? wrap(value) : value;
  }

  has(target, key) {
    if (typeof key !== 'symbol' || !WELL_KNOWN.has(key)) this.track(key);
    return Reflect.has(target, key);
  }

  ownKeys(target) {
    this.trackShape();
    return Reflect.ownKeys(target);
  }

  set(target, key, value, receiver) {
    // 代理在别的对象的原型链上：写入落在 receiver 上，不属于这个目标
    if (receiver !== this.proxy) return Reflect.set(target, key, value, receiver);
    const desc = Reflect.getOwnPropertyDescriptor(target, key);
    // 访问器交给 setter，通知由 setter 背后的 signal 负责
    if (desc !== undefined && !('value' in desc)) return Reflect.set(target, key, value, receiver);
    const next = raw(value); // 原对象里不存代理
    if (desc?.writable && Object.is(desc.value, next)) return true;
    const before = this.measure();
    if (!Reflect.set(target, key, next, target)) return false;
    this.commit(key, next, desc === undefined, before);
    return true;
  }

  deleteProperty(target, key) {
    const had = hasOwn(target, key);
    const before = this.measure();
    if (!Reflect.deleteProperty(target, key)) return false;
    if (had) this.commit(key, ABSENT, true, before);
    return true;
  }

  /** 订阅一个键的存在与值；继承来的键（方法、__proto__）不会变，不订阅 */
  track(key) {
    if (options.lazySignals && !isTracking()) return;
    let source = this.sources?.get(key);
    if (source === undefined) {
      const desc = Reflect.getOwnPropertyDescriptor(this.target, key);
      if (desc === undefined) {
        if (key in this.target) return;
        source = signal(ABSENT);
      } else {
        // 访问器自己读符文；不可写属性永远不变
        source = 'value' in desc && desc.writable ? signal(desc.value) : null;
      }
      (this.sources ??= new Map()).set(key, source);
      if (source !== null) devHooks?.field(source, key);
    }
    if (source !== null) void source.value;
  }

  /** 写入前记录需要对比的状态（数组返回 length） */
  measure() {
    return undefined;
  }

  commit(key, next, structural) {
    const source = this.sources?.get(key);
    if (source) source.value = next;
    if (structural) this.bump();
  }

  /** 让 [from, to) 范围内的下标 signal 和 length 对齐原数组（没有范围就全部） */
  resync(from, to) {
    const { sources, target } = this;
    if (sources === undefined) return;
    const sync = (key, source) => {
      if (source) source.value = hasOwn(target, key) ? target[key] : ABSENT;
    };
    if (to - from < sources.size) {
      for (let i = from; i < to; i++) sync(String(i), sources.get(String(i)));
      sync('length', sources.get('length'));
    } else {
      for (const [key, source] of sources) sync(key, source);
    }
  }
}

class ArrayHandler extends ObjectHandler {
  get(target, key, receiver) {
    // 数组方法改写：一次订阅整个数组，不给每个下标建 signal；下标 / length 走普通路径
    const method = arrayMethods[key];
    if (method !== undefined) return method;
    return super.get(target, key, receiver);
  }

  measure() {
    return this.target.length;
  }

  commit(key, next, structural, before) {
    const length = this.target.length;
    if (length === before) super.commit(key, next, false);
    else this.resync(Math.min(before, length), Math.max(before, length)); // 越界写 / 改 length：下标与 length 一起对齐
    this.bump();
  }
}

// ---------------------------------------------------------------- 数组方法

const ITEM = 1; // 结果是元素：还原成代理
const LIST = 2; // 结果是元素数组：逐个还原
const THIS = 3; // 返回数组本身：返回代理
const arrayMethods = Object.create(null);

const toRaws = (args) => args.map(raw);
const wrapList = (list) => {
  for (let i = 0; i < list.length; i++) list[i] = wrap(list[i]);
  return list;
};
const finish = (proxy, kind, result) =>
  kind === ITEM ? wrap(result) : kind === LIST ? wrapList(result) : kind === THIS ? proxy : result;

// 回调类：在原数组上跑原生方法，回调拿到的是代理元素，读元素字段仍被逐字段追踪
for (const [name, kind] of [
  ['forEach'], ['map'], ['some'], ['every'], ['findIndex'], ['findLastIndex'], ['flatMap'],
  ['filter', LIST], ['find', ITEM], ['findLast', ITEM],
]) {
  arrayMethods[name] = function (fn, thisArg) {
    const handler = this[HANDLER];
    handler.trackShape();
    return finish(this, kind, arrayProto[name].call(handler.target, (item, i) => fn.call(thisArg, wrap(item), i, this)));
  };
}
for (const name of ['reduce', 'reduceRight']) {
  arrayMethods[name] = function (fn, ...init) {
    const handler = this[HANDLER];
    handler.trackShape();
    return arrayProto[name].call(handler.target, (acc, item, i) => fn(acc, wrap(item), i, this), ...init);
  };
}
// 参数还原成原对象的读取类：includes / indexOf 在原数组里找原对象，list.includes(o) 才成立
for (const [name, kind] of [
  ['includes'], ['indexOf'], ['lastIndexOf'], ['join'], ['toString'], ['toLocaleString'],
  ['slice', LIST], ['concat', LIST], ['flat', LIST], ['toReversed', LIST], ['toSpliced', LIST], ['with', LIST], ['at', ITEM],
]) {
  arrayMethods[name] = function (...args) {
    const handler = this[HANDLER];
    handler.trackShape();
    return finish(this, kind, arrayProto[name].apply(handler.target, toRaws(args)));
  };
}
arrayMethods.toSorted = function (compare) {
  const handler = this[HANDLER];
  handler.trackShape();
  return wrapList(arrayProto.toSorted.call(handler.target, wrapCompare(compare)));
};
const wrapCompare = (compare) => (compare === undefined ? undefined : (a, b) => compare(wrap(a), wrap(b)));

// 变更类：在原数组上操作，再对齐 signal。不走陷阱，所以不会因为内部读写 length 而自触发 / 重复触发
for (const [name, kind] of [
  ['push'], ['unshift'], ['pop', ITEM], ['shift', ITEM], ['splice', LIST],
  ['sort', THIS], ['reverse', THIS], ['fill', THIS], ['copyWithin', THIS],
]) {
  arrayMethods[name] = function (...args) {
    const handler = this[HANDLER];
    const { target } = handler;
    const before = target.length;
    const result = arrayProto[name].apply(target, name === 'sort' ? [wrapCompare(args[0])] : toRaws(args));
    const after = target.length;
    // push / pop 只动尾部，其余方法可能移动任意下标
    const from = name === 'push' ? before : name === 'pop' ? after : 0;
    handler.resync(from, Math.max(before, after));
    handler.bump();
    return finish(this, kind, result);
  };
}

// 迭代器：基于原数组的活迭代器，产出代理元素
const iterator = (handler, source, map) => {
  handler.trackShape();
  return {
    next() {
      const step = source.next();
      return step.done ? step : { done: false, value: map(step.value) };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
};
arrayMethods.values = arrayMethods[Symbol.iterator] = function () {
  const handler = this[HANDLER];
  return iterator(handler, handler.target.values(), wrap);
};
arrayMethods.keys = function () {
  const handler = this[HANDLER];
  return iterator(handler, handler.target.keys(), (key) => key);
};
arrayMethods.entries = function () {
  const handler = this[HANDLER];
  return iterator(handler, handler.target.entries(), ([i, item]) => [i, wrap(item)]);
};

// ---------------------------------------------------------------- Map / Set

/**
 * Map / Set：方法要求 this 是真集合，代理直接调用会抛 TypeError，所以像 Vue 一样改写方法。
 * 订阅粒度：get / has 按键，size / 迭代 / forEach 整体。键与值都存原对象，读出时还原成代理。
 */
class CollectionHandler extends Handler {
  constructor(target) {
    super(target);
    this.isMap = target instanceof Map;
  }

  get(target, key) {
    if (key === HANDLER) return this;
    if (key === 'size') {
      this.trackShape();
      return target.size;
    }
    // 其他成员（constructor、Symbol.toStringTag……）直接取真集合上的，避免访问器的 this 检查
    return (this.isMap ? mapMethods : setMethods)[key] ?? Reflect.get(target, key, target);
  }

  slot(key) {
    return this.target.has(key) ? (this.isMap ? this.target.get(key) : true) : ABSENT;
  }

  trackKey(key) {
    if (options.lazySignals && !isTracking()) return;
    let source = this.sources?.get(key);
    if (source === undefined) {
      (this.sources ??= new Map()).set(key, (source = signal(this.slot(key))));
      devHooks?.field(source, key);
    }
    void source.value;
  }

  changed(key) {
    const source = this.sources?.get(key);
    if (source) source.value = this.slot(key);
    this.bump();
  }

  clear() {
    if (this.target.size === 0) return;
    this.target.clear();
    if (this.sources) for (const source of this.sources.values()) source.value = ABSENT;
    this.bump();
  }
}

const collectionIterator = (handler, source, map) => iterator(handler, source, map);
const wrapPair = ([key, item]) => [wrap(key), wrap(item)];
const wrapDouble = ([key]) => [wrap(key), wrap(key)];

const sharedMethods = {
  has(key) {
    const handler = this[HANDLER];
    key = raw(key);
    handler.trackKey(key);
    return handler.target.has(key);
  },
  delete(key) {
    const handler = this[HANDLER];
    key = raw(key);
    const had = handler.target.delete(key);
    if (had) handler.changed(key);
    return had;
  },
  clear() {
    this[HANDLER].clear();
  },
  forEach(fn, thisArg) {
    const handler = this[HANDLER];
    handler.trackShape();
    handler.target.forEach((item, key) => fn.call(thisArg, wrap(item), wrap(key), this));
  },
};
const mapMethods = {
  __proto__: null,
  ...sharedMethods,
  get(key) {
    const handler = this[HANDLER];
    key = raw(key);
    handler.trackKey(key);
    return wrap(handler.target.get(key));
  },
  set(key, value) {
    const { target } = this[HANDLER];
    key = raw(key);
    value = raw(value);
    if (!target.has(key) || !Object.is(target.get(key), value)) {
      target.set(key, value);
      this[HANDLER].changed(key);
    }
    return this;
  },
  keys() {
    const handler = this[HANDLER];
    return collectionIterator(handler, handler.target.keys(), wrap);
  },
  values() {
    const handler = this[HANDLER];
    return collectionIterator(handler, handler.target.values(), wrap);
  },
  entries() {
    const handler = this[HANDLER];
    return collectionIterator(handler, handler.target.entries(), wrapPair);
  },
};
mapMethods[Symbol.iterator] = mapMethods.entries;
const setMethods = {
  __proto__: null,
  ...sharedMethods,
  add(value) {
    const handler = this[HANDLER];
    value = raw(value);
    if (!handler.target.has(value)) {
      handler.target.add(value);
      handler.changed(value);
    }
    return this;
  },
  values() {
    const handler = this[HANDLER];
    return collectionIterator(handler, handler.target.values(), wrap);
  },
  entries() {
    const handler = this[HANDLER];
    return collectionIterator(handler, handler.target.entries(), wrapDouble);
  },
};
setMethods.keys = setMethods[Symbol.iterator] = setMethods.values;
