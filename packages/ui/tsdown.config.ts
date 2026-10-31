import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/locale/zh-CN.ts'],
  format: 'esm',
  platform: 'neutral',
  // 一个组件一个文件：使用方按需摇树，也不需要重新编译
  unbundle: true,
  // 类型由 tsc 生成，和仓库检查用的是同一个编译器
  dts: false,
});
