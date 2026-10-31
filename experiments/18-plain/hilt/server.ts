// 服务端渲染单独一个模块：只有调用 renderToString 才带上，浏览器产物摇掉
import { diagnostics, dispose, runSetup } from '@hilt/reactive';
import { isEventKey } from '@hilt/rules';
import { ssr, ssrAttr, ssrChild, ssrElement } from '@hilt/server';
import { Custom, VNode, dynamicSources, inApp, merge, setServerMode, settle } from './index';

// ---- 渲染成字符串 ----
/** sx 只展开函数和普通数组：片段、动态样式的结果带 symbol，不能拆 */
const settleSx = (value: unknown): unknown => {
  if (typeof value === 'function') return settleSx(value());
  if (Array.isArray(value) && !Object.getOwnPropertySymbols(value).length) return value.map(settleSx);
  return value;
};
function settleForServer(props: any): any {
  const out: any = {};
  for (const key in props) {
    const value = props[key];
    if (key === 'children' || key === 'ref' || key === 'key' || isEventKey(key)) continue;
    out[key] = key === 'sx' ? settleSx(value) : key === 'class' || key === 'style' ? settle(value) : typeof value === 'function' ? value() : value;
  }
  const sources = dynamicSources(props);
  if (!sources) return out;
  // 和客户端同样分层：class 拼接、style 按属性合并
  return merge(out, ...sources.map((source) => settleForServer(source() ?? {})));
}
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** 这些键要走完整路径：值落在子节点上、要和别的键合成一个属性、或者要看上下文 */
const SLOW_TAGS = new Set(['select', 'textarea', 'option']);
const SLOW_KEYS = new Set(['sx', 'innerHTML', 'textContent']);
function elementHtml(tag: string, props: any): string {
  if (SLOW_TAGS.has(tag) || Object.getOwnPropertySymbols(props).length) return slowElement(tag, props);
  // 绝大多数元素：逐个键写，不建分层
  let attrs = '';
  for (const key in props) {
    if (key === 'children') continue;
    if (SLOW_KEYS.has(key)) return slowElement(tag, props);
    if (key === 'ref' || key === 'key' || isEventKey(key)) continue;
    const value = props[key];
    if (value === undefined) continue;
    attrs += ssrAttr(key, key === 'class' || key === 'style' ? settle(value) : typeof value === 'function' ? value() : value, tag);
  }
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${toHtml(props.children)}</${tag}>`;
}
function slowElement(tag: string, props: any): string {
  return ssrChild(ssrElement(tag, settleForServer(props), () => ssr([toHtml(props.children)])));
}
function toHtml(value: unknown): string {
  // 最常见的先判断：一万行列表这里要走十几万次
  if (typeof value === 'string' || typeof value === 'number') return ssrChild(value);
  if (value instanceof VNode) {
    if (typeof value.type === 'function') return runSetup((props: unknown) => toHtml(value.type(props)), value.props) as string;
    return elementHtml(value.type, value.props);
  }
  if (value == null || value === true || value === false) return '';
  if (Array.isArray(value)) {
    let out = '';
    let lastWasText = false;
    for (const item of value) {
      const isText = typeof item === 'string' || typeof item === 'number';
      if (isText && lastWasText) out += '<!---->';
      out += toHtml(item);
      lastWasText = isText;
    }
    return out;
  }
  if (typeof value === 'function') {
    let inner = value();
    while (typeof inner === 'function') inner = inner();
    return `<!--[-->${toHtml(inner)}<!--]-->`;
  }
  if (value instanceof Custom) return value.html(toHtml);
  return ssrChild(String(value));
}

export function renderToString(view: () => unknown): string {
  setServerMode(true);
  // 服务端渲染里读状态是正常的，不是忘了写成函数
  const previous = diagnostics.setupReads;
  diagnostics.setupReads = false;
  try {
    const { node, result } = inApp(() => toHtml(view()));
    dispose(node);
    return result;
  } finally {
    diagnostics.setupReads = previous;
    setServerMode(false);
  }
}
