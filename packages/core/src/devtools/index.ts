/**
 * 调试内核 `hiltkit/devtools`：组件树、依赖图、更新因果、问题清单。只在开发期导入（hiltDevtools 插件注入，或手写 import）。
 *
 * 所有客户端（命令行、MCP、浏览器插件、测试）都走同一个入口：globalThis.__HILT_DEVTOOLS__.call(方法, 参数)。
 * 输出都是可以直接 JSON 化的摘要：默认短，靠 id 下钻，不把整棵树或整份状态一次吐出来。
 *
 * 数据来源是内核和渲染层的 devHooks：组件不占内核节点，所以这里自己维护一棵组件树，
 * 靠 owner（管销毁的节点）决定组件什么时候消失。
 */
import { flushSync, getOwner, setDevHooks } from '../reactivity/kernel';
import { raw } from '../reactivity/state';

export const PROTOCOL_VERSION = 1;
const SIGNAL = 1;
const COMPUTED = 2;
const RENDER_FLAG = 128;
const MAX_EVENTS = 20000;
const MAX_ISSUES = 200;
/** 第几个之后不再取调用栈：同一组件同一序号的调用点是固定的，只取一次；序号太大多半是循环里建的 */
const MAX_SITES_PER_COMPONENT = 32;

interface Options {
  /** 这些键名的值不输出。AI 和面板读到的状态可能进日志，令牌、密码不能跟着出去 */
  redact: RegExp;
  /** set 方法默认关闭：读不改变页面，写要显式打开 */
  allowWrite: boolean;
}
const options: Options = {
  redact: /pass(word|wd)?|token|secret|authorization|cookie|api[-_]?key|credit[-_]?card|ssn/i,
  allowWrite: false,
};
export const configureDevtools = (next: Partial<Options>) => void Object.assign(options, next);

class Instance {
  children = new Set<Instance>();
  effects = new Set<any>();
  signals = new Set<any>();
  root: Element | undefined;
  sigCount = 0;
  readonly name: string;
  readonly source: any;
  readonly props: any;
  readonly parent: Instance | undefined;
  readonly owner: any;
  constructor(name: string, source: any, props: any, parent: Instance | undefined, owner: any) {
    this.name = name;
    this.source = source;
    this.props = props;
    this.parent = parent;
    this.owner = owner;
    parent?.children.add(this);
  }
}

// ---- 编号：只有输出过的对象才有 id，WeakRef 不挡回收 ----
let nextId = 0;
const ids = new WeakMap<object, string>();
const byId = new Map<string, WeakRef<object>>();
function idOf(target: object, prefix: string): string {
  let id = ids.get(target);
  if (!id) {
    id = `${prefix}${++nextId}`;
    ids.set(target, id);
    byId.set(id, new WeakRef(target));
  }
  return id;
}
const lookup = (id: string): any => byId.get(id)?.deref();

// ---- 运行时记录 ----
const apps = new Set<Instance>();
const nodeInfo = new WeakMap<object, any>();
const elementInfo = new WeakMap<
  Element,
  { instance: Instance | undefined; source: any; props: any }
>();
const elementEffects = new WeakMap<Element, Set<any>>();
const ownedInstances = new WeakMap<object, Set<Instance>>();
const shells = new WeakMap<object, any>();
const classOrigins = new WeakMap<object, Instance | undefined>();
const sites = new Map<string, string | undefined>();
const reported = new WeakSet<object>();
const issueList: any[] = [];
const issueKeys = new Map<string, any>();
let current: Instance | undefined;
let running: any;
let pendingLabel: { kind: string; el?: Element; key?: string } | undefined;
let liveEffects = 0;

// ---- 录制 ----
let recording = false;
let seq = 0;
let batch = 0;
let dropped = 0;
let events: any[] = [];
let pendingWrites = new Map<object, any[]>();
const runStack: any[] = [];
/** 一次录制最多取这么多调用栈，一个要十几微秒 */
const MAX_STACKS = 2000;
let stackBudget = MAX_STACKS;
const push = (event: any) => {
  // 满了丢最早的一半：逐条 shift 在两万条上太慢
  if (events.length >= MAX_EVENTS) {
    events.splice(0, MAX_EVENTS / 2);
    dropped += MAX_EVENTS / 2;
  }
  events.push(event);
  return event;
};

// ---- 调用栈和值的摘要 ----
const INTERNAL =
  /packages\/core\/src\/|alien-signals|node_modules\/\.vite\/|node_modules\/hiltkit\/|virtual:hilt/;
/** 第一个不在框架里的调用帧。打包成一个文件的产物分不出来，返回 undefined */
function userSite(): string | undefined {
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
function siteFor(instance: Instance | undefined, tag: string): string | undefined {
  if (!instance) return undefined;
  const ordinal = instance.sigCount++;
  if (ordinal >= MAX_SITES_PER_COMPONENT) return undefined;
  const key = `${instance.name}:${tag}:${ordinal}`;
  if (!sites.has(key)) sites.set(key, userSite());
  return sites.get(key);
}
const sourceText = (source: any) =>
  source?.fileName
    ? `${String(source.fileName)
        .replace(/\\/g, '/')
        .replace(/^.*\/(src)\//, '$1/')}:${source.lineNumber}:${source.columnNumber}`
    : undefined;
const describeEl = (el: any): string | undefined => {
  if (!el?.localName) return undefined;
  const id = el.id ? `#${el.id}` : '';
  const classes =
    typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
      : '';
  return `<${el.localName}${id}${classes}>`;
};
const REDACTED = '[已隐藏]';
const clip = (text: string, max = 120) =>
  text.length > max ? `${text.slice(0, max)}…（共 ${text.length} 字）` : text;
/** 值的摘要：不触发追踪、不调用 getter 以外的代码，长度有上限 */
function preview(value: unknown, depth = 2): unknown {
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
const readNode = (node: any): unknown =>
  node.kind === COMPUTED ? node.value_ : 'currentValue' in node ? node.currentValue : node.value;
/** 字段名敏感，或者绑到了密码框上：值不输出 */
function sensitive(node: any): boolean {
  const info = nodeInfo.get(node);
  if (info?.field && options.redact.test(String(info.field))) return true;
  for (let link = node.subs; link; link = link.nextSub) {
    const sub = nodeInfo.get(link.sub);
    if (sub?.el && isRedactedTarget(sub.el, sub.key)) return true;
  }
  return false;
}
const nodeValue = (node: any) => (sensitive(node) ? REDACTED : preview(readNode(node)));

// ---- 依赖图 ----
function depsOf(node: any): any[] {
  const out: any[] = [];
  for (let link = node.deps; link; link = link.nextDep) if (link.dep.kind) out.push(link.dep);
  return out;
}
function subsOf(node: any): any[] {
  const out: any[] = [];
  for (let link = node.subs; link; link = link.nextSub) out.push(link.sub);
  return out;
}
const signalId = (node: any) => idOf(node, node.kind === COMPUTED ? 'd' : 's');
const effectId = (node: any) => idOf(node, 'e');
function signalBrief(node: any) {
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
const isRedactedTarget = (el: any, key?: string) =>
  (key !== undefined && options.redact.test(key)) || (key === 'value' && el?.type === 'password');
/** effect 落到页面上的内容，用来判断这次是不是白跑 */
function targetValue(info: any): unknown {
  const { el, key, kind } = info;
  if (!el) return undefined;
  if (isRedactedTarget(el, key)) return REDACTED;
  if (kind === 'list') return `${el.childNodes.length} 个子节点`;
  if (kind === 'region') return clip(el.textContent ?? '', 200);
  if (kind === 'model') return key === 'checked' ? el.checked : el.value;
  return el.getAttribute?.(key === 'className' ? 'class' : key) ?? 'null';
}
const effectTarget = (info: any) =>
  info.el ? (info.key ? `${describeEl(info.el)} ${info.key}` : describeEl(info.el)) : undefined;
function effectBrief(node: any) {
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
/** 这次重跑的原因：沿 derived 往上，找到本轮写过的信号 */
function causesOf(node: any, seen = new Set<any>()): any[] {
  const causes: any[] = [];
  for (const dep of depsOf(node)) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    const writes = pendingWrites.get(dep);
    if (writes) causes.push(...writes);
    if (dep.kind === COMPUTED) causes.push(...causesOf(dep, seen));
  }
  return causes;
}

// ---- 问题清单 ----
function issue(code: string, message: string, fix: string, detail: any = {}) {
  const key = `${code}|${message}|${detail.component ?? ''}|${detail.site ?? ''}`;
  const existing = issueKeys.get(key);
  if (existing) {
    existing.count++;
    return;
  }
  if (issueList.length >= MAX_ISSUES) return;
  const entry = { code, message, fix, count: 1, ...detail };
  issueKeys.set(key, entry);
  issueList.push(entry);
}
const instanceDetail = (instance: Instance | undefined) =>
  instance
    ? {
        component: instance.name,
        componentId: idOf(instance, 'c'),
        source: sourceText(instance.source),
      }
    : {};

// ---- 组件和 effect 的归属 ----
function own(owner: any, instance: Instance) {
  if (!owner) return;
  let set = ownedInstances.get(owner);
  if (!set) ownedInstances.set(owner, (set = new Set()));
  set.add(instance);
}
function dropOwned(owner: any) {
  const set = ownedInstances.get(owner);
  if (!set) return;
  ownedInstances.delete(owner);
  for (const instance of set) {
    instance.parent?.children.delete(instance);
    apps.delete(instance);
  }
}
const forgetEffect = (node: any) => {
  const info = nodeInfo.get(node);
  if (!info || info.gone) return;
  info.gone = true;
  info.instance?.effects.delete(node);
  if (info.el) elementEffects.get(info.el)?.delete(node);
  if (info.kind !== 'scope') liveEffects--;
};

setDevHooks({
  label(kind: string, el?: Element, key?: string) {
    pendingLabel = { kind, el, key };
  },
  created(node: any, _parent: any) {
    const label = pendingLabel;
    pendingLabel = undefined;
    const kind = !node.fn
      ? 'scope'
      : (label?.kind ?? (node.flags & RENDER_FLAG ? 'binding' : 'effect'));
    const info: any = {
      kind,
      instance: current,
      el: label?.el,
      key: label?.key,
      runs: 0,
      ms: 0,
      ran: false,
    };
    if (kind === 'effect') info.site = siteFor(current, 'effect');
    nodeInfo.set(node, info);
    if (kind === 'scope') return;
    liveEffects++;
    current?.effects.add(node);
    if (info.el) {
      let set = elementEffects.get(info.el);
      if (!set) elementEffects.set(info.el, (set = new Set()));
      set.add(node);
    }
  },
  /** 第一次跑完没读到数据的绑定不会再跑。它下面的组件归到上一层，否则上一层重跑时清不掉 */
  released(node: any, parent: any) {
    forgetEffect(node);
    const set = ownedInstances.get(node);
    if (!set) return;
    ownedInstances.delete(node);
    for (const instance of set) own(parent, instance);
  },
  runStart(node: any) {
    const info = nodeInfo.get(node);
    if (info?.ran) dropOwned(node);
    runStack.push(current, running, undefined);
    if (!info) return;
    current = info.instance;
    running = node;
    info.runs++;
    if (!recording) {
      info.ran = true;
      return;
    }
    const event = push({
      type: 'run',
      seq: ++seq,
      batch,
      effect: node,
      first: !info.ran,
      causes: causesOf(node),
      before: targetValue(info),
      start: performance.now(),
      trigger: triggerOf(),
    });
    runStack[runStack.length - 1] = event;
    info.ran = true;
    info.lastRun = event;
  },
  runEnd(node: any) {
    const event = runStack.pop();
    running = runStack.pop();
    current = runStack.pop();
    if (!event) return;
    const info = nodeInfo.get(node);
    event.ms = performance.now() - event.start;
    event.after = targetValue(info);
    event.changed = event.before !== event.after;
    info.ms += event.ms;
  },
  disposed(node: any) {
    forgetEffect(node);
    dropOwned(node);
  },
  write(node: any, next: unknown) {
    // 没人订阅的写入不会引起任何更新，也就不用记。循环里写一百万次不能把页面拖死
    if (!recording || node.subs === undefined) return;
    const redacted = sensitive(node);
    const event = push({
      type: 'write',
      seq: ++seq,
      batch,
      signal: node,
      from: redacted ? REDACTED : preview(node.currentValue, 1),
      to: redacted ? REDACTED : preview(next, 1),
      by: running,
      site: stackBudget-- > 0 ? userSite() : undefined,
      trigger: triggerOf(),
    });
    const list = pendingWrites.get(node);
    if (list) list.push(event);
    else pendingWrites.set(node, [event]);
  },
  flushed() {
    if (!recording) return;
    pendingWrites = new Map();
    batch++;
  },
  error(error: any, from: any) {
    if (error && typeof error === 'object') {
      if (reported.has(error)) return;
      reported.add(error);
    }
    const info = from ? nodeInfo.get(from) : undefined;
    issue(
      'HILT003',
      `effect 抛错：${clip(String(error?.message ?? error), 200)}`,
      '看 site 指向的代码；要让局部出错不影响整页，用 Boundary 包住',
      {
        ...instanceDetail(info?.instance),
        effect: from ? effectId(from) : undefined,
        target: info ? effectTarget(info) : undefined,
        stack: clip(String(error?.stack ?? ''), 600),
      },
    );
  },
  setupRead() {
    issue(
      'HILT001',
      '组件体或行函数里直接读了响应式数据，只取一次，之后不会更新',
      '想跟着变就传函数：{() => count()}；确实只要当前值就用 count.peek()',
      { ...instanceDetail(current), site: userSite() },
    );
  },
  mismatch(expected: string, actual: any) {
    const text =
      actual?.nodeType === 3
        ? JSON.stringify(clip(actual.data, 80))
        : (describeEl(actual) ?? `节点类型 ${actual?.nodeType ?? '无'}`);
    issue(
      'HILT002',
      `水合不一致：客户端要 ${clip(JSON.stringify(expected), 80)}，服务端 HTML 是 ${text}`,
      '服务端和客户端的首次输出要一样：别在渲染时读 Date.now()、随机数、window；只在客户端的内容放进 effect',
      instanceDetail(current),
    );
  },
  field(node: any, key: unknown) {
    nodeInfo.set(node, { field: String(key), name: `.${String(key)}`, instance: current });
    if (current) current.signals.add(node);
  },
  shell(shell: any, cell: any) {
    if (cell.kind !== SIGNAL) return;
    shells.set(cell, shell);
    nodeInfo.set(cell, { name: 'sig', instance: current, site: siteFor(current, 'sig') });
    current?.signals.add(cell);
  },
  named(cell: any, name: string) {
    nodeInfo.set(cell, { name, instance: current, site: siteFor(current, name) });
    current?.signals.add(cell);
  },
  merged(out: any) {
    for (const key of ['class', 'style', 'sx'])
      if (Array.isArray(out[key])) classOrigins.set(out[key], current);
  },
  element(el: Element, node: any) {
    elementInfo.set(el, { instance: current, source: node.source, props: node.props });
    if (current && !current.root) current.root = el;
  },
  component(node: any, mount: () => void) {
    if (node.type.name === 'Fragment') return mount();
    const instance = new Instance(
      node.type.name || 'Anonymous',
      node.source,
      node.props,
      current,
      getOwner(),
    );
    own(instance.owner, instance);
    const previous = current;
    current = instance;
    try {
      mount();
    } catch (error) {
      (this as any).error(error, undefined);
      throw error;
    } finally {
      current = previous;
    }
  },
  app<T>(host: Element, render: () => T): T {
    const instance = new Instance('(app)', undefined, undefined, undefined, getOwner());
    instance.root = host;
    apps.add(instance);
    own(instance.owner, instance);
    const previous = current;
    current = instance;
    try {
      return render();
    } finally {
      current = previous;
    }
  },
});
/** 正在处理的浏览器事件：把写入连到“用户点了什么” */
function triggerOf(): string | undefined {
  const event = (globalThis as any).event;
  if (!event?.type) return undefined;
  return `${event.type} ${describeEl(event.target) ?? ''}`.trim();
}

// ---- 对外方法 ----
class ToolError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}
function resolveElement(selector: string): Element {
  let el: Element | null;
  try {
    el = document.querySelector(selector);
  } catch {
    throw new ToolError('BAD_SELECTOR', `选择器写错了：${selector}`);
  }
  if (!el) throw new ToolError('NOT_FOUND', `页面上没有 ${selector}`);
  return el;
}
/** 目标可以是 id（c12、e5、s9、d3）或 CSS 选择器 */
function resolve(target: unknown): any {
  if (typeof target !== 'string' || !target)
    throw new ToolError('BAD_PARAMS', '要传 id（c12、e5、s9）或 CSS 选择器');
  if (/^[cesd]\d+$/.test(target)) {
    const found = lookup(target);
    if (!found) throw new ToolError('NOT_FOUND', `${target} 不存在或已销毁`, '用 tree 重新取 id');
    return found;
  }
  return resolveElement(target);
}
const instanceOfElement = (el: Element) => {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const info = elementInfo.get(node);
    if (info?.instance) return info.instance;
  }
  return undefined;
};
const chainOf = (instance: Instance | undefined) => {
  const chain: any[] = [];
  for (let node = instance; node; node = node.parent)
    if (node.name !== '(app)')
      chain.push({ id: idOf(node, 'c'), name: node.name, source: sourceText(node.source) });
  return chain;
};
function propsPreview(props: any) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props ?? {})) {
    if (key === 'children')
      out.children = Array.isArray(props.children)
        ? `${props.children.length} 项`
        : typeof props.children;
    else out[key] = options.redact.test(key) ? REDACTED : preview(props[key], 1);
  }
  return out;
}
function treeNode(instance: Instance, depth: number, limit: number): any {
  const children = [...instance.children];
  const node: any = {
    id: idOf(instance, 'c'),
    name: instance.name,
    source: sourceText(instance.source),
    root: describeEl(instance.root),
    effects: instance.effects.size,
  };
  if (!children.length) return node;
  if (depth <= 0) {
    node.childCount = children.length;
    return node;
  }
  node.children = children.slice(0, limit).map((child) => treeNode(child, depth - 1, limit));
  if (children.length > limit) {
    const rest: Record<string, number> = {};
    for (const child of children.slice(limit)) rest[child.name] = (rest[child.name] ?? 0) + 1;
    node.more = { count: children.length - limit, byName: rest };
  }
  return node;
}
function walk(visit: (instance: Instance) => void) {
  const stack = [...apps];
  while (stack.length) {
    const instance = stack.pop()!;
    visit(instance);
    for (const child of instance.children) stack.push(child);
  }
}
/** 一次写入的来龙去脉：谁写的、在哪写的、是被哪次运行带出来的 */
function explainWrite(event: any, depth = 0): any {
  const out: any = {
    write: signalBrief(event.signal),
    from: event.from,
    to: event.to,
    site: event.site,
    trigger: event.trigger,
  };
  if (event.by && depth < 5) {
    const info = nodeInfo.get(event.by);
    out.by = effectBrief(event.by);
    if (info?.lastRun?.causes?.length)
      out.because = info.lastRun.causes
        .slice(0, 3)
        .map((cause: any) => explainWrite(cause, depth + 1));
  }
  return out;
}
const runBrief = (event: any) => ({
  seq: event.seq,
  batch: event.batch,
  effect: effectBrief(event.effect),
  first: event.first,
  changed: event.changed,
  before: event.before,
  after: event.after,
  ms: event.ms === undefined ? undefined : +event.ms.toFixed(2),
});
const needRecording = () =>
  new ToolError('NOT_RECORDING', '没有录制数据', '先 record start，操作页面，再查');
/** 同类 effect 合起来算：一万行里同一个绑定不要占一万条 */
function aggregate(runs: any[]) {
  const groups = new Map<string, any>();
  for (const event of runs) {
    const info = nodeInfo.get(event.effect) ?? {};
    const key = `${info.instance?.name ?? '(无组件)'} ${info.kind} ${info.key ?? ''}`.trim();
    const group = groups.get(key) ?? {
      key,
      runs: 0,
      ms: 0,
      wasted: 0,
      sample: effectId(event.effect),
    };
    group.runs++;
    group.ms += event.ms ?? 0;
    if (
      !event.first &&
      event.changed === false &&
      info.kind !== 'effect' &&
      info.kind !== 'scope' &&
      info.el
    )
      group.wasted++;
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.ms - a.ms)
    .map((group) => ({ ...group, ms: +group.ms.toFixed(2) }));
}
const methods: Record<string, (params: any) => unknown> = {
  /** 总览：第一个该调的方法 */
  summary() {
    const byName: Record<string, number> = {};
    let components = 0;
    walk((instance) => {
      if (instance.name === '(app)') return;
      components++;
      byName[instance.name] = (byName[instance.name] ?? 0) + 1;
    });
    const top = Object.entries(byName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    const issueCounts: Record<string, number> = {};
    for (const entry of issueList)
      issueCounts[entry.code] = (issueCounts[entry.code] ?? 0) + entry.count;
    return {
      protocol: PROTOCOL_VERSION,
      url: typeof location === 'undefined' ? undefined : location.pathname,
      apps: [...apps].map((app) => ({ id: idOf(app, 'c'), host: describeEl(app.root) })),
      components,
      effects: liveEffects,
      topComponents: Object.fromEntries(top),
      issues: issueCounts,
      recording,
    };
  },
  /** 组件树。depth 控制层数，limit 控制每层个数，name 按名字搜（返回平铺结果） */
  tree({ id, depth = 3, limit = 20, name }: any = {}) {
    if (name) {
      const matches: any[] = [];
      let total = 0;
      walk((instance) => {
        if (!instance.name.includes(name)) return;
        total++;
        if (matches.length < limit)
          matches.push({
            id: idOf(instance, 'c'),
            name: instance.name,
            source: sourceText(instance.source),
            root: describeEl(instance.root),
            path: chainOf(instance)
              .map((item) => item.name)
              .reverse()
              .join(' > '),
          });
      });
      return { total, matches };
    }
    if (id) {
      const found = resolve(id);
      if (!(found instanceof Instance)) throw new ToolError('BAD_PARAMS', `${id} 不是组件`);
      return treeNode(found, depth, limit);
    }
    return [...apps].map((app) => treeNode(app, depth, limit));
  },
  /** 一个组件、effect、信号或元素的详情 */
  inspect({ target }: any) {
    const found = resolve(target);
    if (found instanceof Instance) {
      return {
        id: idOf(found, 'c'),
        name: found.name,
        source: sourceText(found.source),
        root: describeEl(found.root),
        props: propsPreview(found.props),
        path: chainOf(found)
          .map((item) => item.name)
          .reverse()
          .join(' > '),
        children: found.children.size,
        signals: [...found.signals].slice(0, 20).map(signalBrief),
        effects: [...found.effects].slice(0, 20).map(effectBrief),
      };
    }
    if (typeof Element !== 'undefined' && found instanceof Element) {
      const info = elementInfo.get(found);
      return {
        element: describeEl(found),
        source: sourceText(info?.source),
        component: chainOf(instanceOfElement(found))[0],
        effects: [...(elementEffects.get(found) ?? [])].slice(0, 20).map(effectBrief),
      };
    }
    if (found.kind === 0) {
      const info = nodeInfo.get(found) ?? {};
      return {
        ...effectBrief(found),
        value: targetValue(info),
        deps: depsOf(found).slice(0, 30).map(signalBrief),
        alive: !!found.flags,
        lastRun: info.lastRun ? runBrief(info.lastRun) : undefined,
      };
    }
    const subs = subsOf(found);
    return {
      ...signalBrief(found),
      subscribers: subs.length,
      effects: subs
        .filter((sub) => sub.kind === 0)
        .slice(0, 20)
        .map(effectBrief),
      derived: subs
        .filter((sub) => sub.kind === COMPUTED)
        .slice(0, 20)
        .map(signalBrief),
      deps: found.kind === COMPUTED ? depsOf(found).slice(0, 20).map(signalBrief) : undefined,
    };
  },
  /** DOM 来自哪：元素的 JSX 位置和组件链 */
  locate({ selector }: any) {
    const el = resolveElement(selector);
    const info = elementInfo.get(el);
    if (!info && !instanceOfElement(el))
      throw new ToolError('NOT_FOUND', `${selector} 不是 hilt 渲染的`);
    return {
      element: describeEl(el),
      source: sourceText(info?.source),
      inherited: info ? undefined : '这个元素不是 hilt 直接建的，下面是最近的上层',
      components: chainOf(instanceOfElement(el)),
      effects: [...(elementEffects.get(el) ?? [])].slice(0, 10).map(effectBrief),
    };
  },
  /** 问题清单：编号、位置、修法。同类问题合并计数 */
  issues({ code, limit = 30 }: any = {}) {
    const list = code ? issueList.filter((entry) => entry.code === code) : issueList;
    return { total: list.length, issues: list.slice(0, limit) };
  },
  /** 录制：start 清空开始，stop 结束并返回摘要，之后可以查 why、perf、timeline */
  record({ action }: any) {
    if (action === 'start') {
      recording = true;
      events = [];
      dropped = 0;
      stackBudget = MAX_STACKS;
      pendingWrites = new Map();
      return { recording };
    }
    if (action !== 'stop') throw new ToolError('BAD_PARAMS', 'action 要写 start 或 stop');
    flushSync();
    recording = false;
    const runs = events.filter((event) => event.type === 'run');
    const groups = aggregate(runs);
    return {
      recording,
      writes: events.length - runs.length,
      runs: runs.length,
      batches: new Set(events.map((event) => event.batch)).size,
      wasted: groups.reduce((sum, group) => sum + group.wasted, 0),
      dropped,
      top: groups.slice(0, 10),
    };
  },
  /** 录到的事件，按时间排。一个批次里的写入和它带出的运行连在一起看 */
  timeline({ limit = 50, offset = 0 }: any = {}) {
    if (!events.length) throw needRecording();
    return {
      total: events.length,
      events: events.slice(offset, offset + limit).map((event) =>
        event.type === 'write'
          ? {
              seq: event.seq,
              batch: event.batch,
              write: signalBrief(event.signal),
              from: event.from,
              to: event.to,
              site: event.site,
              trigger: event.trigger,
              by: event.by ? effectId(event.by) : undefined,
            }
          : { ...runBrief(event), causes: event.causes.map((cause: any) => cause.seq) },
      ),
    };
  },
  /** 为什么更新：目标最近几次运行，每次是谁写了什么引起的 */
  why({ target, limit = 3 }: any) {
    if (!events.length) throw needRecording();
    const found = resolve(target);
    if (found.kind === SIGNAL || found.kind === COMPUTED) {
      const writes = events
        .filter((event) => event.type === 'write' && event.signal === found)
        .slice(-limit);
      const seqs = new Set(writes.map((event) => event.seq));
      const triggered = events.filter(
        (event) => event.type === 'run' && event.causes.some((cause: any) => seqs.has(cause.seq)),
      );
      return {
        signal: signalBrief(found),
        writes: writes.map((event) => explainWrite(event)),
        triggered: aggregate(triggered).slice(0, 10),
      };
    }
    let effects: Set<any>;
    if (found instanceof Instance) effects = found.effects;
    else if (found.kind === 0) effects = new Set([found]);
    else {
      effects = new Set(elementEffects.get(found));
      // 文字绑定挂在父元素上：选中的元素没有绑定时往里看一层
      if (!effects.size)
        for (const child of found.children ?? [])
          for (const node of elementEffects.get(child) ?? []) effects.add(node);
    }
    const runs = events
      .filter((event) => event.type === 'run' && effects.has(event.effect) && !event.first)
      .slice(-limit);
    if (!runs.length)
      return {
        ran: false,
        effects: [...effects].slice(0, 10).map(effectBrief),
        hint: effects.size
          ? '录制期间这些绑定没有重跑：依赖没变，或者写法只取了一次（看 issues 里的 HILT001）'
          : '这里没有响应式绑定，值是创建时写死的',
      };
    return {
      ran: true,
      runs: runs.map((event) => ({
        ...runBrief(event),
        trigger: event.trigger,
        because: event.causes.slice(0, 5).map((cause: any) => explainWrite(cause)),
      })),
    };
  },
  /** 录制期间谁跑得多、谁慢、谁白跑（跑了但页面没变） */
  perf({ limit = 15 }: any = {}) {
    if (!events.length) throw needRecording();
    const runs = events.filter((event) => event.type === 'run');
    const groups = aggregate(runs);
    return {
      runs: runs.length,
      totalMs: +runs.reduce((sum, event) => sum + (event.ms ?? 0), 0).toFixed(2),
      groups: groups.slice(0, limit),
    };
  },
  /** 元素上的属性从哪来：最终值、原始写法、class/style 的各层 */
  attrs({ selector }: any) {
    const el = resolveElement(selector);
    const info = elementInfo.get(el);
    if (!info) throw new ToolError('NOT_FOUND', `${selector} 不是 hilt 直接建的元素`);
    const layersOf = (value: any): any[] => {
      if (Array.isArray(value)) {
        const from = classOrigins.get(value)?.name;
        return value.flatMap((item) =>
          layersOf(item).map((layer) => ({ ...layer, mergedIn: layer.mergedIn ?? from })),
        );
      }
      return [
        {
          value:
            typeof value === 'function'
              ? `${String(preview(value))} → ${JSON.stringify(preview(value()))}`
              : preview(value, 1),
        },
      ];
    };
    const props: Record<string, unknown> = {};
    for (const key of Object.keys(info.props ?? {})) {
      if (key === 'children' || key === 'key') continue;
      const value = info.props[key];
      if (options.redact.test(key) || isRedactedTarget(el, key))
        props[key] = { kind: 'hidden', value: REDACTED };
      else if (/^on[A-Z:]/.test(key)) props[key] = { kind: 'event', value: preview(value) };
      else if (key === 'class' || key === 'style' || key === 'sx')
        props[key] = {
          kind: typeof value === 'string' ? 'static' : 'layers',
          layers: layersOf(value),
        };
      else if (typeof value === 'function')
        props[key] = { kind: value.$ ? 'sig' : 'live', value: preview(value()) };
      else props[key] = { kind: 'static', value: preview(value) };
    }
    const attributes: Record<string, string> = {};
    for (const attribute of [...el.attributes])
      attributes[attribute.name] = options.redact.test(attribute.name)
        ? REDACTED
        : clip(attribute.value);
    return { element: describeEl(el), source: sourceText(info.source), attributes, props };
  },
  /** 改信号的值（默认关闭）。configureDevtools({ allowWrite: true }) 打开后才能用 */
  set({ target, value }: any) {
    if (!options.allowWrite)
      throw new ToolError(
        'WRITE_DISABLED',
        '写入默认关闭',
        '在页面里调用 configureDevtools({ allowWrite: true }) 打开',
      );
    const found = resolve(target);
    if (found.kind !== SIGNAL) throw new ToolError('BAD_PARAMS', `${target} 不是可写的信号`);
    const shell = shells.get(found);
    if (shell) shell.set(value);
    else found.value = value;
    flushSync();
    return signalBrief(found);
  },
};

/** 唯一入口。结果都可以 JSON 化；出错不抛，返回错误码和下一步该做什么 */
export function call(
  method: string,
  params?: unknown,
):
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; hint?: string } } {
  const handler = Object.hasOwn(methods, method) ? methods[method] : undefined;
  if (!handler)
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_METHOD',
        message: `没有方法 ${method}`,
        hint: `可用：${Object.keys(methods).join('、')}`,
      },
    };
  try {
    return { ok: true, result: handler(params ?? {}) };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: error.code ?? 'INTERNAL',
        message: String(error.message ?? error),
        hint: error.hint,
      },
    };
  }
}
(globalThis as any).__HILT_DEVTOOLS__ = {
  version: PROTOCOL_VERSION,
  call,
  methods: Object.keys(methods),
};

/** 接到开发服务器：hiltDevtools 插件生成的客户端模块调用 */
export function connectDevServer(hot: {
  send(event: string, data: unknown): void;
  on(event: string, handler: (data: any) => void): void;
}) {
  hot.on('hilt:call', ({ id, method, params }) =>
    hot.send('hilt:result', { id, ...call(method, params) }),
  );
  const hello = () =>
    hot.send('hilt:hello', {
      protocol: PROTOCOL_VERSION,
      url: location.href,
      title: document.title,
    });
  hot.on('vite:ws:connect', hello);
  hello();
}
