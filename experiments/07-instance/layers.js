// 层的两种表示，接口相同：
//   objectLayers  每层一个 {source, hidden}，层放进数组（03-publish 原型的形状）
//   flatLayers    [source0, hidden0, source1, hidden1, …] 一个平铺数组，不为每层建对象
// 一层 = 一个来源对象（或返回对象的函数，键集合动态）+ 被 omit 隐藏的键集合。
import { cfg, counters } from './config.js';

export const LAYERS = Symbol('layers');
/** shape：来源对象原型上的键清单与 getter 键集合，省掉每实例的 Object.keys / getOwnPropertyDescriptor */
export const KEYS = Symbol('keys');
export const GETTERS = Symbol('getters');
export const isEvent = (key) => key.length > 2 && key[0] === 'o' && key[1] === 'n' && key[2] < 'a';

const UNION = Symbol('union');
/** hidden 并集：hoistSet 时缓存在集合上，同一对集合只算一次 */
function union(a, b) {
  if (cfg.hoistSet) {
    const cache = (a[UNION] ??= new Map());
    let merged = cache.get(b);
    if (!merged) cache.set(b, (merged = new Set([...a, ...b])));
    return merged;
  }
  counters.sets++;
  return new Set([...a, ...b]);
}
function hideSet(keys) {
  if (cfg.hoistSet) return keys; // 编译器传来的就是模块级的 Set
  counters.sets++;
  return new Set(keys);
}

const call = (source) => (typeof source === 'function' ? source() : source);
const keysOfSource = (source) => (cfg.shape ? (source[KEYS] ?? Object.keys(source)) : Object.keys(source));

function getterKey(source, key) {
  if (cfg.shape) {
    const getters = source[GETTERS];
    if (getters !== undefined) return getters.has(key);
  }
  return Object.getOwnPropertyDescriptor(source, key)?.get !== undefined;
}

// ---------------- 对象层 ----------------
export const objectLayers = {
  inner: (props) => props[LAYERS],
  single: (props) => {
    counters.layerObjs += 2;
    return [{ source: props, hidden: undefined }];
  },
  flatten(sources) {
    const layers = [];
    counters.layerObjs++;
    for (const source of sources) {
      if (!source) continue;
      const inner = source[LAYERS];
      if (inner) layers.push(...inner);
      else {
        counters.layerObjs++;
        layers.push({ source, hidden: undefined });
      }
    }
    return layers;
  },
  omit(props, keys) {
    const inner = props[LAYERS];
    const hide = hideSet(keys);
    if (!inner) {
      counters.layerObjs += 2;
      return [{ source: props, hidden: hide }];
    }
    counters.layerObjs += 1 + inner.length;
    return inner.map((layer) => ({
      source: layer.source,
      hidden: layer.hidden ? union(layer.hidden, hide) : hide,
    }));
  },
  count: (layers) => layers.length,
  source: (layers, i) => call(layers[i].source),
  rawSource: (layers, i) => layers[i].source,
  hidden: (layers, i) => layers[i].hidden,
  has(layers, i, key) {
    const layer = layers[i];
    if (layer.hidden?.has(key)) return false;
    const source = call(layer.source);
    return source != null && key in source;
  },
  read(layers, key) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (layer.hidden?.has(key)) continue;
      const source = call(layer.source);
      if (source == null || !(key in source)) continue;
      const value = source[key];
      if (value !== undefined) return value;
    }
    return undefined;
  },
  readClass(layers) {
    let result = '';
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer.hidden?.has('class')) continue;
      const source = call(layer.source);
      if (source == null || !('class' in source)) continue;
      const value = source.class;
      if (value) result = result ? `${result} ${value}` : value;
    }
    return result || undefined;
  },
  keys(layers) {
    const keys = new Set();
    counters.sets++;
    for (const layer of layers) {
      const source = call(layer.source);
      if (source == null) continue;
      for (const key of keysOfSource(source)) if (!layer.hidden?.has(key)) keys.add(key);
    }
    return keys;
  },
  isReactive(layers, key) {
    for (const layer of layers) {
      if (typeof layer.source === 'function') return true;
      if (layer.hidden?.has(key)) continue;
      if (getterKey(layer.source, key)) return true;
    }
    return false;
  },
  dynamic(layers) {
    for (const layer of layers) if (typeof layer.source === 'function') return true;
    return false;
  },
};

// ---------------- 平铺层 ----------------
export const flatLayers = {
  inner: (props) => props[LAYERS],
  single(props) {
    counters.layerObjs++;
    return [props, undefined];
  },
  flatten(sources) {
    const layers = [];
    counters.layerObjs++;
    for (const source of sources) {
      if (!source) continue;
      const inner = source[LAYERS];
      if (inner) for (let i = 0; i < inner.length; i++) layers.push(inner[i]);
      else layers.push(source, undefined);
    }
    return layers;
  },
  omit(props, keys) {
    const inner = props[LAYERS];
    const hide = hideSet(keys);
    counters.layerObjs++;
    if (!inner) return [props, hide];
    const layers = new Array(inner.length);
    for (let i = 0; i < inner.length; i += 2) {
      layers[i] = inner[i];
      layers[i + 1] = inner[i + 1] ? union(inner[i + 1], hide) : hide;
    }
    return layers;
  },
  count: (layers) => layers.length >> 1,
  source: (layers, i) => call(layers[i << 1]),
  rawSource: (layers, i) => layers[i << 1],
  hidden: (layers, i) => layers[(i << 1) + 1],
  has(layers, i, key) {
    if (layers[(i << 1) + 1]?.has(key)) return false;
    const source = call(layers[i << 1]);
    return source != null && key in source;
  },
  read(layers, key) {
    for (let i = layers.length - 2; i >= 0; i -= 2) {
      if (layers[i + 1]?.has(key)) continue;
      const source = call(layers[i]);
      if (source == null || !(key in source)) continue;
      const value = source[key];
      if (value !== undefined) return value;
    }
    return undefined;
  },
  readClass(layers) {
    let result = '';
    for (let i = 0; i < layers.length; i += 2) {
      if (layers[i + 1]?.has('class')) continue;
      const source = call(layers[i]);
      if (source == null || !('class' in source)) continue;
      const value = source.class;
      if (value) result = result ? `${result} ${value}` : value;
    }
    return result || undefined;
  },
  keys(layers) {
    const keys = new Set();
    counters.sets++;
    for (let i = 0; i < layers.length; i += 2) {
      const source = call(layers[i]);
      if (source == null) continue;
      const hidden = layers[i + 1];
      for (const key of keysOfSource(source)) if (!hidden?.has(key)) keys.add(key);
    }
    return keys;
  },
  isReactive(layers, key) {
    for (let i = 0; i < layers.length; i += 2) {
      if (typeof layers[i] === 'function') return true;
      if (layers[i + 1]?.has(key)) continue;
      if (getterKey(layers[i], key)) return true;
    }
    return false;
  },
  dynamic(layers) {
    for (let i = 0; i < layers.length; i += 2) if (typeof layers[i] === 'function') return true;
    return false;
  },
};

export { call as sourceCall, getterKey, keysOfSource };
