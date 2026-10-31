// 在 alien-signals 上写的最小深层代理，验证 _state({...}) 能否脱离 Vue 的 reactive。
// 同 Svelte 5 的 proxy：属性第一次被读时才建 signal，嵌套对象第一次被读时才包代理。
import { signal } from 'alien-signals';

const PROXIES = new WeakMap();
const RAW = Symbol('raw');
const isPlain = (value) => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === Array.prototype || proto === null;
};

export function deepState(target) {
  if (!isPlain(target)) return target;
  const existing = PROXIES.get(target);
  if (existing) return existing;
  const cells = new Map();
  // 结构变化（增删键、数组长度）统一走一个版本号
  const version = signal(0);
  const cell = (key) => {
    let s = cells.get(key);
    if (!s) cells.set(key, (s = signal(target[key])));
    return s;
  };
  const proxy = new Proxy(target, {
    get(_, key, receiver) {
      if (key === RAW) return target;
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver);
      if (!(key in target)) {
        version();
        return undefined;
      }
      const value = target[key];
      // 方法不进 signal
      if (typeof value === 'function') return value;
      return deepState(cell(key)());
    },
    set(_, key, value) {
      const raw = value?.[RAW] ?? value;
      const had = key in target;
      target[key] = raw;
      if (typeof key === 'symbol') return true;
      if (cells.has(key)) cells.get(key)(raw);
      if (!had || (Array.isArray(target) && key === 'length')) version(version() + 1);
      return true;
    },
    deleteProperty(_, key) {
      delete target[key];
      cells.get(key)?.(undefined);
      version(version() + 1);
      return true;
    },
    ownKeys() {
      version();
      return Reflect.ownKeys(target);
    },
    has(_, key) {
      version();
      return key in target;
    },
  });
  PROXIES.set(target, proxy);
  return proxy;
}
