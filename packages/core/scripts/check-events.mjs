// 对照 lib.dom 的事件表，检查 src/types/events.ts 的驼峰表有没有漏登记多词事件。
// lib.dom 的事件名全小写，单词边界只能人工给；这里列出已知的单词事件，其余必须在驼峰表里，否则报告。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// TypeScript 7 的 lib 文件在按平台分发的子包里
const fromCore = createRequire(import.meta.url);
const fromTypescript = createRequire(fromCore.resolve('typescript/package.json'));
const native = `@typescript/typescript-${process.platform}-${process.arch}`;
const libDir = join(dirname(fromTypescript.resolve(`${native}/package.json`)), 'lib');
const dom = readFileSync(join(libDir, 'lib.dom.d.ts'), 'utf8').replace(/\r/g, '');
const names = new Set();
for (const map of ['GlobalEventHandlersEventMap', 'ElementEventMap', 'HTMLMediaElementEventMap']) {
  const start = dom.indexOf(`interface ${map} `);
  const body = dom.slice(start, dom.indexOf('\n}', start));
  for (const line of body.split('\n').slice(1)) {
    const name = line.trim().split(':')[0].replace(/"/g, '');
    if (/^[a-z]+$/.test(name)) names.add(name);
  }
}
const events = readFileSync(
  fileURLToPath(new URL('../src/types/events.ts', import.meta.url)),
  'utf8',
);
const table = new Set([...events.matchAll(/\b([a-z]+): '[A-Za-z]+'/g)].map((m) => m[1]));
const single = new Set(
  'abort blur cancel change click close command copy cut drag drop emptied ended error focus input invalid keydown keypress keyup load paste pause play playing progress reset resize scroll seeked seeking select stalled submit suspend toggle waiting wheel encrypted waitingforkey'.split(
    ' ',
  ),
);
const missing = [...names].filter((name) => !table.has(name) && !single.has(name));
if (missing.length) {
  console.error(`事件驼峰表可能漏登记（多词但不在表里）：${missing.join(' ')}`);
  process.exit(1);
}
console.log(`事件驼峰表完整（lib.dom ${names.size} 个事件）`);
