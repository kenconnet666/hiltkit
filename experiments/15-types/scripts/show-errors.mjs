// 把某个用例里的 @ts-expect-error 去掉，看每个反例实际报什么错（评估报错是否好懂、是不是报在预期的地方）。
// 用法：node scripts/show-errors.mjs cases/04-attrs.tsx [--max=行数]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

const file = process.argv[2];
const dir = '.tmp-errors';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const src = readFileSync(file, 'utf8').replaceAll('@ts-expect-error', 'EXPECTED-ERROR-BELOW');
const name = basename(file);
writeFileSync(`${dir}/${name}`, src);
const cfg = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
cfg.include = ['../types/**/*.d.ts', '../cases/theme.ts', '../cases/04b-custom-elements.ts', name];
for (const key of Object.keys(cfg.compilerOptions.paths)) cfg.compilerOptions.paths[key] = cfg.compilerOptions.paths[key].map((p) => (p.startsWith('./') ? `.${p}` : p.startsWith('../') ? `../${p}` : p));
writeFileSync(`${dir}/tsconfig.json`, JSON.stringify(cfg));
const r = spawnSync('node', ['../13-ts/node_modules/typescript/bin/tsc', '--noEmit', '-p', `${dir}/tsconfig.json`, '--pretty', 'false'], { encoding: 'utf8' });
const lines = src.split('\n');
for (const l of (r.stdout + r.stderr).split(/\r?\n/)) {
  const m = l.match(/^[^(]*\((\d+),(\d+)\): error (TS\d+): (.*)$/);
  if (m) console.log(`\n[L${m[1]}] ${lines[+m[1] - 1].trim().slice(0, 110)}\n   ${m[3]} ${m[4].slice(0, 260)}`);
  else if (l.trim()) console.log('   ' + l.trim().slice(0, 200));
}
rmSync(dir, { recursive: true, force: true });
