/**
 * 水合状态：接管服务端 HTML 时，渲染层不建节点，而是沿着已有的 DOM 走一个游标。
 *
 * 属性层和渲染层都要知道“现在是不是在水合”，所以这个状态单独放在最底层，谁都不依赖。
 * 动态段在 HTML 里用注释 `<!--[-->` 和 `<!--]-->` 标出范围，游标靠它们跳过或进入一段。
 */

/** 正在接管服务端输出：属性写入只记状态，不碰 DOM */
export let hydrating = false;
export const setHydrating = (value: boolean): void => {
  hydrating = value;
};

/** 正在接管服务端输出：这时读到的值要和服务端一致，只有浏览器才知道的值等挂载后再用 */
export const isHydrating = (): boolean => hydrating;

/** 下一个要认领的节点 */
export let cursor: Node | null = null;
export const setCursor = (node: Node | null): void => {
  cursor = node;
};

/** 这个节点是不是内容为 data 的注释 */
export const isMark = (node: Node | null, data: string): boolean =>
  node?.nodeType === 8 && (node as Comment).data === data;

/** 找到和这个 `[` 配对的 `]`：中间可能嵌套别的动态段 */
export function closeOf(open: Node): Node {
  let depth = 0;
  for (let node = open.nextSibling; node; node = node.nextSibling) {
    if (isMark(node, '[')) depth++;
    else if (isMark(node, ']') && depth-- === 0) return node;
  }
  throw new Error('水合：动态段没有结束标记');
}
