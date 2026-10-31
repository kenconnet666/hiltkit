import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'hiltkit' } },
  // 解析到各包源码：改组件库不用先构建，这是大型组件库下开发速度的基础
  resolve: { conditions: ['@hiltkit/source', ...defaultClientConditions] },
});
