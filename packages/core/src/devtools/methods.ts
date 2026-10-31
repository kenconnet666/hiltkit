/**
 * 对外的方法表：summary、tree、inspect、locate、issues、record、why、timeline、perf、attrs、set。
 * 每个方法的返回值都能直接 JSON 化；找不到目标时抛 ToolError，由入口转成错误码和下一步提示。
 */
import { flushSync } from '../reactivity/kernel';
import {
  clip,
  depsOf,
  describeEl,
  effectBrief,
  effectId,
  isRedactedTarget,
  preview,
  REDACTED,
  signalBrief,
  sourceText,
  subsOf,
  targetValue,
} from './describe';
import {
  apps,
  classOrigins,
  COMPUTED,
  elementEffects,
  elementInfo,
  idOf,
  Instance,
  issueList,
  lookup,
  MAX_STACKS,
  nodeInfo,
  options,
  PROTOCOL_VERSION,
  recorder,
  shells,
  SIGNAL,
} from './store';

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
export const methods: Record<string, (params: any) => unknown> = {
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
      effects: recorder.liveEffects,
      topComponents: Object.fromEntries(top),
      issues: issueCounts,
      recording: recorder.recording,
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
      throw new ToolError('NOT_FOUND', `${selector} 不是 hiltkit 渲染的`);
    return {
      element: describeEl(el),
      source: sourceText(info?.source),
      inherited: info ? undefined : '这个元素不是 hiltkit 直接建的，下面是最近的上层',
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
      recorder.recording = true;
      recorder.events = [];
      recorder.dropped = 0;
      recorder.stackBudget = MAX_STACKS;
      recorder.pendingWrites = new Map();
      return { recording: recorder.recording };
    }
    if (action !== 'stop') throw new ToolError('BAD_PARAMS', 'action 要写 start 或 stop');
    flushSync();
    recorder.recording = false;
    const runs = recorder.events.filter((event) => event.type === 'run');
    const groups = aggregate(runs);
    return {
      recording: recorder.recording,
      writes: recorder.events.length - runs.length,
      runs: runs.length,
      batches: new Set(recorder.events.map((event) => event.batch)).size,
      wasted: groups.reduce((sum, group) => sum + group.wasted, 0),
      dropped: recorder.dropped,
      top: groups.slice(0, 10),
    };
  },
  /** 录到的事件，按时间排。一个批次里的写入和它带出的运行连在一起看 */
  timeline({ limit = 50, offset = 0 }: any = {}) {
    if (!recorder.events.length) throw needRecording();
    return {
      total: recorder.events.length,
      events: recorder.events.slice(offset, offset + limit).map((event) =>
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
    if (!recorder.events.length) throw needRecording();
    const found = resolve(target);
    if (found.kind === SIGNAL || found.kind === COMPUTED) {
      const writes = recorder.events
        .filter((event) => event.type === 'write' && event.signal === found)
        .slice(-limit);
      const seqs = new Set(writes.map((event) => event.seq));
      const triggered = recorder.events.filter(
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
    const runs = recorder.events
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
    if (!recorder.events.length) throw needRecording();
    const runs = recorder.events.filter((event) => event.type === 'run');
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
    if (!info) throw new ToolError('NOT_FOUND', `${selector} 不是 hiltkit 直接建的元素`);
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
