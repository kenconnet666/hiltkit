// 基准：1000 行样式更新（sx 写法对照）与 1000 个按钮（配方对照）。由 checks-bench.mjs 打成两个包：
// sx: 'split'（编译器拆静态/动态项）与 'whole'（整段当读取）。组件里写的 sx 一样，差别只在编译输出。
import { effect, flushSync, mount, stats as runtimeStats } from '@hilt/runtime';
import { create, createTheme, defineTokens, recipe, stats as cssStats } from '@hilt/css';

const t = defineTokens('b', {
  colors: { text: '#1f2328', fill: '#e5e7eb', accent: '#3e63dd', dangerText: '#c0392b' },
  space: { sm: '4px', md: '8px', lg: '16px' },
});
const lightTheme = createTheme(t, { colors: { text: '#1f2328', fill: '#e5e7eb', accent: '#3e63dd', dangerText: '#c0392b' } });
const darkTheme = createTheme(t, { colors: { text: '#e6edf3', fill: '#374151', accent: '#8da4ef', dangerText: '#ff6b6b' } });

const S = create({
  row: { display: 'flex', alignItems: 'center', gap: 8, height: 14, fontSize: 11, color: '_text' },
  hot: { color: '_dangerText' },
  rowAttr: { display: 'flex', alignItems: 'center', gap: 8, height: 14, fontSize: 11, color: { default: '_text', '[data-hot]': '_dangerText' } },
  track: { flexGrow: 1, height: 6, backgroundColor: '_fill', borderRadius: 3 },
  bar: (width: number) => ({ width, height: 6, backgroundColor: '_accent', borderRadius: 3 }),
});

interface Item {
  id: number;
  width: number;
  hot: boolean;
  size: string;
  variant: string;
}

/** sx 写法：行上一个静态项加一个条件项，进度条一个动态参数 */
const RowSx = _component(({ item }: { item: Item }) => (
  <div sx={[S.row, item.hot && S.hot]}>
    <span>{item.id}</span>
    <div sx={S.track}>
      <div sx={S.bar(item.width)} />
    </div>
  </div>
));

/** 条件跟着 DOM 属性走：data-hot + '[data-hot]' 条件，状态变化只改属性 */
const RowAttr = _component(({ item }: { item: Item }) => (
  <div data-hot={item.hot} sx={S.rowAttr}>
    <span>{item.id}</span>
    <div sx={S.track}>
      <div sx={S.bar(item.width)} />
    </div>
  </div>
));

/** 手写：固定的类，条件用 classList，宽度走元素上的变量 */
const RowHand = _component(({ item }: { item: Item }) => (
  <div class="b-row" ref={(el: HTMLElement | null) => el && effect(() => void el.classList.toggle('b-hot', item.hot))}>
    <span>{item.id}</span>
    <div class="b-track">
      <div class="b-bar" ref={(el: HTMLElement | null) => el && effect(() => el.style.setProperty('--w', `${item.width}px`))} />
    </div>
  </div>
));

const HAND_CSS =
  '.b-row{display:flex;align-items:center;gap:8px;height:14px;font-size:11px;color:var(--b-colors-text)}' +
  '.b-hot{color:var(--b-colors-danger-text)}' +
  '.b-track{flex-grow:1;height:6px;background-color:var(--b-colors-fill);border-radius:3px}' +
  '.b-bar{width:var(--w);height:6px;background-color:var(--b-colors-accent);border-radius:3px}';

/* ───────── 配方：1000 个按钮 ───────── */
const button = recipe({
  name: 'Button',
  parts: ['root', 'icon', 'label'],
  base: {
    root: { display: 'inline-flex', alignItems: 'center', gap: '_sm', color: { default: '_text', ':hover': '_accent' } },
    icon: { flexShrink: 0 },
    label: { fontWeight: 500 },
  },
  variants: {
    variant: {
      solid: { root: { backgroundColor: '_accent', color: '#fff' } },
      soft: { root: { backgroundColor: '_fill' } },
      ghost: { root: { backgroundColor: 'transparent' } },
    },
    size: {
      sm: { root: { fontSize: 12, height: 24 }, icon: { width: 12, height: 12 } },
      md: { root: { fontSize: 14, height: 32 }, icon: { width: 16, height: 16 } },
      lg: { root: { fontSize: 16, height: 40 }, icon: { width: 20, height: 20 } },
    },
  },
  compound: [{ when: { variant: 'solid', size: 'lg' }, root: { paddingInline: 24 } }],
  defaults: { variant: 'solid', size: 'md' },
});

/** 配方：s.root、s.icon 展开到元素上，label 部件只有基础样式 */
const ButtonRecipe = _component(({ item }: { item: Item }) => {
  const s = button({ variant: item.variant, size: item.size });
  return (
    <button {...s.root}>
      <i {...s.icon} />
      <span {...s.label}>{item.id}</span>
    </button>
  );
});

const B = create({
  root: { display: 'inline-flex', alignItems: 'center', gap: '_sm', color: { default: '_text', ':hover': '_accent' } },
  icon: { flexShrink: 0 },
  label: { fontWeight: 500 },
});
const variantStyles = create({
  solid: { backgroundColor: '_accent', color: '#fff' },
  soft: { backgroundColor: '_fill' },
  ghost: { backgroundColor: 'transparent' },
});
const sizeStyles = create({
  sm: { fontSize: 12, height: 24 },
  md: { fontSize: 14, height: 32 },
  lg: { fontSize: 16, height: 40 },
});
const iconSizeStyles = create({ sm: { width: 12, height: 12 }, md: { width: 16, height: 16 }, lg: { width: 20, height: 20 } });
const lgSolid = create({ pad: { paddingInline: 24 } });

/** 直接写 sx 数组（不用配方）：查表选档位，组合档位手写条件 */
const ButtonSx = _component(({ item }: { item: Item }) => (
  <button sx={[B.root, variantStyles[item.variant], sizeStyles[item.size], item.variant === 'solid' && item.size === 'lg' && lgSolid.pad]}>
    <i sx={[B.icon, iconSizeStyles[item.size]]} />
    <span sx={B.label}>{item.id}</span>
  </button>
));

/** 没有任何动态样式：静态 sx，作为挂载成本的下限 */
const ButtonStatic = _component(({ item }: { item: Item }) => (
  <button sx={[B.root, variantStyles.solid, sizeStyles.md]}>
    <i sx={[B.icon, iconSizeStyles.md]} />
    <span sx={B.label}>{item.id}</span>
  </button>
));

const ROWS = { sx: RowSx, attr: RowAttr, hand: RowHand };
const BUTTONS = { recipe: ButtonRecipe, sx: ButtonSx, static: ButtonStatic };

let dark = _state(false);
let unrelated = _state(0);
let items = _state<Item[]>([]);

const root = document.createElement('div');
document.body.append(root);

const App = _component(({ kind, mode }: { kind: 'rows' | 'buttons'; mode: string }) => {
  const Row = (kind === 'rows' ? ROWS : BUTTONS)[mode as 'sx'];
  return <div sx={[dark ? darkTheme : lightTheme]}>{items.map((item) => <Row item={item} />)}</div>;
});

let stop: (() => void) | undefined;
const SCENARIOS: Record<string, () => void> = {
  widths: () => items.forEach((item) => (item.width = (item.width + 1) % 240)),
  oneWidth: () => (items[0]!.width = (items[0]!.width + 1) % 240),
  hot: () => items.forEach((item) => (item.hot = !item.hot)),
  unrelated: () => (unrelated = unrelated + 1),
  theme: () => (dark = !dark),
  // 配方：每个按钮的档位各切一次
  size: () => items.forEach((item) => (item.size = item.size === 'lg' ? 'sm' : 'lg')),
  variant: () => items.forEach((item) => (item.variant = item.variant === 'soft' ? 'ghost' : 'soft')),
};

const step = (name: string) => {
  SCENARIOS[name]!();
  flushSync();
  void root.offsetHeight;
};

(window as any).api = {
  mount(kind: 'rows' | 'buttons', mode: string, count: number) {
    if (mode === 'hand' && !document.getElementById('hand-css')) {
      const style = document.createElement('style');
      style.id = 'hand-css';
      style.textContent = HAND_CSS;
      document.head.append(style);
    }
    items = Array.from({ length: count }, (_, id) => ({
      id,
      width: (id * 7) % 200,
      hot: id % 10 === 0,
      size: 'md',
      variant: 'solid',
    })) as never;
    const start = performance.now();
    stop = mount(() => <App kind={kind} mode={mode} />, root) as never;
    void root.offsetHeight;
    return performance.now() - start;
  },
  time(name: string, times: number) {
    const start = performance.now();
    for (let i = 0; i < times; i++) step(name);
    return performance.now() - start;
  },
  /** 计数：DOM 改动（按属性名）、CSSOM 改动、引擎求值次数 */
  count(name: string, times: number) {
    const engineStats = () => ({ ...cssStats, effectsCreated: runtimeStats.effects });
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
    const before = engineStats();
    for (let i = 0; i < times; i++) {
      step(name);
      for (const record of observer.takeRecords()) tally(mutations, record.attributeName ?? record.type);
    }
    const after = engineStats();
    observer.disconnect();
    for (const [method, original] of originals) CSSStyleSheet.prototype[method] = original as never;
    const per = (table: Record<string, number>) => Object.fromEntries(Object.entries(table).map(([key, n]) => [key, n / times]));
    const delta = Object.fromEntries(Object.keys(after).map((key) => [key, (after[key]! - before[key]!) / times]));
    return { mutations: per(mutations), cssom: per(cssom), engine: delta };
  },
  dispose() {
    const start = performance.now();
    stop?.();
    const ms = performance.now() - start;
    root.textContent = '';
    return ms;
  },
  snapshot: () =>
    [...root.querySelectorAll('*')].map((element) => {
      const style = getComputedStyle(element);
      return `${style.color}|${style.backgroundColor}|${style.width}|${style.height}|${style.fontSize}|${style.paddingLeft}`;
    }),
  step,
  elements: () => root.querySelectorAll('*').length,
  /** 到现在为止创建的 effect 数：运行时的 effect 加上引擎留下的 watch */
  effects: () => runtimeStats.effects + cssStats.watchers,
};
