/**
 * 一个元素上 class、style、sx 的写入口。
 *
 * 三个来源各管各的：使用方的 class、使用方的 style、样式引擎的类与变量。每次只增删“自己上次给过的和这次要给的”
 * 之间的差，元素上别人加的类（第三方库、过渡动画）、别人设的行内样式一个不碰；水合时只记状态、不写 DOM。
 * 引擎的 watch 也经这里写（setClass、setVar、removeVar），所以引擎不碰 DOM。
 */
import { hydrating } from '../hydration';
import { classString, config, styleFromValue, warn } from './rules';

const tokens = (text: string | undefined): string[] => (text ? (text.match(/\S+/g) ?? []) : []);
const IMPORTANT = /\s*!important\s*$/i;
const NO_VARS: Record<string, string> = Object.freeze({});

/** 元素上挂的写入状态。样式引擎的 watch 拿到的也是它 */
export class Host {
  el: any;
  own: string[] = [];
  engine: string[] = [];
  ownStyle: Map<string, string> | undefined = undefined;
  vars: Record<string, string> = NO_VARS;
  constructor(el: Element) {
    this.el = el;
  }
  swap(previous: string[], next: string[], other: string[]): string[] {
    if (hydrating) return next;
    const el = this.el;
    // 元素上还没有类（绝大多数第一次写）：整串写，比逐个 classList.add 快一个量级
    if (!previous.length && !other.length && next.length && !el.hasAttribute('class')) {
      el.setAttribute('class', next.join(' '));
      return next;
    }
    const removed = previous.filter((name) => !next.includes(name) && !other.includes(name));
    const added = next.filter((name) => !previous.includes(name));
    // 一换一（组合类换了）只改一次 class
    if (removed.length === 1 && added.length === 1) el.classList.replace(removed[0], added[0]);
    else {
      for (const name of removed) el.classList.remove(name);
      for (const name of added) el.classList.add(name);
    }
    return next;
  }
  /** 使用方写的 class */
  setOwn(text: string): void {
    this.own = this.swap(this.own, tokens(text), this.engine);
  }
  /** 引擎给的类 */
  setClass(text: string): void {
    this.engine = this.swap(this.engine, tokens(text), this.own);
  }
  writeProperty(name: string, value: string, clear: boolean): void {
    const style = this.el.style;
    // 新值不合法时 setProperty 不生效，旧值不能留着
    if (clear) style.removeProperty(name);
    if (IMPORTANT.test(value)) style.setProperty(name, value.replace(IMPORTANT, ''), 'important');
    else style.setProperty(name, value);
    if (config.dev && style.getPropertyValue(name) === '')
      warn(`style ${name}: ${value} 无效，浏览器忽略了它（数字不会补 px）`);
  }
  /** 只删自己写过的属性；用户写的 style 盖住引擎的同名变量，用户不写了露出变量 */
  setStyle(next: Map<string, string>): void {
    const previous = this.ownStyle;
    this.ownStyle = next;
    if (hydrating) return;
    let rewrite = false;
    if (previous) {
      for (const name of previous.keys()) {
        if (next.has(name)) continue;
        const kept = this.vars[name];
        if (kept !== undefined) this.el.style.setProperty(name, kept);
        else this.el.style.removeProperty(name);
        rewrite = true;
      }
    }
    // 简写和长写互相影响：一个变了，排在它后面的都要重写；删掉一个可能抹掉别的，全部重写
    for (const [name, value] of next) {
      if (!rewrite && previous?.get(name) !== value) rewrite = true;
      if (rewrite) this.writeProperty(name, value, previous !== undefined);
    }
  }
  setVar(name: string, value: string): void {
    if (this.vars === NO_VARS) this.vars = {};
    this.vars[name] = value;
    if (!hydrating && !this.ownStyle?.has(name)) this.el.style.setProperty(name, value);
  }
  removeVar(name: string): void {
    delete this.vars[name];
    if (!hydrating && !this.ownStyle?.has(name)) this.el.style.removeProperty(name);
  }
  /** 引擎给的整组变量：和现在的比，只写变了的 */
  setVars(next: Record<string, string>): void {
    const previous = this.vars;
    this.vars = next === NO_VARS ? NO_VARS : { ...next };
    if (hydrating) return;
    const own = this.ownStyle;
    for (const name in next)
      if (previous[name] !== next[name] && !own?.has(name))
        this.el.style.setProperty(name, next[name]);
    for (const name in previous)
      if (!(name in next) && !own?.has(name)) this.el.style.removeProperty(name);
  }
}
/** 元素的 Host，第一次用到才建，不用 class、style 的元素不多对象 */
export const hostOf = (el: any): Host => (el.$$host ??= new Host(el));

/** 单独一个 class={x}（不经过 spread） */
export const setClass = (el: Element, value: unknown): void =>
  hostOf(el).setOwn(classString(value));
/** 单独一个 style={x}（不经过 spread） */
export const setStyle = (el: Element, value: unknown): void =>
  hostOf(el).setStyle(styleFromValue(value));

/** 算一次 sx，把类和变量交给 host；引擎有响应式绑定时起 watch，换值前停掉上一个 */
export function applySx(
  host: Host,
  values: unknown[],
  stop?: () => void,
): (() => void) | undefined {
  stop?.();
  if (!values.some(Boolean)) {
    host.setClass('');
    host.setVars(NO_VARS);
    return undefined;
  }
  if (!config.sx) throw new Error('sx 需要样式引擎：先导入创建样式的模块（create、recipe…）');
  const composed = config.sx(...values);
  host.setClass(composed.class ?? '');
  host.setVars(composed.style ?? NO_VARS);
  return composed.watch?.(host);
}
/** 单独一个 sx={[...]}：静态项是数据，动态项是引擎的绑定。不经过 spread，不起 effect */
export const setSx = (el: Element, value: unknown): void => void applySx(hostOf(el), [value]);
