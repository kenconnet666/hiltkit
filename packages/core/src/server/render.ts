/**
 * 服务端渲染：描述对象 → HTML 字符串。没有 DOM，effect 不执行，读状态拿当前值，一次同步拼完。
 *
 * 动态段前后放 `<!--[-->`、`<!--]-->`，相邻文字之间放 `<!---->`，水合时靠它们对齐节点，
 * 所以这里的输出结构要和 `render/render.ts` 一一对应。
 */
import { isEventKey } from '../attrs/rules';
import { inApp } from '../app/context';
import { diagnostics, dispose, runSetup } from '../reactivity/kernel';
import { setServerMode } from '../reactivity/sig';
import { merge } from '../render/merge';
import { dynamicSources, settle } from '../render/props';
import { Custom, VNode } from '../render/vnode';
import { VOID, escapeText, ssrAttr, ssrElement } from './html';

/** sx 只展开函数和普通数组：片段、动态样式的结果带 symbol，不能拆 */
const settleSx = (value: unknown): unknown => {
  if (typeof value === 'function') return settleSx(value());
  if (Array.isArray(value) && !Object.getOwnPropertySymbols(value).length)
    return value.map(settleSx);
  return value;
};
function settleForServer(props: any): any {
  const out: any = {};
  for (const key in props) {
    const value = props[key];
    if (key === 'children' || key === 'ref' || key === 'key' || isEventKey(key)) continue;
    out[key] =
      key === 'sx'
        ? settleSx(value)
        : key === 'class' || key === 'style'
          ? settle(value)
          : typeof value === 'function'
            ? value()
            : value;
  }
  const sources = dynamicSources(props);
  if (!sources) return out;
  // 和客户端同样分层：class 拼接、style 按属性合并
  return merge(out, ...sources.map((source) => settleForServer(source() ?? {})));
}
/** 这些要走完整路径：值落在子节点上、要和别的键合成一个属性、或者要看上下文 */
const SLOW_TAGS = new Set(['select', 'textarea', 'option']);
const SLOW_KEYS = new Set(['sx', 'innerHTML', 'textContent']);
function elementHtml(tag: string, props: any): string {
  if (SLOW_TAGS.has(tag) || Object.getOwnPropertySymbols(props).length)
    return slowElement(tag, props);
  // 绝大多数元素：逐个键写，不建分层
  let attrs = '';
  for (const key in props) {
    if (key === 'children') continue;
    if (SLOW_KEYS.has(key)) return slowElement(tag, props);
    if (key === 'ref' || key === 'key' || isEventKey(key)) continue;
    const value = props[key];
    if (value === undefined) continue;
    attrs += ssrAttr(
      key,
      key === 'class' || key === 'style'
        ? settle(value)
        : typeof value === 'function'
          ? value()
          : value,
      tag,
    );
  }
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${toHtml(props.children)}</${tag}>`;
}
function slowElement(tag: string, props: any): string {
  // 明确写在 JSX 上的 innerHTML 是作者的决定，原样输出；动态键里的不算，见 html.ts
  const { innerHTML, ...rest } = props;
  const children = () =>
    innerHTML == null
      ? toHtml(props.children)
      : String(typeof innerHTML === 'function' ? innerHTML() : innerHTML);
  return ssrElement(tag, settleForServer(rest), children);
}
function toHtml(value: unknown): string {
  // 最常见的先判断：一万行列表这里要走十几万次
  if (typeof value === 'string' || typeof value === 'number') return escapeText(value);
  if (value instanceof VNode) {
    if (typeof value.type === 'function') {
      return runSetup((props: unknown) => toHtml(value.type(props)), value.props);
    }
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
  return escapeText(String(value));
}

/** 把视图渲染成 HTML。用到 lazy 组件时先 await preloadLazy()；样式另外用 renderStyleTag 取 */
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
