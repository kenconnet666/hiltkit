// node 10-css/run.mjs [--only=sx,recipe,conditions,theme,priority,ssr,dev,size,bench] [--rounds=9] [--rows=1000] [--lib=300]
// 工作目录任意。计时只在独占机器、串行跑时有意义；--rounds=1 --rows=100 --lib=30 可以快速验证脚本。
import { launch } from '../lib/browser.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ALL = ['sx', 'recipe', 'conditions', 'theme', 'priority', 'ssr', 'dev', 'size', 'bench'];
const only = new Set(option('only', ALL.join(',')).split(','));

const browser = await launch();
let failed = 0;
let total = 0;
const check = (label, passed, detail) => {
  total++;
  if (!passed) failed++;
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `\n     → ${JSON.stringify(detail)}`}`);
};
const context = { browser, check, option };

for (const name of ALL) {
  if (!only.has(name)) continue;
  const module = await import(`./checks-${name}.mjs`);
  await module.run(context);
  console.log();
}
console.log(`断言 ${total - failed}/${total} 通过${failed ? `，${failed} 个失败` : ''}`);
await browser.close();
if (failed) process.exitCode = 1;
