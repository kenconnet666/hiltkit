// compile-pool.mjs 的工作线程：加载编译器，收一个编译任务就回一个结果。
import { parentPort, workerData } from 'node:worker_threads';

const { compile } = await import(workerData.compilerUrl);
parentPort.postMessage({ ready: true });
parentPort.on('message', async ({ id, code, file, options }) => {
  try {
    const { code: out, map } = await compile(code, file, options);
    parentPort.postMessage({ id, result: { code: out, map } });
  } catch (error) {
    parentPort.postMessage({ id, error: error.stack ?? String(error) });
  }
});
