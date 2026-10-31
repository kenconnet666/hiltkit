// 可复现的随机数：mulberry32，种子相同序列相同。所有生成器只从这里取随机。
export function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    /** [0, n) 的整数 */
    int: (n) => Math.floor(next() * n),
    /** [lo, hi] 的整数 */
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** 按权重挑：[[值, 权重], ...] */
    weighted(pairs) {
      let total = 0;
      for (const [, weight] of pairs) total += weight;
      let at = next() * total;
      for (const [value, weight] of pairs) if ((at -= weight) < 0) return value;
      return pairs[pairs.length - 1][0];
    },
    shuffle(list) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** 不重复地取 count 个 */
    sample: (list, count) => rng.shuffle(list).slice(0, count),
  };
  return rng;
}

/** 方向名 + 序号 -> 种子：不同方向互不相关，同一个序号永远得到同一个种子 */
export function seedFor(direction, index) {
  let hash = 2166136261;
  for (const char of `${direction}:${index}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
