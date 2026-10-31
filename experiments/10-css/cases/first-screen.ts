// 首屏成本：N 个样式组（每组约 10 个属性、14 个值，含伪类、媒体查询与 token 短写，每组各不相同）第一次渲染全部用到。
import { create, defineTokens } from '@hilt/css';
import { attrs } from '../engine/attrs';

defineTokens('f', {
  colors: { text: '#1f2328', accent: '#3e63dd' },
  space: { md: '8px' },
});

function makeGroups(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '_md',
    padding: { default: 8 + (i % 7), '@media (min-width: 640px)': 12 + (i % 5) },
    margin: i % 4,
    fontSize: 12 + (i % 6),
    fontWeight: 400 + (i % 3) * 100,
    borderRadius: 4 + (i % 5),
    color: { default: '_text', ':hover': '_accent' },
    backgroundColor: {
      default: `hsl(${i % 360}, 40%, 96%)`,
      ':hover': `hsl(${i % 360}, 50%, 92%)`,
      ':active': `hsl(${i % 360}, 55%, 88%)`,
      ':focus-visible': `hsl(${(i + 40) % 360}, 60%, 90%)`,
    },
    outline: { default: 'none', ':focus-visible': `2px solid hsl(${i % 360}, 70%, 50%)` },
  }));
}

(window as any).api = {
  /** 全部走运行时：create → 元素的 sx（展开声明 + 组合 + 哈希 + 插规则），再挂元素强制样式重算 */
  run(count: number) {
    const inputs = makeGroups(count);
    const classes: string[] = new Array(count);
    const start = performance.now();
    for (let i = 0; i < count; i++) classes[i] = attrs(create({ root: inputs[i] }).root).class!;
    const ms = performance.now() - start;
    const attachStart = performance.now();
    const host = document.createElement('div');
    for (const name of classes) {
      const element = document.createElement('div');
      element.className = name;
      host.append(element);
    }
    document.body.append(host);
    void getComputedStyle(host.lastElementChild!).color;
    void host.offsetHeight;
    const rules = [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0);
    return { ms, recalcMs: performance.now() - attachStart, rules };
  },
};
