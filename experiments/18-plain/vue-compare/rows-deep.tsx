// 列表基准：默认深代理的写法，不用 sig.raw，行就是普通对象。最省事的写法，看要付多少
import { flushSync, For, mount, sig } from 'hilt';
import { makeBench } from '../../05-compare/rows/data.js';

interface Row {
  id: number;
  label: string;
}
const rows = sig<Row[]>([]);
const selected = sig<number | null>(null);

function App() {
  return (
    <table>
      <tbody>
        <For each={rows}>
          {(row) => (
            <tr class={() => (selected() === row.id ? 'danger' : '')}>
              <td>{row.id}</td>
              <td><a onClick={() => selected.set(row.id)}>{() => row.label}</a></td>
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
  create: (data: Row[]) => {
    selected.set(null);
    rows.set(data);
    done();
  },
  update: () => {
    rows().forEach((row, index) => {
      if (index % 10 === 0) row.label += ' !!!';
    });
    done();
  },
  select: (index: number) => {
    selected.set(rows()[index]!.id);
    done();
  },
  swap: (a: number, b: number) => {
    const list = rows();
    const first = list[a]!;
    list[a] = list[b]!;
    list[b] = first;
    done();
  },
  remove: (index: number) => {
    rows().splice(index, 1);
    done();
  },
  clear: () => {
    rows.set([]);
    done();
  },
});
