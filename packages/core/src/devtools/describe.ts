/**
 * 把内部对象变成给人和 AI 看的摘要：值的预览、元素的写法、节点的简介、调用位置。
 * 这里的读取都不建依赖、不触发重算：调试工具不能改变被调试的程序。
 */
import { raw } from '../reactivity/state';
import { COMPUTED, idOf, nodeInfo, options, type Instance } from './store';

/** 第几个之后不再取调用栈：同一组件同一序号的调用点是固定的，只取一次；序号太大多半是循环里建的 */
const MAX_SITES_PER_COMPONENT = 32;
const sites = new Map<string, string | undefined>();

// ---- 调用栈和值的摘要 ----
const INTERNAL =
  /packages\/core\/src\/|alien-signals|node_modules\/\.vite\/|node_modules\/hiltkit\/|virtual:hilt/;
/** 第一个不在框架里的调用帧。打包成一个文件的产物分不出来，返回 undefined */
export function userSite(): string | undefined {
  const engine = Error as unknown as { stackTraceLimit: number };
  const limit = engine.stackTraceLimit;
  engine.stackTraceLimit = 30;
  const stack = new Error().stack ?? '';
  engine.stackTraceLimit = limit;
  for (const line of stack.split('\n').slice(1)) {
    if (INTERNAL.test(line)) continue;
    const match = /(?:\(|at |@)((?:https?:|file:|\/)[^\s)]+:\d+:\d+)/.exec(line);
    if (match)
      return match[1]!
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/\?t=\d+/, '')
        .replace(/\?v=\w+/, '');
  }
  return undefined;
}
export function siteFor(instance: Instance | undefined, tag: string): string | undefined {
  if (!instance) return undefined;
  const ordinal = instance.sigCount++;
  if (ordinal >= MAX_SITES_PER_COMPONENT) return undefined;
  const key = `${instance.name}:${tag}:${ordinal}`;
  if (!sites.has(key)) sites.set(key, userSite());
  return sites.get(key);
}
export const sourceText = (source: any) =>
  source?.fileName
    ? `${String(source.fileName)
        .replace(/\\/g, '/')
        .replace(/^.*\/(src)\//, '$1/')}:${source.lineNumber}:${source.columnNumber}`
    : undefined;
export const describeEl = (el: any): string | undefined => {
  if (!el?.localName) return undefined;
  const id = el.id ? `#${el.id}` : '';
  const classes =
    typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
      : '';
  return `<${el.localName}${id}${classes}>`;
};
export const REDACTED = '[已隐藏]';
export const clip = (text: string, max = 120) =>
  text.length > max ? `${text.slice(0, max)}…（共 ${text.length} 字）` : text;
/** 值的摘要：不触发追踪、不调用 getter 以外的代码，长度有上限 */
export function preview(value: unknown, depth = 2): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value === undefined ? 'undefined' : value;
  if (typeof value === 'string') return clip(value);
  if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);
  if (typeof value === 'function') {
    const cell = (value as any).$;
    return cell
      ? `sig(${JSON.stringify(sensitive(cell) ? REDACTED : preview(readNode(cell), 0))})`
      : `ƒ ${value.name || 'anonymous'}`;
  }
  if (typeof Element !== 'undefined' && value instanceof Element) return describeEl(value);
  const source: any = raw(value);
  if (Array.isArray(source))
    return depth <= 0
      ? `Array(${source.length})`
      : {
          length: source.length,
          first: source.slice(0, 5).map((item) => preview(item, depth - 1)),
        };
  if (source instanceof Date) return source.toISOString();
  if (source instanceof Map || source instanceof Set)
    return `${source.constructor.name}(${source.size})`;
  const proto = Object.getPrototypeOf(source);
  if (proto !== Object.prototype && proto !== null)
    return `[${proto?.constructor?.name ?? 'object'}]`;
  if (depth <= 0) return '{…}';
  const out: Record<string, unknown> = {};
  const keys = Object.keys(source);
  for (const key of keys.slice(0, 12)) {
    if (options.redact.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    out[key] =
      descriptor && 'value' in descriptor ? preview(descriptor.value, depth - 1) : '[getter]';
  }
  if (keys.length > 12) out['…'] = `共 ${keys.length} 个键`;
  return out;
}
/** 读节点当前值，不建依赖、不触发重算 */
export const readNode = (node: any): unknown =>
  node.kind === COMPUTED ? node.value_ : 'currentValue' in node ? node.currentValue : node.value;
/** 字段名敏感，或者绑到了密码框上：值不输出 */
export function sensitive(node: any): boolean {
  const info = nodeInfo.get(node);
  if (info?.field && options.redact.test(String(info.field))) return true;
  for (let link = node.subs; link; link = link.nextSub) {
    const sub = nodeInfo.get(link.sub);
    if (sub?.el && isRedactedTarget(sub.el, sub.key)) return true;
  }
  return false;
}
export const nodeValue = (node: any) => (sensitive(node) ? REDACTED : preview(readNode(node)));

// ---- 依赖图 ----
export function depsOf(node: any): any[] {
  const out: any[] = [];
  for (let link = node.deps; link; link = link.nextDep) if (link.dep.kind) out.push(link.dep);
  return out;
}
export function subsOf(node: any): any[] {
  const out: any[] = [];
  for (let link = node.subs; link; link = link.nextSub) out.push(link.sub);
  return out;
}
export const signalId = (node: any) => idOf(node, node.kind === COMPUTED ? 'd' : 's');
export const effectId = (node: any) => idOf(node, 'e');
export function signalBrief(node: any) {
  const info = nodeInfo.get(node);
  return {
    id: signalId(node),
    name: info?.name ?? (node.kind === COMPUTED ? 'derived' : 'signal'),
    field: info?.field,
    value: nodeValue(node),
    component: info?.instance?.name,
    site: info?.site,
  };
}
export const isRedactedTarget = (el: any, key?: string) =>
  (key !== undefined && options.redact.test(key)) || (key === 'value' && el?.type === 'password');
/** effect 落到页面上的内容，用来判断这次是不是白跑 */
export function targetValue(info: any): unknown {
  const { el, key, kind } = info;
  if (!el) return undefined;
  if (isRedactedTarget(el, key)) return REDACTED;
  if (kind === 'list') return `${el.childNodes.length} 个子节点`;
  if (kind === 'region') return clip(el.textContent ?? '', 200);
  if (kind === 'model') return key === 'checked' ? el.checked : el.value;
  return el.getAttribute?.(key === 'className' ? 'class' : key) ?? 'null';
}
export const effectTarget = (info: any) =>
  info.el ? (info.key ? `${describeEl(info.el)} ${info.key}` : describeEl(info.el)) : undefined;
export function effectBrief(node: any) {
  const info = nodeInfo.get(node) ?? {};
  return {
    id: effectId(node),
    kind: info.kind,
    target: effectTarget(info),
    component: info.instance?.name,
    runs: info.runs ?? 0,
    site: info.site,
  };
}
