import { defaultClientConditions, defineConfig } from 'vite';
// 配置文件在 Node 里运行，这里按路径取插件：不用先构建框架
import { hiltDevtools, hiltHot } from '../../packages/core/src/vite/index.ts';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'hiltkit' } },
  // 解析到各包源码：改组件库不用先构建，这是大型组件库下开发速度的基础
  resolve: { conditions: ['@hiltkit/source', ...defaultClientConditions] },
  plugins: [hiltDevtools(), hiltHot()],
});
