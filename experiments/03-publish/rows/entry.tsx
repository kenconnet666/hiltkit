// 原型版的列表基准：写法用符文，接口同 05-compare/rows。
import { For, mount, selector, signal } from '@hilt/runtime';
import { makeBench } from '../../05-compare/rows/data.js';

let rows = _state([]);
let selected = _state(null);
const isSelected = selector(() => selected);

const toRow = ({ id, label }) => ({ id, label: signal(label) });

const App = _component(() => (
  <table>
    <tbody>
      <For each={rows}>
        {(row) => (
          <tr class={isSelected(row.id) ? 'danger' : ''}>
            <td>{row.id}</td>
            <td>
              <a onClick={() => (selected = row.id)}>{row.label.value}</a>
            </td>
            <td>
              <a class="remove" onClick={() => (rows = rows.filter((r) => r.id !== row.id))}>
                x
              </a>
            </td>
          </tr>
        )}
      </For>
    </tbody>
  </table>
));

mount(() => <App />, document.body);

window.bench = makeBench({
  create: (data) => {
    selected = null;
    rows = data.map(toRow);
  },
  update: () => {
    rows.forEach((row, i) => {
      if (i % 10 === 0) (row.label.value = `${row.label.value} !!!`);
    });
  },
  select: (i) => (selected = rows[i].id),
  swap: (a, b) => {
    const copy = rows.slice();
    [copy[a], copy[b]] = [copy[b], copy[a]];
    rows = copy;
  },
  remove: (i) => (rows = rows.filter((_, index) => index !== i)),
  clear: () => (rows = []),
});
