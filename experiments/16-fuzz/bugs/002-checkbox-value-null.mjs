// 缺陷 002：复选框 / 单选框上 value 为 null / undefined（或被动态层撤掉）时，客户端写出 value=""，
// 服务端和“没写 value”的元素都没有这个 attribute，提交的值也从 "on" 变成了 ""。
// 位置：03-publish/packages/runtime/attrs.js 的 attrValue()：null 分支对所有 input 都 `el.value = ''`，
// 而 type=checkbox / radio / hidden / image / button / submit / reset 的 value 是 "default/on" 模式，赋值会写回 attribute。
// node 16-fuzz/bugs/002-checkbox-value-null.mjs
import { fileURLToPath } from 'node:url';
import { runInBrowser } from '../lib/page.mjs';

const runtime = fileURLToPath(new URL('../../03-publish/packages/runtime/index.js', import.meta.url));
const server = fileURLToPath(new URL('../../03-publish/packages/runtime/server.js', import.meta.url));
const { result } = await runInBrowser(
  `import { spread } from ${JSON.stringify(runtime)};
   import { ssrSpread } from ${JSON.stringify(server)};
   const el = document.createElement('input');
   el.type = 'checkbox';
   spread(el, { value: null });
   const plain = document.createElement('input');
   plain.type = 'checkbox';
   const box = document.createElement('div');
   box.innerHTML = '<input type="checkbox"' + ssrSpread({ value: null }, 'input') + '>';
   window.result = { client: [el.getAttribute('value'), el.value], noValue: [plain.getAttribute('value'), plain.value], ssr: [box.firstChild.getAttribute('value'), box.firstChild.value] };`,
  import.meta.dirname,
);
console.log(JSON.stringify(result));
const bad = result.client[0] !== null;
console.log(bad ? 'FAIL 客户端 value=null 写出了 value=""（服务端和不写 value 的元素都没有）' : 'ok');
process.exitCode = bad ? 1 : 0;
