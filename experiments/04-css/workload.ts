// 组件库规模的模拟负载：N 个样式组，每组约 10 个属性（14 个值），含伪类、媒体查询与 token 短写。
// 每组的数值各不相同，所以每组展开后是一个不同的类（不会靠去重省掉工作）。
import type { StyleObject } from './engine/declarations';
import './theme';

export function makeGroups(count: number): StyleObject[] {
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
