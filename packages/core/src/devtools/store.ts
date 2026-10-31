/**
 * 调试内核的数据：组件树、节点信息、问题清单、录制状态。这里只存东西，不做判断。
 * 组件不占内核节点，所以组件树是调试内核自己维护的。
 */
export const PROTOCOL_VERSION = 1;
export const SIGNAL = 1;
export const COMPUTED = 2;
export const MAX_ISSUES = 200;
const MAX_EVENTS = 20000;
/** 一次录制最多取这么多调用栈，一个要十几微秒 */
export const MAX_STACKS = 2000;

interface Options {
  /** 这些键名的值不输出。AI 和面板读到的状态可能进日志，令牌、密码不能跟着出去 */
  redact: RegExp;
  /** set 方法默认关闭：读不改变页面，写要显式打开 */
  allowWrite: boolean;
}
export const options: Options = {
  redact: /pass(word|wd)?|token|secret|authorization|cookie|api[-_]?key|credit[-_]?card|ssn/i,
  allowWrite: false,
};
/** 改脱敏规则、打开写入 */
export const configureDevtools = (next: Partial<Options>): void => {
  Object.assign(options, next);
};

/** 组件树上的一个实例 */
export class Instance {
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
export function idOf(target: object, prefix: string): string {
  let id = ids.get(target);
  if (!id) {
    id = `${prefix}${++nextId}`;
    ids.set(target, id);
    byId.set(id, new WeakRef(target));
  }
  return id;
}
export const lookup = (id: string): any => byId.get(id)?.deref();

// ---- 运行时记录 ----
export const apps = new Set<Instance>();
export const nodeInfo = new WeakMap<object, any>();
export const elementInfo = new WeakMap<
  Element,
  { instance: Instance | undefined; source: any; props: any }
>();
export const elementEffects = new WeakMap<Element, Set<any>>();
export const ownedInstances = new WeakMap<object, Set<Instance>>();
export const shells = new WeakMap<object, any>();
export const classOrigins = new WeakMap<object, Instance | undefined>();
export const issueList: any[] = [];

/** 会变的计数和录制状态。放在一个对象里，别的模块才能写 */
export const recorder = {
  liveEffects: 0,
  recording: false,
  seq: 0,
  batch: 0,
  dropped: 0,
  events: [] as any[],
  /** 本轮写过的信号 -> 写入事件：effect 重跑时靠它找原因 */
  pendingWrites: new Map<object, any[]>(),
  stackBudget: MAX_STACKS,
};
export const pushEvent = (event: any): any => {
  // 满了丢最早的一半：逐条 shift 在两万条上太慢
  if (recorder.events.length >= MAX_EVENTS) {
    recorder.events.splice(0, MAX_EVENTS / 2);
    recorder.dropped += MAX_EVENTS / 2;
  }
  recorder.events.push(event);
  return event;
};
