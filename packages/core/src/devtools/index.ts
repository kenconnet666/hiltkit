/**
 * 调试内核 `hiltkit/devtools`：组件树、依赖图、更新因果、问题清单。只在开发期导入（hiltDevtools 插件注入，或手写 import）。
 *
 * 所有客户端（命令行、MCP、浏览器插件、测试）都走同一个入口：globalThis.__HILT_DEVTOOLS__.call(方法, 参数)。
 * 输出都是可以直接 JSON 化的摘要：默认短，靠 id 下钻，不把整棵树或整份状态一次吐出来。
 *
 * 模块分工：store（数据）、describe（对象 → 摘要）、collector（内核钩子 → 数据）、methods（对外方法）。
 */
import { installCollector } from './collector';
import { methods } from './methods';
import { PROTOCOL_VERSION } from './store';

export { configureDevtools, PROTOCOL_VERSION } from './store';

installCollector();

/** 唯一入口。结果都可以 JSON 化；出错不抛，返回错误码和下一步该做什么 */
export function call(
  method: string,
  params?: unknown,
):
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; hint?: string } } {
  const handler = Object.hasOwn(methods, method) ? methods[method] : undefined;
  if (!handler)
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_METHOD',
        message: `没有方法 ${method}`,
        hint: `可用：${Object.keys(methods).join('、')}`,
      },
    };
  try {
    return { ok: true, result: handler(params ?? {}) };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: error.code ?? 'INTERNAL',
        message: String(error.message ?? error),
        hint: error.hint,
      },
    };
  }
}
(globalThis as any).__HILT_DEVTOOLS__ = {
  version: PROTOCOL_VERSION,
  call,
  methods: Object.keys(methods),
};

/** 接到开发服务器：hiltDevtools 插件生成的客户端模块调用 */
export function connectDevServer(hot: {
  send(event: string, data: unknown): void;
  on(event: string, handler: (data: any) => void): void;
}) {
  hot.on('hilt:call', ({ id, method, params }) =>
    hot.send('hilt:result', { id, ...call(method, params) }),
  );
  const hello = () =>
    hot.send('hilt:hello', {
      protocol: PROTOCOL_VERSION,
      url: location.href,
      title: document.title,
    });
  hot.on('vite:ws:connect', hello);
  hello();
}
