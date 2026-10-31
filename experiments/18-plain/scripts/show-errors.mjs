// 把类型用例里的 @ts-expect-error 去掉，看每个反例实际报什么错（评估报错是否好懂、是不是报在预期的地方）。
// 用法：node scripts/show-errors.mjs type-cases/elements.tsx [--max=字符数]
// 临时目录 .tmp-errors 继承根 tsconfig（paths、lib 都一样），用完删除。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = process.argv[2];
const max = Number(process.argv.find((a) => a.startsWith('--max='))?.slice(6) ?? 240);
const dir = `${root}.tmp-errors`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const name = basename(file);
const src = readFileSync(`${root}${file}`, 'utf8').replaceAll('@ts-expect-error', 'EXPECTED-ERROR-BELOW').replaceAll("'./theme'", "'../type-cases/theme'");
writeFileSync(`${dir}/${name}`, src);
writeFileSync(
  `${dir}/tsconfig.json`,
  JSON.stringify({
    extends: '../tsconfig.json',
    include: ['../kernel.d.ts', '../hilt/**/*.ts', '../type-cases/theme.ts', '../type-cases/custom-elements.ts', name],
  }),
);
const tsc = fileURLToPath(new URL('../../13-ts/node_modules/typescript/bin/tsc', import.meta.url));
const result = spawnSync('node', [tsc, '--noEmit', '-p', `${dir}/tsconfig.json`, '--pretty', 'false'], { encoding: 'utf8', maxBuffer: 1 << 26 });
const lines = src.split('\n');
for (const line of (result.stdout + result.stderr).split(/\r?\n/)) {
  const m = line.match(/^[^(]*\((\d+),(\d+)\): error (TS\d+): (.*)$/);
  if (m) console.log(`\n[L${m[1]}] ${lines[+m[1] - 1].trim().slice(0, 110)}\n   ${m[3]} ${m[4].slice(0, max)}`);
  else if (line.trim() && process.argv.includes('--all')) console.log('   ' + line.trim().slice(0, max));
}
rmSync(dir, { recursive: true, force: true });
