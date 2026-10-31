// 把某个用例里的 @ts-expect-error 去掉，看反例实际报什么错（评估报错是否好懂）。
// 用法：node show-errors.mjs cases/01-component.tsx [--ts6]
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

const file = process.argv[2];
const ts6 = process.argv.includes('--ts6');
const dir = '.tmp-errors';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const src = readFileSync(file, 'utf8').replaceAll('@ts-expect-error', 'EXPECTED-ERROR-BELOW');
const name = basename(file);
writeFileSync(`${dir}/${name}`, src);
const cfg = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
cfg.include = ['../types/**/*.d.ts', name];
cfg.compilerOptions.paths = { exp06: ['../types/index.d.ts'], 'exp06/*': ['../types/*'] };
writeFileSync(`${dir}/tsconfig.json`, JSON.stringify(cfg));
const bin = ts6 ? 'node_modules/typescript6/bin/tsc' : 'node_modules/typescript/bin/tsc';
const r = spawnSync('node', [bin, '--noEmit', '-p', `${dir}/tsconfig.json`, '--pretty', 'false'], { encoding: 'utf8' });
const lines = src.split('\n');
// 每条错误前补上出错行的源码，方便对照
for (const l of (r.stdout + r.stderr).split(/\r?\n/)) {
  const m = l.match(/^[^(]*\((\d+),(\d+)\): error (TS\d+): (.*)$/);
  if (m) console.log(`\n[L${m[1]}] ${lines[+m[1] - 1].trim().slice(0, 110)}\n   ${m[3]} ${m[4]}`);
  else if (l.trim()) console.log('   ' + l.trim().slice(0, 220));
}
rmSync(dir, { recursive: true, force: true });
