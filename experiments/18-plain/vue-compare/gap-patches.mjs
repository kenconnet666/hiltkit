// 差距实验的优化原型：构建时改源码，不动 18-plain/hilt，每项能单独开关、单独计量。
// 这里只留还没采纳的；采纳的（不重复插入、不用行片段、文字用 textContent、转义和 class 快路径）已经进了源码。
import { readFile } from 'node:fs/promises';

/** 按文件路径后缀找到补丁，逐条替换；原文对不上就报错，避免量到没生效的版本 */
function patchPlugin(table, names) {
  return {
    name: 'gap-patches',
    setup(b) {
      const selected = names.map((name) => {
        if (!table[name]) throw new Error(`没有这个补丁：${name}`);
        return table[name];
      });
      b.onLoad({ filter: /[\\/](index\.ts|server\.ts|server\.js|reactive\.js)$/ }, async ({ path }) => {
        let text = await readFile(path, 'utf8');
        let touched = false;
        for (const edits of selected) {
          for (const [suffix, from, to] of edits) {
            if (!path.replaceAll('\\', '/').endsWith(suffix)) continue;
            if (!text.includes(from)) throw new Error(`补丁原文对不上：${suffix}: ${from.slice(0, 60)}`);
            text = text.replace(from, to);
            touched = true;
          }
        }
        return touched ? { contents: text, loader: path.endsWith('.ts') ? 'ts' : 'js' } : undefined;
      });
    },
  };
}

const INDEX = '18-plain/hilt/index.ts';
const SERVER = '18-plain/hilt/server.ts';

/** 没人用过 dynamic() 就不用查 symbol：getOwnPropertySymbols 每个元素都分配一个数组。收益小，又多一个全局状态，没采纳 */
const noSymbols = [
  [INDEX, 'export const dynamicSources = (props: any)', 'export let anyDynamic = false;\nexport const dynamicSources = (props: any)'],
  [INDEX, 'const symbols = Object.getOwnPropertySymbols(props);\n  if (!symbols.length) return undefined;', 'if (!anyDynamic) return undefined;\n  const symbols = Object.getOwnPropertySymbols(props);\n  if (!symbols.length) return undefined;'],
  [INDEX, 'read2.$$dynamic = true;', 'read2.$$dynamic = true;\n  anyDynamic = true;'],
];

export const SERVER_PATCHES = {
  symbols: [...noSymbols, [SERVER, "import { Custom, VNode, dynamicSources, inApp, merge, setServerMode, settle } from './index';", "import { Custom, VNode, anyDynamic, dynamicSources, inApp, merge, setServerMode, settle } from './index';"], [SERVER, 'if (SLOW_TAGS.has(tag) || Object.getOwnPropertySymbols(props).length) return slowElement(tag, props);', 'if (SLOW_TAGS.has(tag) || (anyDynamic && Object.getOwnPropertySymbols(props).length)) return slowElement(tag, props);']],
};
export const serverPatches = (names) => patchPlugin(SERVER_PATCHES, names);

export const CLIENT_PATCHES = {
  // 点击事件委托到 document（Vapor 没做，Solid 做了）。stopPropagation 的时机会变，是语义改动，这里只量收益
  delegate: [
    [
      INDEX,
      "    const info = eventOf(key);\n    const type = info.exact ??",
      "    if (key === 'onClick') {\n      if (!clickInstalled) {\n        clickInstalled = true;\n        document.addEventListener('click', (event) => {\n          for (let node: any = event.target; node && !event.cancelBubble; node = node.parentNode) node.$$click?.(event);\n        });\n      }\n      el.$$click = value;\n      return;\n    }\n    const info = eventOf(key);\n    const type = info.exact ??",
    ],
    [INDEX, 'function applyProp(el: any, key: string, value: any, tag: string) {', 'let clickInstalled = false;\nfunction applyProp(el: any, key: string, value: any, tag: string) {'],
  ],
  symbols: noSymbols,
};
export const clientPatches = (names) => patchPlugin(CLIENT_PATCHES, names);
