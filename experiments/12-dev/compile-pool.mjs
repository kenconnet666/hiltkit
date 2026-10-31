// 编译线程池：把 compile(code, file, options) 派给 node:worker_threads。
// 空闲线程直接接活，忙时排队；线程在创建时就开始加载 Babel（不阻塞调用方）。
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { here, packagesDir } from './common.mjs';

export function createCompilePool(size) {
  const compilerUrl = pathToFileURL(join(packagesDir, 'compiler/index.mjs')).href;
  const pending = new Map();
  const idle = [];
  const queue = [];
  let nextId = 0;
  const created = performance.now();
  let readyCount = 0;
  const pool = { size, readyMs: undefined };

  const dispatch = () => {
    while (idle.length && queue.length) {
      const worker = idle.pop();
      const task = queue.shift();
      worker.currentTask = task.id;
      worker.postMessage(task);
    }
  };

  const workers = Array.from({ length: size }, () => {
    const worker = new Worker(here('./compile-worker.mjs'), { workerData: { compilerUrl } });
    worker.on('message', (message) => {
      if (message.ready) {
        if (++readyCount === size) pool.readyMs = performance.now() - created;
        idle.push(worker);
        dispatch();
        return;
      }
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      idle.push(worker);
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
      dispatch();
    });
    worker.on('error', (error) => console.error('编译线程出错', error));
    return worker;
  });

  return Object.assign(pool, {
    compile: (code, file, options) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        queue.push({ id, code, file, options });
        dispatch();
      }),
    close: () => Promise.all(workers.map((worker) => worker.terminate())),
  });
}
