/**
 * 收集：内核和渲染层通过 devHooks 通知这里，这里记下组件树、节点信息、录制事件、问题。
 * 组件的生死跟着 owner（管销毁的内核节点）走：owner 重跑或销毁时，它下面的组件就没了。
 */
import { getOwner, setDevHooks } from '../reactivity/kernel';
import {
  clip,
  depsOf,
  describeEl,
  effectId,
  effectTarget,
  preview,
  REDACTED,
  sensitive,
  siteFor,
  sourceText,
  targetValue,
  userSite,
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
  MAX_ISSUES,
  nodeInfo,
  ownedInstances,
  pushEvent,
  recorder,
  shells,
  SIGNAL,
} from './store';

const RENDER_FLAG = 128;
const issueKeys = new Map<string, any>();
const reported = new WeakSet<object>();
const runStack: any[] = [];
let current: Instance | undefined;
let running: any;
let pendingLabel: { kind: string; el?: Element; key?: string } | undefined;

/** 这次重跑的原因：沿 derived 往上，找到本轮写过的信号 */
function causesOf(node: any, seen = new Set<any>()): any[] {
  const causes: any[] = [];
  for (const dep of depsOf(node)) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    const writes = recorder.pendingWrites.get(dep);
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
  if (info.kind !== 'scope') recorder.liveEffects--;
};

/** 接到内核和渲染层的钩子上。导入调试内核时调用一次 */
export const installCollector = (): void =>
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
      recorder.liveEffects++;
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
      if (!recorder.recording) {
        info.ran = true;
        return;
      }
      const event = pushEvent({
        type: 'run',
        seq: ++recorder.seq,
        batch: recorder.batch,
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
      if (!recorder.recording || node.subs === undefined) return;
      const redacted = sensitive(node);
      const event = pushEvent({
        type: 'write',
        seq: ++recorder.seq,
        batch: recorder.batch,
        signal: node,
        from: redacted ? REDACTED : preview(node.currentValue, 1),
        to: redacted ? REDACTED : preview(next, 1),
        by: running,
        site: recorder.stackBudget-- > 0 ? userSite() : undefined,
        trigger: triggerOf(),
      });
      const list = recorder.pendingWrites.get(node);
      if (list) list.push(event);
      else recorder.pendingWrites.set(node, [event]);
    },
    flushed() {
      if (!recorder.recording) return;
      recorder.pendingWrites = new Map();
      recorder.batch++;
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
