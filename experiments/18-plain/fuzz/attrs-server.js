// 属性方向：Node 端渲染（和浏览器端用同一份 attrs-build.js）
import { renderToString } from 'hilt';
import 'hilt/css';
import { buildView, makeState } from './attrs-build.js';

export const render = (spec, init) => renderToString(() => buildView(spec, makeState(init), { log: [], refs: {} }));
