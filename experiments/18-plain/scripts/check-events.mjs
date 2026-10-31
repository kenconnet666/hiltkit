// 对照 lib.dom 的事件表，检查 hilt/types/events.ts 的驼峰表有没有漏登记多词事件。
// lib.dom 的事件名全小写，单词边界只能人工给；这里列出已知的单词事件，其余必须在驼峰表里，否则报告。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dom = readFileSync(fileURLToPath(new URL('../../13-ts/node_modules/@typescript/typescript-win32-x64/lib/lib.dom.d.ts', import.meta.url)), 'utf8').replace(/\r/g, '');
const names = new Set();
for (const map of ['GlobalEventHandlersEventMap', 'ElementEventMap', 'HTMLMediaElementEventMap']) {
  const start = dom.indexOf(`interface ${map} `);
  const body = dom.slice(start, dom.indexOf('\n}', start));
  for (const line of body.split('\n').slice(1)) {
    const name = line.trim().split(':')[0].replace(/"/g, '');
    if (/^[a-z]+$/.test(name)) names.add(name);
  }
}
const table = new Set([...readFileSync(fileURLToPath(new URL('../hilt/types/events.ts', import.meta.url)), 'utf8').matchAll(/\b([a-z]+): '[A-Za-z]+'/g)].map((m) => m[1]));
const single = new Set('abort blur cancel change click close command copy cut drag drop emptied ended error focus input invalid keydown keypress keyup load paste pause play playing progress reset resize scroll seeked seeking select stalled submit suspend toggle waiting wheel encrypted waitingforkey'.split(' '));
const missing = [...names].filter((name) => !table.has(name) && !single.has(name));
console.log(`lib.dom 事件 ${names.size} 个，驼峰表 ${table.size} 个，单词事件 ${single.size} 个`);
if (missing.length) {
  console.log(`可能漏登记（多词但不在驼峰表里）：${missing.join(' ')}`);
  process.exit(1);
}
console.log('事件驼峰表完整');
