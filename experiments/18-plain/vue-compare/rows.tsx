// 列表基准（05-compare/rows 的接口）。sig.raw 存列表，每行 label 一个 sig：和 Vue 版的 shallowRef 同口径
import { flushSync, For, mount, sig, type Sig } from 'hilt';
import { makeBench } from '../../05-compare/rows/data.js';

interface Row {
  id: number;
  label: Sig<string>;
}
const rows = sig.raw<Row[]>([]);
const selected = sig.raw<number | null>(null);
const toRow = ({ id, label }: { id: number; label: string }): Row => ({ id, label: sig.raw(label) });

function App() {
  return (
    <table>
      <tbody>
        <For each={rows}>
          {(row) => (
            <tr class={() => (selected() === row.id ? 'danger' : '')}>
              <td>{row.id}</td>
              <td><a onClick={() => selected.set(row.id)}>{row.label}</a></td>
              <td><a class="remove" onClick={() => rows.update((list) => list.filter((other) => other !== row))}>x</a></td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
mount(() => <App />, document.body.appendChild(document.createElement('div')));

const done = () => flushSync();
(window as any).bench = makeBench({
  create: (data: { id: number; label: string }[]) => {
    selected.set(null);
    rows.set(data.map(toRow));
    done();
  },
  update: () => {
    rows().forEach((row, index) => {
      if (index % 10 === 0) row.label.update((text) => `${text} !!!`);
    });
    done();
  },
  select: (index: number) => {
    selected.set(rows()[index]!.id);
    done();
  },
  swap: (a: number, b: number) => {
    const copy = rows().slice();
    [copy[a], copy[b]] = [copy[b]!, copy[a]!];
    rows.set(copy);
    done();
  },
  remove: (index: number) => {
    rows.set(rows().filter((_, i) => i !== index));
    done();
  },
  clear: () => {
    rows.set([]);
    done();
  },
});
