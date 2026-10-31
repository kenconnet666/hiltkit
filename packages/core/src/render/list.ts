/**
 * 列表 `For`：只在数组变了时对比，同一行复用，移动的只有该动的那些节点。
 *
 * 每行一个作用域：行里的 effect、onCleanup 跟着行走，删行就销毁。
 * 没给 by 时按项本身的身份复用，行函数拿到的是值；给了 by 时同键复用，行函数拿到读取函数（项可以换）。
 */
import { closeOf, cursor, hydrating, isMark, setCursor } from '../hydration';
import {
  devHooks,
  dispose,
  getContext,
  getOwner,
  renderEffect,
  runSetup,
  runWith,
  scope,
  signal,
  untrack,
  type EffectNode,
  type SignalNode,
} from '../reactivity/kernel';
import { read, type Prop, type ReadSig } from '../reactivity/sig';
import { renderValue } from './render';
import { Custom } from './vnode';

/** 最长递增子序列：这些行不用动，其余的才移动，移动次数最少 */
function longestIncreasing(values: number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    if (values[i]! < 0) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]!]! < values[i]!) low = middle + 1;
      else high = middle;
    }
    previous[i] = low > 0 ? tails[low - 1]! : -1;
    tails[low] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = previous[i]!) keep.add(i);
  return keep;
}
/** 同键出现多次（没给 by 时重复的值）：后面的各算一行，不能互相覆盖 */
const duplicateKeys = new Map<unknown, object[]>();
function rowKey(key: unknown, seen: Map<unknown, number>): unknown {
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  if (!count) return key;
  let list = duplicateKeys.get(key);
  if (!list) duplicateKeys.set(key, (list = []));
  return (list[count - 1] ??= {});
}

interface Row {
  /** 行记首尾两个节点：行内的动态段会增减节点，但有自己的起止标记，范围不变 */
  first: Node;
  last: Node;
  scope: EffectNode;
  item: SignalNode<unknown> | undefined;
  index: SignalNode<number>;
}
function rowNodes(row: Row): Node[] {
  const nodes: Node[] = [];
  for (let node: Node | null = row.first; node; node = node === row.last ? null : node.nextSibling)
    nodes.push(node);
  return nodes;
}

interface ListProps<T> {
  each: Prop<readonly T[]>;
  children: (item: T, index: ReadSig<number>) => unknown;
}
interface KeyedProps<T> {
  each: Prop<readonly T[]>;
  /** 标准 JSX 把 key 拿走给框架用，到不了 props，所以这里叫 by */
  by: (item: T) => unknown;
  children: (item: ReadSig<T>, index: ReadSig<number>) => unknown;
}
/** 列表：没给 by 按身份复用，item 是值；给了 by 同键复用，item 和下标都是读取函数 */
export function For<T>(props: KeyedProps<T>): unknown;
export function For<T>(props: ListProps<T>): unknown;
export function For(props: any): unknown {
  const keyOf = props.by;
  const render = props.children;
  return new Custom(
    (parent, before, svg) => {
      let start: Node;
      let end: Node;
      const adopting = hydrating;
      if (adopting) {
        start = cursor!;
        end = closeOf(start);
      } else {
        start = document.createComment('[');
        end = document.createComment(']');
        parent.insertBefore(start, before);
        parent.insertBefore(end, before);
      }
      let rows = new Map<unknown, Row>();
      let order: Row[] = [];
      const owner = getOwner();
      const saved = getContext();
      let first = adopting;
      const createRow = (item: unknown, index: number, target: Node, anchor: Node): Row => {
        const row = { item: keyOf ? signal(item) : undefined, index: signal(index) } as Row;
        // 行函数在行的作用域里执行，当组件体对待：onCleanup、effect 属于这一行，直接读 count() 也有开发期提示
        const renderRow = (host: Node, at: Node | null) =>
          runSetup(
            () =>
              renderValue(
                render(keyOf ? () => row.item!.value : item, () => row.index.value),
                host,
                at,
                svg,
              ),
            undefined,
          );
        if (first) {
          const from = cursor!;
          row.scope = runWith(owner, saved, () => scope(() => renderRow(target, anchor)));
          // 行什么都没渲染：服务端放了一个空注释占位
          if (cursor === from && isMark(cursor, '')) setCursor(cursor.nextSibling);
          row.first = from;
          row.last = cursor!.previousSibling!;
        } else {
          // 直接插到列表里，不经过每行一个的片段：实测建 1 万行少约 10% 脚本时间
          const previous = anchor.previousSibling;
          row.scope = runWith(owner, saved, () => scope(() => renderRow(target, anchor)));
          if (anchor.previousSibling === previous)
            target.insertBefore(document.createComment(''), anchor);
          row.first = previous ? previous.nextSibling! : target.firstChild!;
          row.last = anchor.previousSibling!;
        }
        return row;
      };
      devHooks?.label('list', parent);
      renderEffect(() => {
        const items: readonly unknown[] = [...read<readonly unknown[]>(props.each)];
        untrack(() => {
          const target = end.parentNode!;
          if (first) {
            setCursor(start.nextSibling);
            const seen = new Map<unknown, number>();
            items.forEach((item, index) =>
              rows.set(
                rowKey(keyOf ? keyOf(item) : item, seen),
                createRow(item, index, target, end),
              ),
            );
            order = [...rows.values()];
            first = false;
            setCursor(end.nextSibling);
            return;
          }
          let reused = 0;
          const next = new Map<unknown, Row>();
          const seen = new Map<unknown, number>();
          items.forEach((item, index) => {
            const key = rowKey(keyOf ? keyOf(item) : item, seen);
            let row = rows.get(key);
            if (row) {
              reused++;
              rows.delete(key);
              row.index.value = index;
              if (row.item) row.item.value = item;
            } else {
              row = createRow(item, index, target, end);
            }
            next.set(key, row);
          });
          for (const row of rows.values()) {
            for (const node of rowNodes(row)) target.removeChild(node);
            dispose(row.scope);
          }
          // 新行已经按顺序插在 end 前面。一行都没复用（首次建、整体替换）就不用算移动，否则每行都要再插一遍
          if (!reused) {
            order = [...next.values()];
            rows = next;
            return;
          }
          const before2 = new Map<Row, number>();
          order.forEach((row, index) => before2.set(row, index));
          const list = [...next.values()];
          const keep = longestIncreasing(list.map((row) => before2.get(row) ?? -1));
          let anchor: Node = end;
          for (let i = list.length - 1; i >= 0; i--) {
            const row = list[i]!;
            if (!keep.has(i)) for (const node of rowNodes(row)) target.insertBefore(node, anchor);
            anchor = row.first;
          }
          order = list;
          rows = next;
        });
      });
      if (adopting && first) setCursor(end.nextSibling);
    },
    (toHtml) => {
      const items: readonly unknown[] = read<readonly unknown[]>(props.each);
      let out = '';
      let lastWasText = false;
      items.forEach((item, index) => {
        const position = () => index;
        const value = render(keyOf ? () => item : item, position);
        const html = toHtml(value);
        const isText = typeof value === 'string' || typeof value === 'number';
        // 相邻行的文字解析时会合成一个节点，空行也要占位，否则水合认领不出每一行
        if (html === '' || (isText && lastWasText)) out += '<!---->';
        out += html;
        lastWasText = isText && html !== '';
      });
      return `<!--[-->${out}<!--]-->`;
    },
  );
}
