/**
 * 开发期插件 `hiltkit/vite`：只在开发服务器用，生产构建不用。不改写代码语义，只在文件末尾追加几行登记。
 *   hiltHot       组件热更新，上层状态保留
 *   hiltDevtools  注入调试内核，开一个接口给命令行和 MCP
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * 只有全部导出都是组件（首字母大写的函数）的文件才自己接住更新；
 * 其余文件交给 Vite 按依赖向上找，最后整页刷新。
 */
export function hiltHot(): Plugin {
  return {
    name: 'hilt-hot',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]!;
      if (!file.endsWith('.tsx') || file.includes('node_modules')) return null;
      const components = [...code.matchAll(/^export (?:function|const) ([A-Z]\w*)/gm)].map(
        (match) => match[1]!,
      );
      const others = [...code.matchAll(/^export (?:function|const|let|class) ([a-z_$]\w*)/gm)];
      if (!components.length || others.length) return null;
      const lines = components.map(
        (name) => `__hotRegister(${JSON.stringify(`${file}#${name}`)}, ${name});`,
      );
      return `import { hotRegister as __hotRegister } from 'hiltkit';\n${code}\n${lines.join('\n')}\nif (import.meta.hot) import.meta.hot.accept();\n`;
    },
  };
}

const CLIENT_ID = 'virtual:hilt-devtools-client';
const RESOLVED_CLIENT = `\0${CLIENT_ID}`;
const CALL_TIMEOUT = 5000;
/** 命令行和 MCP 靠这个文件找到开发服务器 */
export const DISCOVERY_FILE = 'node_modules/.hilt/devtools.json';

interface CallOutcome {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; hint?: string };
}

/**
 * 调试通道：页面里注入调试内核，开发服务器开一个 POST /__hilt/call。命令行、MCP 都走它，不需要浏览器插件。
 * 要带发现文件里的随机令牌：自定义请求头过不了跨域预检，别的网页不能借用户的浏览器调这个接口。
 */
export function hiltDevtools(): Plugin {
  return {
    name: 'hilt-devtools',
    apply: 'serve',
    resolveId: (id) => (id === CLIENT_ID ? RESOLVED_CLIENT : null),
    load: (id) =>
      id === RESOLVED_CLIENT
        ? `import { connectDevServer } from 'hiltkit/devtools';\nif (import.meta.hot) connectDevServer(import.meta.hot);\n`
        : null,
    // 放在 head 最前面：模块按文档顺序执行，要先于应用入口装好钩子
    transformIndexHtml: () => [
      {
        tag: 'script',
        attrs: { type: 'module', src: `/@id/__x00__${CLIENT_ID}` },
        injectTo: 'head-prepend',
      },
    ],
    configureServer(server) {
      const root = server.config.root;
      const token = randomBytes(24).toString('hex');
      const discovery = join(root, DISCOVERY_FILE);
      const pending = new Map<
        number,
        { resolve: (value: CallOutcome) => void; timer: NodeJS.Timeout }
      >();
      /** 打开的页面，最新的放最后；默认查最后一个 */
      const pages = new Map<any, unknown>();
      let nextCall = 0;
      server.ws.on('hilt:hello', (data, client) => {
        pages.delete(client);
        pages.set(client, data);
      });
      server.ws.on('hilt:result', ({ id, ...result }: { id: number } & CallOutcome) => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.resolve(result);
      });
      const callPage = (method: string, params: unknown) =>
        new Promise<CallOutcome>((resolve) => {
          const clients = [...pages.keys()].filter(
            (client) => client.socket === undefined || client.socket.readyState === 1,
          );
          const client = clients.at(-1);
          if (!client) {
            resolve({
              ok: false,
              error: {
                code: 'NO_PAGE',
                message: '开发服务器上没有打开的页面',
                hint: '在浏览器里打开应用，再重试',
              },
            });
            return;
          }
          const id = ++nextCall;
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve({
              ok: false,
              error: {
                code: 'PAGE_TIMEOUT',
                message: `页面 ${CALL_TIMEOUT} ms 内没有回应`,
                hint: '页面可能被刷新、挂起或卡死了',
              },
            });
          }, CALL_TIMEOUT);
          pending.set(id, { resolve, timer });
          client.send('hilt:call', { id, method, params });
        });
      server.middlewares.use('/__hilt/call', (request, response) => {
        const send = (status: number, body: CallOutcome) => {
          response.statusCode = status;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(body));
        };
        if (request.method !== 'POST') {
          send(405, { ok: false, error: { code: 'METHOD', message: '只接受 POST' } });
          return;
        }
        if (request.headers['x-hilt-token'] !== token) {
          send(403, {
            ok: false,
            error: { code: 'BAD_TOKEN', message: '令牌不对', hint: `令牌在 ${DISCOVERY_FILE}` },
          });
          return;
        }
        let text = '';
        request.on('data', (chunk) => (text += chunk));
        request.on('end', () => {
          void (async () => {
            try {
              const { method, params } = JSON.parse(text);
              send(200, await callPage(method, params));
            } catch (error) {
              send(400, {
                ok: false,
                error: { code: 'BAD_REQUEST', message: String((error as Error).message) },
              });
            }
          })();
        });
      });
      server.httpServer?.once('listening', () => {
        const address = server.httpServer!.address();
        const port = typeof address === 'object' ? address?.port : undefined;
        const url = server.resolvedUrls?.local[0] ?? `http://localhost:${port}/`;
        mkdirSync(join(root, 'node_modules/.hilt'), { recursive: true });
        writeFileSync(discovery, JSON.stringify({ url, token, pid: process.pid }));
      });
      server.httpServer?.once('close', () => rmSync(discovery, { force: true }));
    },
  };
}
