// 把组件库预编译成两份纯 JS：浏览器一份、服务端一份，靠 package.json 的条件导出分发
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from './packages/compiler/index.mjs';

const root = fileURLToPath(new URL('./packages/ui/', import.meta.url));
const source = readFileSync(`${root}src/index.tsx`, 'utf8');
mkdirSync(`${root}dist`, { recursive: true });
const start = performance.now();
const client = await compile(source, `${root}src/index.tsx`);
const server = await compile(source, `${root}src/index.tsx`, { generate: 'server' });
const ms = performance.now() - start;
writeFileSync(`${root}dist/index.js`, client.code);
writeFileSync(`${root}dist/server.js`, server.code);
console.log(`编译 ${source.split('\n').length} 行两遍用了 ${ms.toFixed(0)} ms，客户端 ${client.code.length} 字节，服务端 ${server.code.length} 字节`);
