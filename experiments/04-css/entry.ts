// 浏览器入口：run.mjs 打成 IIFE 放进页面，通过 window 上的函数驱动。
import { createBench, SCENARIOS, type Mode } from './bench';
import { hoverFixture, runChecks } from './checks';
import { engineRun, engineStages, precomputedRun } from './library';
import type { Precomputed } from './precompute';

declare global {
  interface Window {
    api: unknown;
  }
}

let bench: ReturnType<typeof createBench> | undefined;

window.api = {
  checks: runChecks,
  hoverFixture,
  /** 挂载一个基准实例，返回挂载耗时 */
  mount(mode: Mode, rows: number) {
    bench = createBench(mode, rows);
    return bench.mountMs;
  },
  time: (name: string, times: number) => bench!.time(name, times),
  count: (name: string, times: number) => bench!.count(name, times),
  dispose: () => bench!.dispose(),
  scenarios: SCENARIOS,
  engineRun,
  precomputedRun: (table: Precomputed[]) => precomputedRun(table),
  engineStages,
};
