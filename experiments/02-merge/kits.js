// 实验二：属性合并的几种实现。每个 kit 提供同样的 merge / omit / spread / root。
//   eager-whole    一个元素一个 effect，每次把所有键穿过所有层算一遍再 diff（Solid spread + vue-tsx-pro mergeProps 的形状）
//   proxy-all      Proxy 视图 + 每个键一个 effect，不区分静态键
//   proxy-static   Proxy 视图 + 只有读到 getter 的键才起 effect，事件不进 effect
//   define-static  普通对象 + defineProperty 视图，其余同 proxy-static
//   solid          真实的 solid-js mergeProps / splitProps / spread（后者覆盖前者，class 与事件手工合并）
import { computed, effect, effectScope, getActiveSub, setActiveSub } from 'alien-signals';
import { createRoot, mergeProps as solidMerge, splitProps } from 'solid-js';
import { spread as solidSpread } from 'solid-js/web';

const LAYERS = Symbol('layers');
const LISTED = new Set(['class', 'style', 'ref']);
const isEvent = (key) => key.length > 2 && key[0] === 'o' && key[1] === 'n' && key[2] < 'a';
const eventName = (key) => key.slice(2).toLowerCase();

export const stats = { domWrites: 0 };

/** 一层：来源对象，可选地隐藏一些键（omit 的结果）；来源是函数时键集合是动态的 */
function flatten(sources) {
  const layers = [];
  for (const source of sources) {
    if (!source) continue;
    const inner = source[LAYERS];
    if (inner) layers.push(...inner);
    else layers.push({ source, hidden: undefined });
  }
  return layers;
}
const sourceOf = (layer) => (typeof layer.source === 'function' ? layer.source() : layer.source);
const hasKey = (layer, key) => {
  if (layer.hidden?.has(key)) return false;
  const source = sourceOf(layer);
  return source != null && key in source;
};

/** 从上往下找第一个不是 undefined 的值：使用方写 undefined 不盖掉下层 */
function readKey(layers, key) {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (!hasKey(layers[i], key)) continue;
    const value = sourceOf(layers[i])[key];
    if (value !== undefined) return value;
  }
  return undefined;
}
function readClass(layers) {
  let result = '';
  for (let i = 0; i < layers.length; i++) {
    if (!hasKey(layers[i], 'class')) continue;
    const value = sourceOf(layers[i]).class;
    if (value) result = result ? `${result} ${value}` : value;
  }
  return result;
}
function readStyle(layers) {
  const result = {};
  for (let i = 0; i < layers.length; i++) {
    if (hasKey(layers[i], 'style')) Object.assign(result, sourceOf(layers[i]).style);
  }
  return result;
}
function keysOf(layers) {
  const keys = new Set();
  for (const layer of layers) {
    const source = sourceOf(layer);
    if (source == null) continue;
    for (const key of Object.keys(source)) if (!layer.hidden?.has(key)) keys.add(key);
  }
  return keys;
}
/** 这个键是否可能变化：动态层，或者任何一层上它是 getter */
function isReactiveKey(layers, key) {
  for (const layer of layers) {
    if (typeof layer.source === 'function') return true;
    if (layer.hidden?.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(layer.source, key);
    if (descriptor?.get) return true;
  }
  return false;
}

/** 事件：一个元素一个事件名一个监听，触发时才从上往下找处理函数；preventDefault 后下层不再执行 */
function listen(el, layers, key) {
  el.addEventListener(eventName(key), (event) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      if (!hasKey(layers[i], key)) continue;
      const handler = sourceOf(layers[i])[key];
      if (typeof handler !== 'function') continue;
      handler(event);
      if (event.defaultPrevented) return;
    }
  });
}
function runRefs(el, layers) {
  for (const layer of layers) {
    if (!hasKey(layer, 'ref')) continue;
    sourceOf(layer).ref?.(el);
  }
}
function write(el, key, value) {
  stats.domWrites++;
  if (value == null || value === false) el.removeAttribute(key);
  else el.setAttribute(key, value === true ? '' : value);
}
function writeClass(el, value) {
  stats.domWrites++;
  el.className = value;
}
function writeStyle(el, value, previous) {
  for (const key in previous) {
    if (!(key in value)) {
      stats.domWrites++;
      el.style.removeProperty(key);
    }
  }
  for (const key in value) {
    if (previous?.[key] === value[key]) continue;
    stats.domWrites++;
    el.style.setProperty(key, value[key]);
  }
  return value;
}

// ---- 视图 ----
const proxyTraps = {
  get: (view, key) => (key === LAYERS ? view.layers : readKey(view.layers, key)),
  has: (view, key) => key === LAYERS || view.layers.some((layer) => hasKey(layer, key)),
  ownKeys: (view) => [...keysOf(view.layers)],
  getOwnPropertyDescriptor: (view, key) =>
    view.layers.some((layer) => hasKey(layer, key))
      ? { configurable: true, enumerable: true, get: () => readKey(view.layers, key) }
      : undefined,
};
const proxyView = (layers) => new Proxy({ layers }, proxyTraps);

function defineView(layers) {
  const view = { [LAYERS]: layers };
  for (const key of keysOf(layers)) {
    Object.defineProperty(view, key, {
      configurable: true,
      enumerable: true,
      get: () => readKey(layers, key),
    });
  }
  return view;
}

const omitWith = (makeView) => (props, keys) => {
  const hide = new Set(keys);
  const inner = props[LAYERS];
  const layers = inner
    ? inner.map((layer) => ({
        source: layer.source,
        hidden: layer.hidden ? new Set([...layer.hidden, ...keys]) : hide,
      }))
    : [{ source: props, hidden: hide }];
  return makeView(layers);
};

// ---- 把属性放到元素上 ----
/** 每个键一个 effect；withStatic 时静态键写一次就完，不起 effect。键集合动态的层再起一个 effect 增删键 */
function spreadPerKey(el, props, withStatic, hoisted) {
  const layers = props[LAYERS] ?? [{ source: props, hidden: undefined }];
  const dynamic = layers.some((layer) => typeof layer.source === 'function');
  const active = new Map();
  const bind = (key) => {
    if (key === 'ref' || key === 'children') return;
    // 模板里已经写好、上面没有别的层碰它：不用再写
    if (hoisted && key in hoisted && !layers.some((l) => l.source !== hoisted && hasKey(l, key))) return;
    if (isEvent(key)) {
      listen(el, layers, key);
      active.set(key, undefined);
      return;
    }
    const reactive = !withStatic || isReactiveKey(layers, key);
    if (key === 'class') {
      if (!reactive) return writeClass(el, readClass(layers));
      active.set(key, effect(() => writeClass(el, readClass(layers))));
      return;
    }
    if (key === 'style') {
      let previous;
      if (!reactive) return void writeStyle(el, readStyle(layers), undefined);
      active.set(key, effect(() => void (previous = writeStyle(el, readStyle(layers), previous))));
      return;
    }
    if (!reactive) return write(el, key, readKey(layers, key));
    let last;
    active.set(
      key,
      effect(() => {
        const value = readKey(layers, key);
        if (value === last) return;
        last = value;
        write(el, key, value);
      }),
    );
  };
  if (dynamic) {
    // 逐键的 effect 不能挂在这个 effect 下面：它重跑时会销毁子 effect。归属上一层作用域，和它同级
    const owner = getActiveSub();
    effect(() => {
      const keys = keysOf(layers);
      const previousSub = setActiveSub(owner);
      for (const key of keys) if (!active.has(key)) bind(key);
      setActiveSub(previousSub);
      for (const [key, stop] of active) {
        if (keys.has(key)) continue;
        stop?.();
        active.delete(key);
        if (key === 'class') writeClass(el, '');
        else if (!isEvent(key)) write(el, key, undefined);
      }
    });
  } else {
    for (const key of keysOf(layers)) bind(key);
  }
  runRefs(el, layers);
}

/** 一个元素一个 effect：读全部键，和上次比，只写变了的 */
function spreadWhole(el, props) {
  const layers = props[LAYERS] ?? [{ source: props, hidden: undefined }];
  const previous = new Map();
  const listening = new Set();
  let previousStyle;
  effect(() => {
    const keys = keysOf(layers);
    for (const key of previous.keys()) {
      if (keys.has(key)) continue;
      previous.delete(key);
      if (key === 'class') writeClass(el, '');
      else write(el, key, undefined);
    }
    for (const key of keys) {
      if (key === 'ref' || key === 'children') continue;
      if (isEvent(key)) {
        if (!listening.has(key)) {
          listening.add(key);
          listen(el, layers, key);
        }
        continue;
      }
      if (key === 'style') {
        previousStyle = writeStyle(el, readStyle(layers), previousStyle);
        continue;
      }
      const value = key === 'class' ? readClass(layers) : readKey(layers, key);
      if (previous.get(key) === value) continue;
      previous.set(key, value);
      if (key === 'class') writeClass(el, value);
      else write(el, key, value);
    }
  });
  runRefs(el, layers);
}

const scopeRoot = (fn) => effectScope(fn);

export const KITS = {
  'eager-whole': {
    merge: (...sources) => proxyView(flatten(sources)),
    omit: omitWith(proxyView),
    spread: spreadWhole,
    root: scopeRoot,
  },
  'proxy-all': {
    merge: (...sources) => proxyView(flatten(sources)),
    omit: omitWith(proxyView),
    spread: (el, props) => spreadPerKey(el, props, false),
    root: scopeRoot,
  },
  'proxy-static': {
    merge: (...sources) => proxyView(flatten(sources)),
    omit: omitWith(proxyView),
    spread: (el, props) => spreadPerKey(el, props, true),
    root: scopeRoot,
  },
  'define-static': {
    merge: (...sources) => defineView(flatten(sources)),
    omit: omitWith(defineView),
    spread: (el, props) => spreadPerKey(el, props, true),
    root: scopeRoot,
  },
  // proxy-static + 组件内部的静态层提升进模板：编译器看得见字面量时能做到
  hoisted: {
    merge: (...sources) => proxyView(flatten(sources)),
    omit: omitWith(proxyView),
    spread: (el, props, hoist) => spreadPerKey(el, props, true, hoist),
    root: scopeRoot,
    hoistTemplate: true,
  },
  solid: {
    // Solid 的 mergeProps 后者覆盖前者：class 与事件要合并只能手写一个 getter。处理函数只建一次，否则每次重跑都换监听
    merge: (...sources) => {
      const merged = solidMerge(...sources.filter(Boolean));
      const classes = sources.filter((s) => s && 'class' in s);
      const handlers = sources.filter((s) => s && 'onClick' in s);
      const onClick = (event) => {
        for (let i = handlers.length - 1; i >= 0; i--) {
          handlers[i].onClick?.(event);
          if (event.defaultPrevented) return;
        }
      };
      return solidMerge(merged, {
        get class() {
          return classes.map((s) => s.class).filter(Boolean).join(' ');
        },
        onClick,
      });
    },
    omit: (props, keys) => splitProps(props, keys)[1],
    spread: (el, props) => solidSpread(el, props, false, true),
    root: (fn) => {
      let dispose;
      createRoot((d) => {
        dispose = d;
        fn();
      });
      return dispose;
    },
  },
};

export { computed, effect };
