// 大目录交给 Node 自带的递归 fs.watch（Windows 是 ReadDirectoryChangesW，macOS 是 FSEvents，Linux 是 inotify 递归封装），
// 其余仍由 Vite 默认的 chokidar 监听。动机见 results/12-dev-hmr.txt：chokidar 在目录事件上会重新读整个目录并逐项 lstat，
// 单个目录上千个文件时，每次保存主线程要忙上百毫秒，拖慢监听事件、watchChange、模块转换。
//
// 用法（两处要配合）：
//   createServer({ server: { watch: { ignored: [`${dir}/**`] } }, plugins: [nativeWatch({ dirs: [dir] })] })
// 不能用 server.watch = null 关掉 chokidar：Vite 会因此关闭解析器的缓存（vite/dist/node/chunks/node.js 里的 disableCache），
// 实测 300 个组件的首开从 5 s 变成 8.8 s。
//
// 插件自己监听 dirs，把事件 emit 给 Vite 的 server.watcher（真正的 chokidar 实例，同样是 EventEmitter）。
// 事件按文件合并（Windows 一次写入会触发 2 次事件），合并窗口 COALESCE_MS 会计入延迟。
import { readdirSync, statSync, watch } from 'node:fs';
import { join, sep } from 'node:path';

const COALESCE_MS = 5;
const IGNORED = /(^|[\\/])(node_modules|\.git|\.hilt-cache|\.hilt-bundle|\.vite)([\\/]|$)/;

export function nativeWatch({ dirs, ignored = IGNORED }) {
  return {
    name: 'hilt-native-watch',
    configureServer(server) {
      const graph = server.environments.client.moduleGraph;
      // 启动时记下已有文件，之后对它们的事件才能判成"改"而不是"新增"
      const known = new Set(dirs.flatMap((dir) => readdirSync(dir, { recursive: true }).filter((name) => !ignored.test(name)).map((name) => join(dir, name))));
      const pending = new Map();

      const flush = (file) => {
        pending.delete(file);
        let stats;
        try {
          stats = statSync(file);
        } catch {
          if (known.delete(file)) server.watcher.emit('unlink', file);
          return;
        }
        if (!stats.isFile()) return;
        // 换文件式保存（先写临时文件再改名）给的是 rename 事件，但对 Vite 来说仍是"改"
        const exists = known.has(file) || graph.getModulesByFile(file.replaceAll(sep, '/'))?.size > 0;
        known.add(file);
        server.watcher.emit(exists ? 'change' : 'add', file);
      };

      const watchers = dirs.map((dir) =>
        watch(dir, { recursive: true }, (_event, filename) => {
          if (!filename || ignored.test(filename)) return;
          const file = join(dir, filename);
          if (!pending.has(file)) pending.set(file, setTimeout(flush, COALESCE_MS, file));
        }),
      );
      server.httpServer?.once('close', () => watchers.forEach((watcher) => watcher.close()));
    },
  };
}
