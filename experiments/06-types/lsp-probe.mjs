// 第 3 条补充：TS 7（原生）的语言服务器走 LSP，用同样的靶子再量一遍。
// 用法：node lsp-probe.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const exe = path.join(root, 'node_modules/@typescript/typescript-win32-x64/lib/tsc.exe');
const proc = spawn(exe, ['--lsp', '--stdio'], { cwd: root });
let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();
proc.stderr.on('data', () => {});
proc.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const length = +/Content-Length: (\d+)/i.exec(buffer.slice(0, headerEnd).toString())[1];
    if (buffer.length < headerEnd + 4 + length) return;
    const msg = JSON.parse(buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString());
    buffer = buffer.slice(headerEnd + 4 + length);
    if (msg.id !== undefined && pending.has(msg.id) && !msg.method) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.id !== undefined && msg.method) {
      // 服务器发来的请求（如 workspace/configuration）：一律回空
      send({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'workspace/configuration' ? [] : null });
    }
  }
});
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  proc.stdin.write(body);
}
const request = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

const target = path.join(root, 'cases/03b-ls-targets.tsx');
const uri = pathToFileURL(target).href;
const text = readFileSync(target, 'utf8');
const lines = text.split('\n');
const posOf = (needle, delta = 0) => {
  const idx = text.indexOf(needle) + delta;
  const before = text.slice(0, idx).split('\n');
  return { line: before.length - 1, character: before.at(-1).length };
};
const short = (u) => decodeURIComponent(u).replace(/.*\/cases\//, '');

const init = await request('initialize', {
  processId: process.pid,
  rootUri: pathToFileURL(root).href,
  capabilities: { textDocument: { hover: { contentFormat: ['markdown', 'plaintext'] }, definition: { linkSupport: false }, rename: { prepareSupport: true } } },
  workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'exp' }],
});
console.log('server:', init.result?.serverInfo ?? '(未提供 serverInfo)');
notify('initialized', {});
notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } });
await new Promise((r) => setTimeout(r, 4000)); // 等项目加载

for (const v of ['A', 'B', 'C']) {
  console.log(`\n==== TS 7 LSP · 写法 ${v} ====`);
  const valuePos = posOf(`<Select${v} _value`, `<Select${v} `.length + 1);
  const changePos = posOf(`<Select${v} _value={v} onValueChange`, `<Select${v} _value={v} `.length + 1);
  for (const [label, position] of [['_value', valuePos], ['onValueChange', changePos]]) {
    const def = await request('textDocument/definition', { textDocument: { uri }, position });
    const locs = [def.result].flat().filter(Boolean);
    console.log(`  跳转 ${label}:`, locs.length ? locs.map((l) => `${short(l.uri ?? l.targetUri)}:${(l.range ?? l.targetRange).start.line + 1}`).join(' | ') : '(无结果)');
    const hover = await request('textDocument/hover', { textDocument: { uri }, position });
    const contents = hover.result?.contents;
    const textOf = typeof contents === 'string' ? contents : (contents?.value ?? JSON.stringify(contents));
    console.log(`  悬停 ${label}:`, (textOf ?? '(无)').replace(/\s+/g, ' ').slice(0, 160));
    const ren = await request('textDocument/rename', { textDocument: { uri }, position, newName: label === '_value' ? '_val' : 'onValChange' });
    const changes = ren.result?.changes ?? {};
    const count = Object.entries(changes).map(([u, e]) => `${short(u)}×${e.length}`);
    console.log(`  重命名 ${label}:`, ren.error ? '失败 ' + ren.error.message : count.join(', ') || '(无改动)');
  }
}
void lines;
proc.kill();
