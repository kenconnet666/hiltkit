// 把一段 TSX 源码用编译器编译（client 或 server），连同入口一起打包。运行时和样式引擎用实验里的同一份。
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from '../../03-publish/packages/compiler/index.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const PACKAGES = '../../03-publish/packages';

/**
 * entry：入口 JS（可以 import 'fuzz-app'）；app：被编译的 TSX 源码。generate 是 'client' | 'server'。
 * 服务端产物是 ESM（在 Node 里 import），客户端是 IIFE。
 */
export async function bundleApp({ entry, app, generate, runtimeDir = process.env.FUZZ_RUNTIME_DIR ?? `${PACKAGES}/runtime` }) {
  const result = await build({
    stdin: { contents: entry, resolveDir: here('..'), loader: 'js', sourcefile: 'fuzz-entry.js' },
    bundle: true,
    write: false,
    logLevel: 'silent',
    format: generate === 'server' ? 'esm' : 'iife',
    platform: generate === 'server' ? 'node' : 'browser',
    target: 'es2022',
    alias: {
      // FUZZ_RUNTIME_DIR：换成故意改坏的运行时副本（selfcheck.mjs 的变异测试用），绝对路径
      '@hilt/runtime': (runtimeDir.startsWith('.') ? here(`${runtimeDir}/${generate === 'server' ? 'server.js' : 'index.js'}`) : `${runtimeDir}/${generate === 'server' ? 'server.js' : 'index.js'}`),
      '@hilt/css/abi': here('../../10-css/engine/abi.ts'),
      '@hilt/css': here('../../10-css/engine/runtime.ts'),
    },
    plugins: [
      {
        name: 'fuzz-app',
        setup(b) {
          b.onResolve({ filter: /^fuzz-app$/ }, () => ({ path: 'fuzz-app.tsx', namespace: 'fuzz' }));
          b.onLoad({ filter: /.*/, namespace: 'fuzz' }, async () => ({
            contents: (await compile(app, 'fuzz-app.tsx', { generate })).code,
            loader: 'js',
            resolveDir: here('..'),
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}
