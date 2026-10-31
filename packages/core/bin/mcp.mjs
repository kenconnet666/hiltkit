#!/usr/bin/env node
// MCP 服务（stdio，一行一条 JSON-RPC）：只把 TOOLS 转发给页面，自己没有逻辑。
// 页面内容可能来自用户输入或第三方接口，结果标明是不可信数据，不能当指令执行。
import { createInterface } from 'node:readline';
import { callPage, TOOLS } from './client.mjs';

const root = process.argv.find((arg) => arg.startsWith('--root='))?.slice(7);
const PROTOCOL = '2025-06-18';
const PREFIX = 'hilt_';
const toolList = TOOLS.map(({ method, description, properties, required, annotations }) => ({
  name: `${PREFIX}${method}`,
  description,
  inputSchema: { type: 'object', properties, ...(required ? { required } : {}) },
  ...(annotations ? { annotations } : {}),
}));
const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

async function callTool({ name, arguments: params }) {
  const tool = TOOLS.find((item) => `${PREFIX}${item.method}` === name);
  if (!tool) return { content: [{ type: 'text', text: `没有工具 ${name}` }], isError: true };
  const outcome = await callPage(tool.method, params ?? {}, root);
  if (!outcome.ok)
    return { content: [{ type: 'text', text: JSON.stringify(outcome.error) }], isError: true };
  return {
    content: [
      { type: 'text', text: JSON.stringify({ untrustedPageData: true, result: outcome.result }) },
    ],
  };
}

const handlers = {
  initialize: ({ protocolVersion }) => ({
    protocolVersion: protocolVersion ?? PROTOCOL,
    capabilities: { tools: {} },
    serverInfo: { name: 'hilt-devtools', version: '0.1.0' },
  }),
  ping: () => ({}),
  'tools/list': () => ({ tools: toolList }),
  'tools/call': callTool,
};
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: 'JSON 解析失败' } });
    continue;
  }
  // 没有 id 的是通知，不回
  if (message.id === undefined) continue;
  const handler = handlers[message.method];
  if (!handler) {
    send({ id: message.id, error: { code: -32601, message: `没有方法 ${message.method}` } });
    continue;
  }
  try {
    send({ id: message.id, result: await handler(message.params ?? {}) });
  } catch (error) {
    send({ id: message.id, error: { code: -32603, message: String(error.message) } });
  }
}
