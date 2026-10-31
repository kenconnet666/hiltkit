#!/usr/bin/env node
// 命令行客户端：node 18-plain/devtools/cli.mjs tree --depth=2；why c12；locate "a.remove"。
// 结果是一行 JSON，退出码 0 成功、1 工具报错、2 用法不对。--root=目录 指定从哪里找开发服务器。
import { callPage, TOOLS } from './client.mjs';

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (const arg of args) {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (match) flags[match[1]] = match[2];
  else positional.push(arg);
}
const [method, first] = positional;
const tool = TOOLS.find((item) => item.method === method);
if (!tool) {
  console.error(`用法：cli.mjs <命令> [参数] [--键=值]\n${TOOLS.map((item) => `  ${item.method.padEnd(10)}${item.description}`).join('\n')}`);
  process.exit(2);
}
const { root, ...named } = flags;
const params = {};
for (const [key, value] of Object.entries(named)) {
  const type = tool.properties[key]?.type;
  params[key] = type === 'number' ? Number(value) : type === 'string' ? value : tryJson(value);
}
// 第一个位置参数填第一个必填项：why c12、locate "a.remove"、record start
if (first !== undefined && tool.required?.[0]) params[tool.required[0]] = first;
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const outcome = await callPage(method, params, root);
if (outcome.ok) console.log(JSON.stringify(outcome.result));
else {
  console.error(JSON.stringify(outcome.error));
  process.exitCode = 1;
}
