import { nextTick, shallowRef } from 'vue';

// vapor36 与 vdom35 共用：构建时 'vue' 分别指向 3.6 与 3.5
export const rows = shallowRef([]);
export const selected = shallowRef(null);

const toRow = ({ id, label }) => ({ id, label: shallowRef(label) });

export const select = (id) => (selected.value = id);
export const removeById = (id) => (rows.value = rows.value.filter((r) => r.id !== id));

// Vue 的更新在微任务里刷新，动作返回 nextTick() 让计时端等到 DOM 更新完
export const actions = {
  create(data) {
    selected.value = null;
    rows.value = data.map(toRow);
    return nextTick();
  },
  update() {
    rows.value.forEach((row, i) => i % 10 === 0 && (row.label.value += ' !!!'));
    return nextTick();
  },
  select(i) {
    selected.value = rows.value[i].id;
    return nextTick();
  },
  swap(a, b) {
    const copy = rows.value.slice();
    [copy[a], copy[b]] = [copy[b], copy[a]];
    rows.value = copy;
    return nextTick();
  },
  remove(i) {
    rows.value = rows.value.filter((_, index) => index !== i);
    return nextTick();
  },
  clear() {
    rows.value = [];
    return nextTick();
  },
};
