// 属性合并：实验二胜出的“Proxy 视图”。浏览器和服务端共用，保证两边合并语义一致。
export const LAYERS = Symbol('hilt.layers');
export const isEvent = (key) => key.length > 2 && key[0] === 'o' && key[1] === 'n' && key[2] < 'a';

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
export const sourceOf = (layer) => (typeof layer.source === 'function' ? layer.source() : layer.source);
export const hasKey = (layer, key) => {
  if (layer.hidden?.has(key)) return false;
  const source = sourceOf(layer);
  return source != null && key in source;
};
/**
 * 组件内部直接读 onChange、ref 时，各层的都要算数，和落到元素上时同一条规则：靠后的层先执行，
 * preventDefault 之后下层不再执行。只有一层时原样返回，不多一层函数
 */
function readHandlers(layers, key) {
  const handlers = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    if (!hasKey(layers[i], key)) continue;
    const handler = sourceOf(layers[i])[key];
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
  if (key === 'class') return readClass(layers);
  if (key === 'ref' || isEvent(key)) return readHandlers(layers, key);
  for (let i = layers.length - 1; i >= 0; i--) {
    if (!hasKey(layers[i], key)) continue;
    const value = sourceOf(layers[i])[key];
    if (value !== undefined) return value;
  }
  return undefined;
}
export function readClass(layers) {
  let result = '';
  for (const layer of layers) {
    if (!hasKey(layer, 'class')) continue;
    const value = sourceOf(layer).class;
    if (value) result = result ? `${result} ${value}` : value;
  }
  return result || undefined;
}
export function readSx(layers) {
  const sx = [];
  for (const layer of layers) if (hasKey(layer, 'sx')) sx.push(sourceOf(layer).sx);
  return sx;
}
export function keysOf(layers) {
  const keys = new Set();
  for (const layer of layers) {
    const source = sourceOf(layer);
    if (source == null) continue;
    for (const key of Object.keys(source)) if (!layer.hidden?.has(key)) keys.add(key);
  }
  return keys;
}
export const layersOf = (props) => props[LAYERS] ?? [{ source: props, hidden: undefined }];

const traps = {
  get: (view, key) => (key === LAYERS ? view.layers : readKey(view.layers, key)),
  has: (view, key) => key === LAYERS || view.layers.some((layer) => hasKey(layer, key)),
  ownKeys: (view) => [...keysOf(view.layers)],
  getOwnPropertyDescriptor: (view, key) =>
    view.layers.some((layer) => hasKey(layer, key))
      ? { configurable: true, enumerable: true, get: () => readKey(view.layers, key) }
      : undefined,
};
const view = (layers) => new Proxy({ layers }, traps);

/** JSX 里属性的书写顺序就是合并层次：靠后的层优先；class 拼接，事件都执行，ref 都给 */
export const merge = (...sources) => view(flatten(sources));
export function omit(props, keys) {
  const inner = props[LAYERS];
  const hide = new Set(keys);
  return view(
    inner
      ? inner.map((layer) => ({
          source: layer.source,
          hidden: layer.hidden ? new Set([...layer.hidden, ...keys]) : hide,
        }))
      : [{ source: props, hidden: hide }],
  );
}
