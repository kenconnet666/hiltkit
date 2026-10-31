import { flushSync } from 'svelte';

class Row {
  id;
  label = $state('');
  constructor({ id, label }) {
    this.id = id;
    this.label = label;
  }
}

// rows 只整体替换，用 $state.raw 避免深层代理
let rows = $state.raw([]);
let selected = $state(null);

export const getRows = () => rows;
export const getSelected = () => selected;
export const select = (id) => (selected = id);
export const removeById = (id) => (rows = rows.filter((r) => r.id !== id));

export const actions = {
  create(data) {
    selected = null;
    rows = data.map((d) => new Row(d));
    flushSync(); // Svelte 默认微任务里才刷新，这里同步刷新，与其他框架的计时口径一致
  },
  update() {
    for (let i = 0; i < rows.length; i += 10) rows[i].label += ' !!!';
    flushSync();
  },
  select(i) {
    selected = rows[i].id;
    flushSync();
  },
  swap(a, b) {
    const copy = rows.slice();
    [copy[a], copy[b]] = [copy[b], copy[a]];
    rows = copy;
    flushSync();
  },
  remove(i) {
    rows = rows.filter((_, index) => index !== i);
    flushSync();
  },
  clear() {
    rows = [];
    flushSync();
  },
};
