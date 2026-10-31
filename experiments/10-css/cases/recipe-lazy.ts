// 配方的惰性与热更新：直接用引擎 API（不经过编译器），在浏览器里量
import { recipe, stats } from '@hilt/css';

const partNames = (n: number) => Array.from({ length: n }, (_, i) => `part${i}`);
const makeRecipe = (count: number, name: string) => {
  const parts = partNames(count);
  const sizes = ['sm', 'md', 'lg'];
  return recipe({
    name,
    parts,
    base: Object.fromEntries(parts.map((p, i) => [p, { padding: i + 1, color: { default: 'red', ':hover': 'blue' } }])),
    variants: {
      size: Object.fromEntries(sizes.map((s, si) => [s, Object.fromEntries(parts.map((p, i) => [p, { fontSize: 10 + si + (i % 3) }]))])),
    },
    defaults: { size: 'md' },
  } as never) as (selection: object) => Record<string, { sx: unknown[] }>;
};

const small = makeRecipe(3, 'Small');
const big = makeRecipe(40, 'Big');

const time = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

(window as any).api = {
  /** 创建 N 个实例，只读 root 部件 */
  instances(kind: 'small' | 'big', n: number) {
    const make = kind === 'small' ? small : big;
    const before = stats.fragmentBuilds;
    const ms = time(() => {
      for (let i = 0; i < n; i++) make({ size: i % 2 ? 'sm' : 'lg' }).part0;
    });
    return { ms, fragmentBuilds: stats.fragmentBuilds - before, rules: [...document.styleSheets].reduce((sum, sheet) => sum + sheet.cssRules.length, 0) };
  },
  /** 读全部部件 */
  allParts(n: number) {
    const ms = time(() => {
      for (let i = 0; i < n; i++) {
        const s = big({ size: 'md' });
        for (const part of partNames(40)) void (s as never)[part];
      }
    });
    return ms;
  },
};
