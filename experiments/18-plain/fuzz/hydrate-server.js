// 水合方向：Node 端渲染（和浏览器端用同一份 hydrate-build.tsx）
import { renderToString } from 'hilt';
import { build, makeState } from './hydrate-build.tsx';

export const render = (spec, init) => renderToString(() => build(spec, makeState(init)));
