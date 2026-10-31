// 构建期预计算（在 Node 里跑，不计时）：每个样式组 → 类名 + 规则文本。
// 用引擎自己的纯函数算，所以结果与运行时路径逐字相同；运行时只要查表 + insertRule。
import { declarations, merge, SELF, serialize } from './engine/declarations';
import { hash } from './engine/sheet';
import { makeGroups } from './workload';

export interface Precomputed {
  name: string;
  rules: string[];
}

export function precompute(count: number): Precomputed[] {
  return makeGroups(count).map((group) => {
    const rules = serialize(merge([declarations(group)]));
    const name = `x${hash(rules.join(''))}`;
    return { name, rules: rules.map((rule) => rule.replaceAll(SELF, name)) };
  });
}
