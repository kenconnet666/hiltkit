// 缺陷 008（待确认的设计取舍）：服务端渲染时子树抛错、输出了 fallback 的 Boundary，水合时子树在客户端同样抛错，
// 此时水合已经结束（错误是 renderEffect 里 handler 异步重跑的），fallback 是重新创建的：服务端输出的节点被整体换掉，
// 违反“水合 0 次 DOM 改动、节点不变”。
// 位置：03-publish/packages/runtime/index.js 的 Boundary()：出错 -> failure.value = { error } -> content 在水合之外重跑，走新建分支。
// node 16-fuzz/bugs/008-boundary-errored-on-server.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
import { Boundary } from '@hilt/runtime';
const explode = () => { throw new Error('boom'); };
const Bomb = _component(() => <u>{explode()}</u>);
export const Root = _component(({ slot }: any) => {
  (globalThis as any).__apis[slot] = { apply() {}, snapshot: () => ({}) };
  return <div id="root"><Boundary fallback={(e: any) => <i class="fb">fb</i>}><Bomb /></Boundary></div>;
});`;
const r = await runScenario({ source });
console.log('服务端 HTML：', r.html);
console.log({ error: r.hydrateError, mutations: r.mutations, sameNodes: r.sameNodes, errors: r.errors });
report(!r.mutations.length && r.sameNodes && !r.hydrateError, '出错边界水合 0 改动', '服务端已经降级成 fallback 的 Boundary，水合时 DOM 被重建');
