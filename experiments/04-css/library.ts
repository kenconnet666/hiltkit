// “适当运行时”量化：组件库规模（N 个样式组）首次渲染全部用到时的总耗时。
//   engine：运行时路径 create → attrs（展开声明 + 组合 + 哈希 + 插规则）
//   precomputed：构建期预先算好 类名 + 规则文本，运行时只查表 + insertRule
// 每个页面只跑一次（缓存是全局的，第二次就不是“首次”了），由 run.mjs 每轮开新页面。
import { SELF, declarations, merge, serialize } from './engine/declarations';
import { hash, insert } from './engine/sheet';
import * as css from './engine/runtime';
import type { Precomputed } from './precompute';
import { makeGroups } from './workload';

export interface LibraryRun {
  /** JS 总耗时：样式组 → 全部插进样式表 */
  ms: number;
  /** 把 N 个元素挂上页面并强制样式重算（两条路径相同，只看规则数量带来的重算成本） */
  recalcMs: number;
  rules: number;
  /** 引擎路径按阶段拆开（另一个页面单独跑，各阶段之和约等于 ms） */
  stages?: { expand: number; compose: number; insert: number };
}

/** 挂 N 个元素、强制样式重算 */
function attach(classes: string[]) {
  const start = performance.now();
  const host = document.createElement('div');
  for (const name of classes) {
    const element = document.createElement('div');
    element.className = name;
    host.append(element);
  }
  document.body.append(host);
  void getComputedStyle(host.lastElementChild!).color;
  void host.offsetHeight;
  return performance.now() - start;
}

const ruleCount = (sheet: CSSStyleSheet) => sheet.cssRules.length;

export function engineRun(count: number): LibraryRun {
  const inputs = makeGroups(count);
  const classes: string[] = new Array(count);
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const styles = css.create({ root: inputs[i]! });
    classes[i] = css.attrs(styles.root).class!;
  }
  const ms = performance.now() - start;
  const sheet = document.querySelector<HTMLStyleElement>('style[data-vue-tsx-pro]')!.sheet!;
  return { ms, recalcMs: attach(classes), rules: ruleCount(sheet) };
}

export function precomputedRun(table: Precomputed[]): LibraryRun {
  const style = document.createElement('style');
  document.head.prepend(style);
  const sheet = style.sheet!;
  const classes: string[] = new Array(table.length);
  const inserted = new Set<string>();
  const start = performance.now();
  for (let i = 0; i < table.length; i++) {
    const { name, rules } = table[i]!;
    classes[i] = name;
    if (inserted.has(name)) continue;
    inserted.add(name);
    for (const rule of rules) sheet.insertRule(rule, sheet.cssRules.length);
  }
  const ms = performance.now() - start;
  return { ms, recalcMs: attach(classes), rules: ruleCount(sheet) };
}

/** 引擎路径的阶段拆分：同样的三步（展开、组合哈希、插入），分别计时 */
export function engineStages(count: number): LibraryRun['stages'] {
  const inputs = makeGroups(count);
  let t = performance.now();
  const tables = inputs.map((input) => declarations(input));
  const expand = performance.now() - t;
  t = performance.now();
  const composed = tables.map((table) => {
    const rules = serialize(merge([table]));
    return { name: `x${hash(rules.join(''))}`, rules };
  });
  const compose = performance.now() - t;
  t = performance.now();
  for (const { name, rules } of composed)
    insert(
      name,
      rules.map((rule) => rule.replaceAll(SELF, name)),
    );
  return { expand, compose, insert: performance.now() - t };
}
