import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/css/index.ts',
    'src/devtools/index.ts',
    'src/vite/index.ts',
    'src/jsx-runtime.ts',
    'src/jsx-dev-runtime.ts',
  ],
  format: 'esm',
  platform: 'neutral',
  // 一个模块一个文件：使用方能摇树，不用样式时引擎不进包
  unbundle: true,
  deps: { neverBundle: [/^node:/, 'vite'] },
  // 类型由 tsc 生成，和仓库检查用的是同一个编译器
  dts: false,
});
