// 类型层的回归门：四个工程（TS 7.1 beta）+ 与运行时同步的两个校验。node scripts/check.mjs
// 每个 @ts-expect-error 都必须真的报错（未命中会报 TS2578），所以“零错误”同时意味着正例通过、负例全部命中。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const tsc = here('../../13-ts/node_modules/typescript/bin/tsc');
const steps = [
  ['根工程（types-check、cases、type-cases）', [tsc, '-p', here('../tsconfig.json'), '--pretty', 'false']],
  ['组件库迁移（port/ui.tsx、port/types.tsx）', [tsc, '-p', here('../port/tsconfig.json'), '--pretty', 'false']],
  ['组件库发布（生成 .d.ts）', [tsc, '-p', here('../lib/tsconfig.json'), '--pretty', 'false']],
  ['使用方（只看 .d.ts）', [tsc, '-p', here('../lib/consumer/tsconfig.json'), '--pretty', 'false']],
  ['属性→token 组的反向表与 token-map.ts 一致', [here('./gen-property-groups.mjs'), '--check']],
  ['事件驼峰表对照 lib.dom', [here('./check-events.mjs')]],
];
let failed = 0;
for (const [label, args] of steps) {
  const result = spawnSync('node', args, { encoding: 'utf8' });
  const ok = result.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log((result.stdout + result.stderr).split('\n').slice(0, 20).join('\n'));
}
console.log(failed ? `失败 ${failed}` : '全部通过');
process.exit(failed ? 1 : 0);
