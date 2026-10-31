// 最小化：用例都是可 JSON 序列化的数据。失败时反复尝试“删一个数组元素 / 把子树换成更简单的值”，
// 只要还以同样的方式失败就保留，直到没有可删的。同样的方式 = failureKind 相同（避免缩着缩着变成另一个问题）。
const clone = (value) => JSON.parse(JSON.stringify(value));

/** 节点的子节点（水合用例的树）：用某个子节点顶替整个节点 */
const childNodes = (node) => [...(node.kids ?? []), node.a, node.b].filter((child) => child && typeof child === 'object' && child.t);

/** 枚举所有可以动手的位置：[路径, 操作种类] */
function* sites(value, path = []) {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.t === 'string' && childNodes(value).length && path.length) yield [path, 'hoist'];
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) yield [[...path, i], 'delete'];
    for (let i = 0; i < value.length; i++) yield* sites(value[i], [...path, i]);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      yield [[...path, key], 'simplify'];
      yield* sites(value[key], [...path, key]);
    }
  }
}
const at = (root, path) => path.reduce((node, key) => node?.[key], root);

/** 把 path 处的值换成更简单的几种候选 */
function simpler(value) {
  if (typeof value === 'number') return value === 0 ? [] : [0];
  // 字符串不动：里面多半是枚举（种类、操作名），缩成别的值会变成另一个用例
  if (typeof value === 'boolean') return value ? [false] : [];
  if (Array.isArray(value)) return value.length ? [[]] : [];
  if (value && typeof value === 'object') return [];
  return [];
}

/**
 * fails(case) 返回失败类别字符串（通过则返回 undefined）。budget 是最多尝试次数。
 * 返回缩小后的用例。
 */
export async function shrink(original, fails, kind, budget = 400) {
  let current = clone(original);
  let tries = 0;
  let progress = true;
  while (progress && tries < budget) {
    progress = false;
    for (const [path, how] of [...sites(current)]) {
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
          result = await fails(candidate);
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
