// 命令行和 MCP 共用：找到开发服务器、调用页面里的调试内核。工具定义也只有这一份。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DISCOVERY_FILE = 'node_modules/.hilt/devtools.json';

/** 从 start 往上找发现文件；开发服务器启动时写，关闭时删 */
export function findServer(start = process.cwd()) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const file = join(dir, DISCOVERY_FILE);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) return undefined;
  }
}

export async function callPage(method, params, root) {
  const server = findServer(root);
  if (!server)
    return {
      ok: false,
      error: {
        code: 'NO_SERVER',
        message: '没找到开发服务器',
        hint: `先启动带 hiltDevtools() 插件的 Vite，或者传 --root。找的是 ${DISCOVERY_FILE}`,
      },
    };
  try {
    const response = await fetch(new URL('__hilt/call', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hilt-token': server.token },
      body: JSON.stringify({ method, params }),
    });
    return await response.json();
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'SERVER_DOWN',
        message: `连不上 ${server.url}：${error.message}`,
        hint: '开发服务器可能已经退出',
      },
    };
  }
}

const target = {
  type: 'string',
  description: 'id（c12 组件、e5 effect、s9 信号、d3 derived）或 CSS 选择器',
};
const selector = { type: 'string', description: 'CSS 选择器' };
const readOnly = { readOnlyHint: true };
/** method 是页面里的方法名，MCP 工具名加 hilt_ 前缀 */
export const TOOLS = [
  {
    method: 'summary',
    description: '总览：应用、组件数、effect 数、问题数、是否在录制。第一个该调的工具。',
    properties: {},
    annotations: readOnly,
  },
  {
    method: 'tree',
    description: '组件树。结果默认很短：用 depth、limit 控制范围，用 id 看子树，用 name 按名字搜。',
    properties: {
      id: { type: 'string', description: '从这个组件开始' },
      depth: { type: 'number' },
      limit: { type: 'number' },
      name: { type: 'string', description: '按组件名搜，返回平铺结果和路径' },
    },
    annotations: readOnly,
  },
  {
    method: 'inspect',
    description: '组件、effect、信号或元素的详情：props、当前值、依赖、订阅者。',
    properties: { target },
    required: ['target'],
    annotations: readOnly,
  },
  {
    method: 'locate',
    description: 'DOM 元素来自哪：JSX 文件和行号、组件链、上面的绑定。',
    properties: { selector },
    required: ['selector'],
    annotations: readOnly,
  },
  {
    method: 'issues',
    description:
      '框架发现的问题，带编号、位置、修法。HILT001 只取一次，HILT002 水合不一致，HILT003 effect 抛错。',
    properties: { code: { type: 'string' }, limit: { type: 'number' } },
    annotations: readOnly,
  },
  {
    method: 'record',
    description:
      '开始或结束录制。start 后操作页面，stop 返回摘要，之后才能查 why、perf、timeline。',
    properties: { action: { type: 'string', enum: ['start', 'stop'] } },
    required: ['action'],
  },
  {
    method: 'why',
    description:
      '为什么更新：目标最近的运行分别是谁写了什么引起的，写入的代码位置，以及触发它的浏览器事件。需要先录制。',
    properties: { target, limit: { type: 'number' } },
    required: ['target'],
    annotations: readOnly,
  },
  {
    method: 'timeline',
    description: '录到的写入和运行，按时间排。需要先录制。',
    properties: { limit: { type: 'number' }, offset: { type: 'number' } },
    annotations: readOnly,
  },
  {
    method: 'perf',
    description: '录制期间谁跑得多、谁慢、谁白跑（跑了但页面没变）。同类绑定合并统计。需要先录制。',
    properties: { limit: { type: 'number' } },
    annotations: readOnly,
  },
  {
    method: 'attrs',
    description: '元素属性从哪来：最终 attribute、原始写法、class/style 的各层和合并它们的组件。',
    properties: { selector },
    required: ['selector'],
    annotations: readOnly,
  },
  {
    method: 'set',
    description:
      '改信号的值。默认关闭，页面调用 configureDevtools({ allowWrite: true }) 后才能用。',
    properties: { target, value: { description: '新值' } },
    required: ['target', 'value'],
    annotations: { destructiveHint: true },
  },
];
