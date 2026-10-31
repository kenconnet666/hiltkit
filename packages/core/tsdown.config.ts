import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/jsx-runtime.ts', 'src/jsx-dev-runtime.ts'],
  format: 'esm',
  platform: 'neutral',
  unbundle: true,
  // 类型由 tsc 生成，和仓库检查用的是同一个编译器
  dts: false,
});
