// 1000 行的样式更新基准（场景同 vue-tsx-pro 的 /bench/style-updates），行与状态都是 alien-signals。
import { effect, effectScope, endBatch, signal, startBatch } from 'alien-signals';
import { mount, mountReactive } from './element';
import * as css from './engine/runtime';
import { darkTheme, DARK_CSS, lightTheme } from './theme';

/** engine：bind / select 写法；engine-effect：整个 attrs 包进 effect；hand：手写类 + 元素变量 */
export type Mode = 'engine' | 'engine-effect' | 'hand';

export const SCENARIOS: readonly (readonly [name: string, times: number])[] = [
  ['widths', 20],
  ['oneWidth', 20],
  ['hot', 10],
  ['unrelated', 10],
  ['theme', 4],
];

const S = css.create({
  row: { display: 'flex', alignItems: 'center', gap: 8, height: 14, fontSize: 11 },
  hot: { color: '_dangerText' },
  track: { flexGrow: 1, height: 6, backgroundColor: '_fill', borderRadius: 3 },
  bar: (width: number) => ({ width, height: 6, backgroundColor: '_accent', borderRadius: 3 }),
});

/** 手写对照：固定的类，宽度走元素上的变量；颜色用同样的主题变量，比的只是样式层 */
const HAND_CSS =
  '.b-row{display:flex;align-items:center;gap:8px;height:14px;font-size:11px}' +
  '.b-hot{color:var(--b-colors-danger-text)}' +
  '.b-track{flex-grow:1;height:6px;background-color:var(--b-colors-fill);border-radius:3px}' +
  '.b-bar{width:var(--w);height:6px;background-color:var(--b-colors-accent);border-radius:3px}' +
  `.b-dark{${DARK_CSS}}`;

interface Item {
  id: number;
  width: { (): number; (value: number): void };
  hot: { (): boolean; (value: boolean): void };
}

const makeTemplate = (html: string) => {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild as HTMLElement;
};
const ENGINE_ROW = makeTemplate('<div><span></span><div><div></div></div></div>');
const HAND_ROW = makeTemplate(
  '<div class="b-row"><span></span><div class="b-track"><div class="b-bar"></div></div></div>',
);

/** 一个基准实例：挂载 rows 行，返回场景驱动与清理 */
export function createBench(mode: Mode, rows: number) {
  if (mode === 'hand' && !document.getElementById('hand-css')) {
    const style = document.createElement('style');
    style.id = 'hand-css';
    style.textContent = HAND_CSS;
    document.head.append(style);
  }
  const dark = signal(false);
  const unrelated = signal(0);
  const items: Item[] = Array.from({ length: rows }, (_, id) => ({
    id,
    width: signal((id * 7) % 200),
    hot: signal(id % 10 === 0),
  }));
  const root = document.createElement('div');
  document.body.append(root);

  const buildEngine = (item: Item) => {
    const row = ENGINE_ROW.cloneNode(true) as HTMLElement;
    const [label, track] = row.children as unknown as HTMLElement[];
    const bar = track!.firstElementChild as HTMLElement;
    mount(row, css.attrs(S.row, css.select(() => item.hot() && S.hot)));
    label!.textContent = String(item.id);
    mount(track!, css.attrs(S.track));
    mount(bar, css.attrs(css.bind(S.bar, () => [item.width()])));
    return row;
  };
  const buildEngineEffect = (item: Item) => {
    const row = ENGINE_ROW.cloneNode(true) as HTMLElement;
    const [label, track] = row.children as unknown as HTMLElement[];
    const bar = track!.firstElementChild as HTMLElement;
    mountReactive(row, () => css.attrs(S.row, item.hot() && S.hot));
    label!.textContent = String(item.id);
    mount(track!, css.attrs(S.track));
    mountReactive(bar, () => css.attrs(S.bar(item.width())));
    return row;
  };
  const buildHand = (item: Item) => {
    const row = HAND_ROW.cloneNode(true) as HTMLElement;
    const [label, track] = row.children as unknown as HTMLElement[];
    const bar = track!.firstElementChild as HTMLElement;
    label!.textContent = String(item.id);
    // 花括号：alien-signals 3 把 effect 的返回值当清理函数，toggle 返回布尔值会出错
    effect(() => {
      row.classList.toggle('b-hot', item.hot());
    });
    effect(() => bar.style.setProperty('--w', `${item.width()}px`));
    return row;
  };
  const build = { engine: buildEngine, 'engine-effect': buildEngineEffect, hand: buildHand }[mode];

  const mountStart = performance.now();
  const stop = effectScope(() => {
    if (mode === 'engine') mount(root, css.attrs(css.select(() => (dark() ? darkTheme : lightTheme))));
    else if (mode === 'engine-effect')
      mountReactive(root, () => css.attrs(dark() ? darkTheme : lightTheme));
    else
      effect(() => {
        root.classList.toggle('b-dark', dark());
      });
    const fragment = document.createDocumentFragment();
    for (const item of items) fragment.append(build(item));
    root.append(fragment);
  });
  void root.offsetHeight;
  const mountMs = performance.now() - mountStart;

  const scenarios: Record<string, () => void> = {
    widths: () => items.forEach((item) => item.width((item.width() + 1) % 240)),
    oneWidth: () => items[0]!.width((items[0]!.width() + 1) % 240),
    hot: () => items.forEach((item) => item.hot(!item.hot())),
    unrelated: () => unrelated(unrelated() + 1),
    theme: () => dark(!dark()),
  };
  /** 每次状态变化：一个批次里改状态（effect 同步写 DOM），再强制布局 */
  const step = (name: string) => {
    startBatch();
    scenarios[name]!();
    endBatch();
    void root.offsetHeight;
  };

  return {
    root,
    mountMs,
    items,
    dark,
    /** 计时：不挂观察器，只量改状态 + 强制布局 */
    time(name: string, times: number) {
      const start = performance.now();
      for (let i = 0; i < times; i++) step(name);
      return performance.now() - start;
    },
    /** 计数：另跑一遍（不计时），统计 DOM 改动（按属性名）与 CSSOM 改动 */
    count(name: string, times: number) {
      const mutations: Record<string, number> = {};
      const cssom: Record<string, number> = {};
      const tally = (table: Record<string, number>, key: string) => (table[key] = (table[key] ?? 0) + 1);
      const observer = new MutationObserver(() => {});
      observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
      const originals = (['insertRule', 'deleteRule'] as const).map((method) => {
        const original = CSSStyleSheet.prototype[method] as (...args: unknown[]) => unknown;
        CSSStyleSheet.prototype[method] = function (this: CSSStyleSheet, ...args: unknown[]) {
          tally(cssom, method);
          return original.apply(this, args);
        } as never;
        return [method, original] as const;
      });
      for (let i = 0; i < times; i++) {
        step(name);
        for (const record of observer.takeRecords()) tally(mutations, record.attributeName ?? record.type);
      }
      observer.disconnect();
      for (const [method, original] of originals)
        CSSStyleSheet.prototype[method] = original as never;
      const per = (table: Record<string, number>) =>
        Object.fromEntries(Object.entries(table).map(([key, n]) => [key, n / times]));
      return { mutations: per(mutations), cssom: per(cssom) };
    },
    /** 卸载：停掉所有 effect，返回耗时 */
    dispose() {
      const start = performance.now();
      stop();
      const ms = performance.now() - start;
      root.remove();
      return ms;
    },
    /** 所有元素的计算样式快照（三种写法的结果必须一致） */
    snapshot() {
      return [...root.querySelectorAll('*')].map((element) => {
        const style = getComputedStyle(element);
        return `${style.color}|${style.backgroundColor}|${style.width}|${style.height}`;
      });
    },
    /** 一个场景的一次状态变化（断言用） */
    step,
  };
}
