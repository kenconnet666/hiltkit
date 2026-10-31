// 最小化：用例都是可 JSON 序列化的数据。失败时反复尝试“删一个数组元素 / 删一个键 / 用子节点顶替整个节点 / 把标量换成更简单的值”，
// 只要还以同样的方式失败（kind 相同，避免缩着缩着变成另一个问题）就保留，直到没有可动的。
const clone = (value) => JSON.parse(JSON.stringify(value));
const isNode = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) && typeof value.t === 'string';

/** 一个节点的直接子节点（任何值里带 t 的对象，数组里的也算）：用它们顶替整个节点 */
function childNodes(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 't') continue;
    if (isNode(value)) out.push(value);
    else if (Array.isArray(value)) out.push(...value.filter(isNode));
  }
  return out;
}

/** 枚举所有可以动手的位置：[路径, 操作种类]。大块的先试（先 hoist、delete，最后才是标量） */
function* sites(value, path = [], omit = true) {
  if (isNode(value) && path.length && childNodes(value).length) yield [path, 'hoist'];
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) yield [[...path, i], 'delete'];
    for (let i = 0; i < value.length; i++) yield* sites(value[i], [...path, i], omit);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (omit && key !== 't') yield [[...path, key], 'omit'];
      yield* sites(value[key], [...path, key], omit);
    }
    for (const key of Object.keys(value))
      if (typeof value[key] !== 'object') yield [[...path, key], 'simplify'];
  }
}
const at = (root, path) => path.reduce((node, key) => node?.[key], root);

function simpler(value) {
  if (typeof value === 'number') return value === 0 ? [] : [0];
  if (typeof value === 'boolean') return value ? [false] : [];
  return [];
}

/**
 * recheck(case) 返回失败类别（通过返回 undefined）；budget 是最多重放次数；omit = false 时不删对象的键（用例的键都是必需字段时）。返回缩小后的用例。
 */
export async function shrink(original, recheck, kind, budget = 300, { omit = true } = {}) {
  let current = clone(original);
  let tries = 0;
  let progress = true;
  while (progress && tries < budget) {
    progress = false;
    for (const [path, how] of [...sites(current, [], omit)]) {
      if (tries >= budget) break;
      const parentPath = path.slice(0, -1);
      const last = path[path.length - 1];
      const parent = at(current, parentPath);
      if (parent === undefined || parent === null || !(last in Object(parent))) continue;
      const candidates = [];
      if (how === 'hoist') {
        for (const child of childNodes(parent[last])) {
          const copy = clone(current);
          at(copy, parentPath)[last] = clone(child);
          candidates.push(copy);
        }
      } else if (how === 'delete') {
        const copy = clone(current);
        at(copy, parentPath).splice(last, 1);
        candidates.push(copy);
      } else if (how === 'omit') {
        const copy = clone(current);
        delete at(copy, parentPath)[last];
        candidates.push(copy);
      } else {
        for (const replacement of simpler(parent[last])) {
          const copy = clone(current);
          at(copy, parentPath)[last] = replacement;
          candidates.push(copy);
        }
      }
      for (const candidate of candidates) {
        tries++;
        let result;
        try {
          result = await recheck(candidate);
        } catch {
          result = undefined;
        }
        if (result === kind) {
          current = candidate;
          progress = true;
          break;
        }
      }
      if (progress) break;
    }
  }
  return current;
}
