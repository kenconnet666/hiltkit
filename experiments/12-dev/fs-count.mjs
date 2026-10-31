// 先于 vite 加载：给 fs 的 stat / lstat / readdir 计数，证明一次文件改动触发了多少次文件系统调用。
// 必须在 import 'vite' 之前执行（vite 里的 chokidar 在加载时把 fs 函数取走）。
import fs, { promises } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

export const fsCalls = { stat: 0, lstat: 0, readdir: 0 };
for (const [target, names] of [[promises, ['stat', 'lstat', 'readdir']], [fs, ['stat', 'lstat', 'readdir']]]) {
  for (const name of names) {
    const original = target[name];
    target[name] = function (...args) {
      fsCalls[name]++;
      return original.apply(this, args);
    };
  }
}
syncBuiltinESMExports();
