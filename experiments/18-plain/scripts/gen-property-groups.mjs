// 从引擎的 token-map.ts（属性 → token 组的对照表）生成类型层用的反向表，保证类型与运行时一致。
// 用法：node 18-plain/scripts/gen-property-groups.mjs [--check]   --check 只比对，不写文件（过期则退出码 1）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
// Node 24 直接加载 .ts（类型擦除）；token-map.ts 没有外部依赖
const { TOKEN_GROUP_OF } = await import(new URL('../../10-css/engine/token-map.ts', import.meta.url).href);

const byGroup = new Map();
for (const [property, group] of TOKEN_GROUP_OF) {
  if (!byGroup.has(group)) byGroup.set(group, []);
  byGroup.get(group).push(property);
}
const lines = [...TOKEN_GROUP_OF].map(([property, group]) => `  ${property}: '${group}';`);
const output = `/**
 * 属性 → token 组的反向表。由 18-plain/scripts/gen-property-groups.mjs 从 10-css/engine/token-map.ts 生成，不要手改。
 * 反向表让“某个属性接受哪组 token”是一次属性查找；按组存属性名联合再逐组判断 extends 要多做十几次条件类型。
 */
export interface PropertyGroupOf {
${lines.join('\n')}
}
/** 有短写的 token 组 */
export type TokenGroupName = ${[...byGroup.keys()].map((g) => `'${g}'`).join(' | ')};
`;
const target = here('../hilt/types/css/property-groups.ts');
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch {}
  if (current.replace(/\r\n/g, '\n') !== output) {
    console.error('property-groups.ts 已过期：运行 node 18-plain/scripts/gen-property-groups.mjs');
    process.exit(1);
  }
  console.log('property-groups.ts 与 token-map.ts 一致');
} else {
  writeFileSync(target, output);
  console.log(`写入 ${target}：${TOKEN_GROUP_OF.size} 个属性，${byGroup.size} 组`);
}
