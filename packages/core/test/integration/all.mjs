// 全量集成测试：node test/integration/all.mjs [--browsers=chromium,firefox,webkit] 。每条命令一行汇总，FAIL 时打印细节。
// 这些测试要真浏览器、要拼服务端和客户端的输出，所以是独立脚本，不走 Vitest。lib/ 要 hiltkit 的构建产物，先 pnpm build。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const browsers = (
  process.argv.find((item) => item.startsWith('--browsers='))?.slice(11) ??
  'chromium,firefox,webkit'
).split(',');
let failed = 0;
function step(label, args, env = {}) {
  const start = Date.now();
  const result = spawnSync(
    process.execPath,
    args.map((arg, i) => (arg.endsWith('.mjs') ? here(arg) : arg)),
    { encoding: 'utf8', env: { ...process.env, ...env }, cwd: here('.') },
  );
  const output = `${result.stdout}${result.stderr}`.split('\n');
  const failures = output.filter((line) => /^\s*FAIL/.test(line));
  const ok = result.status === 0 && !failures.length;
  if (!ok) failed++;
  const tail = output.filter((line) => /通过|汇总|全部|error TS/.test(line)).slice(-1)[0] ?? '';
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}  ${Math.round((Date.now() - start) / 1000)}s  ${tail}`,
  );
  if (!ok)
    console.log(
      (failures.length ? failures : output.slice(-25))
        .slice(0, 30)
        .map((line) => `    ${line}`)
        .join('\n'),
    );
}
for (const name of browsers) {
  step(`run ${name}`, ['run.mjs'], { HILT_BROWSER: name });
  step(`verify ${name}`, ['verify.mjs'], { HILT_BROWSER: name });
  step(`lib ${name}`, ['lib/run.mjs'], { HILT_BROWSER: name });
  step(`port ${name}`, ['port/run.mjs'], { HILT_BROWSER: name });
}
step('fuzz', ['fuzz/run.mjs', '--no-shrink']);
step('fuzz mixed', ['fuzz/run.mjs', '--no-shrink', '--mixed', '--only=kernel']);
step('leak', ['--expose-gc', 'leak.mjs']);
step('devtools', ['devtools/test.mjs']);
for (const bug of ['dynamic-layering', 'merge-drops-dynamic', 'model-undefined'])
  step(`bug ${bug}`, [`port/bugs/${bug}.mjs`]);
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
