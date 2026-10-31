// 语义断言：在真实浏览器里跑（要 getComputedStyle、MutationObserver、CSSOM）。
// 每条返回 { name, ok, detail }；run.mjs 打印 ok / FAIL。
import { effectScope, signal } from 'alien-signals';
import { createBench, type Mode } from './bench';
import { mount, mountReactive } from './element';
import * as css from './engine/runtime';
import { darkTheme, lightTheme } from './theme';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];
function check(name: string, run: () => string | true) {
  try {
    const outcome = run();
    results.push({ name, ok: outcome === true, detail: outcome === true ? '' : outcome });
  } catch (error) {
    results.push({ name, ok: false, detail: `抛出异常：${(error as Error).stack ?? error}` });
  }
}
/** 断言工具：相等返回 true，不等返回说明 */
const same = (actual: unknown, expected: unknown): string | true =>
  JSON.stringify(actual) === JSON.stringify(expected)
    ? true
    : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`;

const attached: Element[] = [];
function element(attrs: css.Attrs = {}, tag = 'div'): HTMLElement {
  const el = document.createElement(tag);
  document.body.append(el);
  attached.push(el);
  return mount(el, attrs);
}
const computed = (el: Element, property: string) => getComputedStyle(el).getPropertyValue(property);
/** 引擎插过的、选择器里含这个类的规则原文 */
const rulesOf = (className: string) =>
  css
    .styleText()
    .split('\n')
    .filter((rule) => rule.includes(`.${className}`));

/** 统计一段操作里的 DOM 改动（按属性名）与 insertRule 次数 */
function observe(target: Node, run: () => void) {
  const observer = new MutationObserver(() => {});
  observer.observe(target, { subtree: true, attributes: true, childList: true, characterData: true });
  let inserts = 0;
  const original = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function (this: CSSStyleSheet, ...args: [string, number?]) {
    inserts++;
    return original.apply(this, args);
  };
  try {
    run();
  } finally {
    CSSStyleSheet.prototype.insertRule = original;
  }
  const records = observer.takeRecords();
  observer.disconnect();
  return {
    inserts,
    attributes: records.map((record) => record.attributeName ?? record.type),
    targets: records.map((record) => record.target),
  };
}

export function runChecks(): CheckResult[] {
  results.length = 0;

  /* ───────── 合并语义 ───────── */
  const merge1 = css.create({ a: { color: 'red', width: 10 }, b: { color: 'blue' } });
  check('合并：后者覆盖前者，没写的属性保留', () => {
    const el = element(css.attrs(merge1.a, merge1.b));
    return same([computed(el, 'color'), computed(el, 'width')], ['rgb(0, 0, 255)', '10px']);
  });
  check('合并：顺序反过来则前者赢', () => {
    const el = element(css.attrs(merge1.b, merge1.a));
    return same(computed(el, 'color'), 'rgb(255, 0, 0)');
  });
  check('合并：一个元素只有一个生成类', () => {
    const { class: name } = css.attrs(merge1.a, merge1.b);
    return same(name?.split(' ').length, 1);
  });
  check('合并：假值与嵌套数组被忽略，同样的组合返回同一个对象', () => {
    const a = css.attrs(false, null, undefined, [merge1.a, [merge1.b]]);
    const b = css.attrs(merge1.a, merge1.b);
    return a === b ? true : `class ${a.class} / ${b.class}，对象不同一`;
  });

  const cond = css.create({
    base: { color: { default: 'red', ':hover': 'blue' } },
    overDefault: { color: { default: 'green' } },
    overPlain: { color: 'green' },
    overNull: { color: { default: 'green', ':hover': null } },
    drop: { color: null },
    two: { color: 'red', width: 10 },
  });
  check('条件逐项合并：只写 default，原来的 :hover 保留', () => {
    const { class: name } = css.attrs(cond.base, cond.overDefault);
    const rules = rulesOf(name!);
    return same(rules.map((r) => r.replace(`.${name}`, '.C')), ['.C{color:green}', '.C:hover{color:blue}']);
  });
  check('条件逐项合并：条件里的 null 表示不改（不清掉前面的 :hover）', () => {
    const { class: name } = css.attrs(cond.base, cond.overNull);
    return same(rulesOf(name!).map((r) => r.replace(`.${name}`, '.C')), [
      '.C{color:green}',
      '.C:hover{color:blue}',
    ]);
  });
  check('普通值整体替换，连前面的条件一起去掉', () => {
    const { class: name } = css.attrs(cond.base, cond.overPlain);
    return same(rulesOf(name!).map((r) => r.replace(`.${name}`, '.C')), ['.C{color:green}']);
  });
  check('顶层 null 去掉该属性，其他属性保留', () => {
    const { class: name } = css.attrs(cond.two, cond.drop);
    return same(rulesOf(name!).map((r) => r.replace(`.${name}`, '.C')), ['.C{width:10px}']);
  });

  /* ───────── 展开：token、别名、媒体查询、惰性、去重 ───────── */
  check('token 短写换成变量；数字补 px', () => {
    const s = css.create({ t: { color: '_accent', padding: '_md', width: 7 } });
    const { class: name } = css.attrs(s.t);
    return same(rulesOf(name!).map((r) => r.replace(`.${name}`, '.C')), [
      '.C{padding:var(--b-space-md);color:var(--b-colors-accent);width:7px}',
    ]);
  });
  check('条件别名 _selected 跟着 aria 属性走：改属性变色，类名不变', () => {
    const s = css.create({ t: { color: { default: 'red', _selected: 'blue' } } });
    const el = element(css.attrs(s.t));
    const before = el.className;
    const off = computed(el, 'color');
    el.setAttribute('aria-selected', 'true');
    const on = computed(el, 'color');
    return same([off, on, el.className === before], ['rgb(255, 0, 0)', 'rgb(0, 0, 255)', true]);
  });
  check('@media 条件生效（视口 1200 宽）', () => {
    const s = css.create({ t: { width: { default: 10, '@media (min-width: 600px)': 20 } } });
    const el = element(css.attrs(s.t));
    return same(computed(el, 'width'), '20px');
  });
  check('create 不插规则，attrs 第一次用到才插；第二次不再插', () => {
    const s = css.create({ t: { margin: 1234 } });
    const before = css.styleText().includes('margin:1234px');
    const first = observe(document.body, () => css.attrs(s.t));
    const second = observe(document.body, () => css.attrs(css.create({ t: { margin: 1234 } }).t));
    return same([before, first.inserts, second.inserts], [false, 1, 0]);
  });

  /* ───────── 动态值：只改元素变量 ───────── */
  check('动态样式：稳定后值怎么变都只改 style 变量，不换类、不插规则', () => {
    const s = css.create({ bar: (width: number) => ({ width, height: 6 }) });
    const width = signal(10);
    let stop = () => {};
    let el!: HTMLElement;
    stop = effectScope(() => {
      el = element(css.attrs(css.bind(s.bar, () => [width()])));
    });
    // 第一次变：width 从写死的“一直没变过”转成变量，就地换一次类
    width(20);
    const steady = observe(el, () => {
      width(30);
      width(40);
      width(50);
    });
    const final = computed(el, 'width');
    stop();
    return same(
      [steady.attributes, steady.inserts, final, el.style.getPropertyValue('--x-width')],
      [['style', 'style', 'style'], 0, '50px', '50px'],
    );
  });
  check('动态样式：第一次变时就地换一次类（写死 → 变量），之后不再换', () => {
    const s = css.create({ bar: (width: number) => ({ width, color: 'red' }) });
    const width = signal(10);
    let el!: HTMLElement;
    const stop = effectScope(() => {
      el = element(css.attrs(css.bind(s.bar, () => [width()])));
    });
    const initialClass = el.className;
    const first = observe(el, () => width(20));
    const switched = el.className !== initialClass;
    stop();
    return same([first.attributes.sort(), switched], [['class', 'style'], true]);
  });
  check('动态样式：按参数记忆求值结果（回到见过的值不再调用工厂函数）', () => {
    let calls = 0;
    const s = css.create({
      bar: (width: number) => {
        calls++;
        return { width };
      },
    });
    const width = signal(10);
    const stop = effectScope(() => {
      element(css.attrs(css.bind(s.bar, () => [width()])));
    });
    width(20);
    width(30);
    width(20);
    stop();
    return same(calls, 3);
  });

  /* ───────── 有限状态：就地换类 ───────── */
  check('select：有限状态就地换类（新组合第一次出现插一条规则，再出现不插），使用方的类不动，style 不动', () => {
    const s = css.create({ row: { display: 'block' }, hot: { color: 'red' } });
    const hot = signal(false);
    let el!: HTMLElement;
    const stop = effectScope(() => {
      const raw = document.createElement('div');
      raw.className = 'user';
      document.body.append(raw);
      attached.push(raw);
      el = mount(raw, css.attrs(s.row, css.select(() => hot() && s.hot)));
    });
    const cold = el.className;
    const toHot = observe(el, () => hot(true));
    const hotClass = el.className;
    const hotColor = computed(el, 'color');
    const back = observe(el, () => hot(false));
    const again = observe(el, () => hot(true));
    hot(false);
    const result = same(
      [
        toHot.attributes,
        toHot.inserts,
        hotColor,
        hotClass.includes('user'),
        hotClass !== cold,
        back.attributes,
        back.inserts,
        again.inserts,
        el.className === cold,
      ],
      [['class'], 1, 'rgb(255, 0, 0)', true, true, ['class'], 0, 0, true],
    );
    stop();
    return result;
  });
  check('select：返回假值时去掉这一段，只剩基础类', () => {
    const s = css.create({ row: { display: 'block' }, hot: { color: 'red' } });
    const hot = signal(true);
    let el!: HTMLElement;
    const stop = effectScope(() => {
      el = element(css.attrs(s.row, css.select(() => (hot() ? s.hot : null))));
    });
    hot(false);
    const only = css.attrs(s.row).class;
    stop();
    return same(el.className, only);
  });

  /* ───────── 换主题：只换根上的类 ───────── */
  check('换主题只换根元素的类，子元素一个改动都没有，颜色随变量变', () => {
    const dark = signal(false);
    const s = css.create({ child: { color: '_accent' } });
    let root!: HTMLElement;
    let child!: HTMLElement;
    const stop = effectScope(() => {
      root = element(css.attrs(css.select(() => (dark() ? darkTheme : lightTheme))));
      child = mount(document.createElement('div'), css.attrs(s.child));
      root.append(child);
    });
    const light = computed(child, 'color');
    const toDark = observe(root, () => dark(true));
    const darkColor = computed(child, 'color');
    const toLight = observe(root, () => dark(false));
    stop();
    return same(
      [
        light,
        darkColor,
        toDark.attributes,
        toDark.targets.every((target) => target === root),
        toDark.inserts,
        toLight.attributes,
        toLight.inserts,
      ],
      ['rgb(62, 99, 221)', 'rgb(141, 164, 239)', ['class'], true, 0, ['class'], 0],
    );
  });

  /* ───────── 清理 ───────── */
  check('effectScope 停掉后，改状态不再动 DOM', () => {
    const s = css.create({ bar: (width: number) => ({ width }) });
    const width = signal(1);
    const hot = signal(false);
    const hotStyle = css.create({ hot: { color: 'red' } });
    let el!: HTMLElement;
    const stop = effectScope(() => {
      el = element(css.attrs(css.bind(s.bar, () => [width()]), css.select(() => hot() && hotStyle.hot)));
    });
    width(2);
    stop();
    const after = observe(el, () => {
      width(3);
      hot(true);
    });
    return same(after.attributes, []);
  });

  /* ───────── 写法二（整个 attrs 包进 effect）与写法一、手写对照结果一致 ───────── */
  check('mountReactive：不用 bind / select，状态变化后的样式同样正确，稳定后只改变量', () => {
    const s = css.create({ row: { display: 'block' }, hot: { color: 'red' }, bar: (w: number) => ({ width: w }) });
    const hot = signal(false);
    const width = signal(5);
    let el!: HTMLElement;
    const stop = effectScope(() => {
      el = mountReactive(document.createElement('div'), () =>
        css.attrs(s.row, hot() && s.hot, s.bar(width())),
      );
      document.body.append(el);
      attached.push(el);
    });
    width(6);
    hot(true);
    const colorOn = computed(el, 'color');
    const steady = observe(el, () => width(7));
    const widthNow = computed(el, 'width');
    stop();
    return same([colorOn, steady.attributes, widthNow], ['rgb(255, 0, 0)', ['style'], '7px']);
  });
  check('基准的三种写法（engine / engine-effect / hand）走同一串操作，计算样式逐元素一致', () => {
    const modes: Mode[] = ['engine', 'engine-effect', 'hand'];
    const snapshots = modes.map((mode) => {
      const bench = createBench(mode, 30);
      for (const name of ['widths', 'hot', 'oneWidth', 'theme', 'widths', 'hot', 'theme'])
        bench.step(name);
      const snapshot = bench.snapshot();
      bench.dispose();
      return snapshot;
    });
    const [engine, effect, hand] = snapshots as [string[], string[], string[]];
    const diff = (a: string[], b: string[]) => a.findIndex((value, index) => value !== b[index]);
    const first = diff(engine, hand);
    if (first >= 0) return `engine 与 hand 在第 ${first} 个元素不同：${engine[first]} vs ${hand[first]}`;
    const second = diff(effect, hand);
    if (second >= 0) return `engine-effect 与 hand 在第 ${second} 个元素不同：${effect[second]} vs ${hand[second]}`;
    return true;
  });

  for (const el of attached) el.remove();
  attached.length = 0;
  return results.slice();
}

/** 用于 Node 侧真实悬停断言：返回一个带 :hover 条件的元素 id */
export function hoverFixture() {
  const s = css.create({
    base: { color: { default: 'red', ':hover': 'blue' } },
    over: { color: { default: 'green', ':hover': null } },
    box: { display: 'block', width: 50, height: 50 },
  });
  const el = document.createElement('div');
  el.id = 'hover-target';
  mount(el, css.attrs(s.box, s.base, s.over));
  document.body.append(el);
}
