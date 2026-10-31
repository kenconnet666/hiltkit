import { createSelector, createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { makeBench } from '../data.js';

// 每行：id 不变，label 是自己的 signal
const [rows, setRows] = createSignal([]);
const [selected, setSelected] = createSignal(null);

const toRow = ({ id, label }) => ({ id, label: createSignal(label) });

function App() {
  // krausest 的 Solid 实现同样用 createSelector，选中切换是 O(1)
  const isSelected = createSelector(selected);
  return (
    <table>
      <tbody>
        <For each={rows()}>
          {(row) => (
            <tr class={isSelected(row.id) ? 'danger' : ''}>
              <td>{row.id}</td>
              <td>
                <a onClick={() => setSelected(row.id)}>{row.label[0]()}</a>
              </td>
              <td>
                <a class="remove" onClick={() => setRows((all) => all.filter((r) => r.id !== row.id))}>
                  x
                </a>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

render(App, document.body);

window.bench = makeBench({
  create: (data) => {
    setSelected(null);
    setRows(data.map(toRow));
  },
  update: () => {
    rows().forEach((row, i) => i % 10 === 0 && row.label[1]((text) => text + ' !!!'));
  },
  select: (i) => setSelected(rows()[i].id),
  swap: (a, b) => {
    const copy = rows().slice();
    [copy[a], copy[b]] = [copy[b], copy[a]];
    setRows(copy);
  },
  remove: (i) => setRows((all) => all.filter((_, index) => index !== i)),
  clear: () => setRows([]),
});
