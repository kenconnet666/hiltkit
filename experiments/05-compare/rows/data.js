// 四个框架共用的确定性数据：同一个 id 序列、同一批 label，保证各版本渲染完全相同的内容。
const ADJECTIVES = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant'];
const COLOURS = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'white', 'black', 'orange'];
const NOUNS = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse'];

let nextId = 1;

/** 生成 n 行 `{ id, label }`，id 全局递增 */
export function buildData(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = nextId++;
    rows[i] = { id, label: `${ADJECTIVES[id % 12]} ${COLOURS[(id * 7) % 10]} ${NOUNS[(id * 13) % 12]}` };
  }
  return rows;
}

/** 构造 window.bench：各框架只需提供 7 个动作，数据约定（swap 哪两行等）统一写在这里 */
export function makeBench({ create, update, select, swap, remove, clear }) {
  return {
    create: (n = 1000) => create(buildData(n)),
    replace: (n = 1000) => create(buildData(n)),
    update, // 每 10 行（下标 0、10、20…）label 末尾追加 ' !!!'
    select, // select(i)：选中第 i 行
    swap: () => swap(1, 998), // 交换下标 1 与 998（framework 实现 swap(a, b)）
    remove, // remove(i)：删第 i 行
    clear,
  };
}
