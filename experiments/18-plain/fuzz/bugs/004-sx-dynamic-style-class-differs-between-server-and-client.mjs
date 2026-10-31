// 缺陷 004：sx 里带参数的样式（create({ bar: (width) => ({ width }) }) 的 styles.bar('10px')，或函数形式 () => styles.bar(width())）
// 服务端输出变量形式的类（xxyyls1 + style="--x-width:10px"），客户端从头挂载第一次渲染是另一个类（x1n8vaep，值烤进规则）；
// 静态的 styles.root、条件项 styles.active 两边一致。
// 后果：水合不写 DOM，元素上是服务端的类，引擎记着客户端的类。sx 里同时有条件项和这种样式时，水合之后切换条件，
//       元素的 class 根本不变（粗体永远不生效），和同样状态从头挂载的 class 不同。只有 bar 一项时，第一次值变化后才收敛。
// 位置：服务端 18-plain/hilt/index.ts settleSx -> config.sx；客户端 18-plain/hilt/css.ts prepare -> select(fn) -> 引擎 dynamic.ts。
//       归属（10-css/engine 还是 hilt 的这层胶水）需要你判断：编译路线用 bind 标记动态项，这里没有编译器，只能靠 select 的追踪。
// 现有 run.mjs 只看 computed style，没发现。
// 这个脚本：服务端 HTML -> 水合 -> 切换条件 -> 把 className 和“同样状态从头挂载”的比。
// node 18-plain/fuzz/bugs/004-sx-dynamic-style-class-differs-between-server-and-client.mjs
import { client, server, verdict } from '../lib/repro.mjs';

const app = `
import { create } from 'hilt/css';
import { sig } from 'hilt';
export const styles = create({ active: { fontWeight: 700 }, bar: (width) => ({ width }) });
export const view = (on) => () => <div id="t" sx={[() => on() && styles.active, () => styles.bar('10px')]} />;
`;
const html = await server(`
${app}
import { renderToString } from 'hilt';
export const render = () => renderToString(view(sig(false)));
`);
const { result, errors } = await client(
  `
${app}
import { flushSync, hydrate, mount } from 'hilt';
const on = sig(false);
const target = document.getElementById('app');
const serverClass = document.getElementById('t').className;
hydrate(view(on), target);
const hydratedClass = document.getElementById('t').className;
on.set(true);
flushSync();
const afterToggle = document.getElementById('t').className;
const fresh = document.createElement('div');
document.body.append(fresh);
mount(view(sig(true)), fresh);
window.result = { serverClass, hydratedClass, afterToggle, freshWhenOn: fresh.firstElementChild.className };
`,
  { html: `<div id="app">${html}</div>` },
);
console.log(html, result, errors);
const sameFirstPaint = new RegExp(`class="${result.freshWhenOn.split(' ')[0]}`).test(html);
void sameFirstPaint;
const stale = result.afterToggle !== result.freshWhenOn;
verdict(!stale, '水合后切换条件，类和从头挂载的一致', `水合后切换条件：${JSON.stringify(result.afterToggle)}，同样状态从头挂载：${JSON.stringify(result.freshWhenOn)}（服务端原有的类 ${JSON.stringify(result.serverClass)}）`);
