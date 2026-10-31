// 水合基准：1 万行列表，结构同 05-compare/rows
const makeRows = (n: number) => Array.from({ length: n }, (_, id) => ({ id, label: `row ${id}` }));

export const App = _component(({ n }) => {
  let rows = _state(makeRows(n));
  let selected = _state(-1);
  if (typeof window !== 'undefined') (window as any).setSelected = (next: number) => (selected = next);
  return (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr class={selected === row.id ? 'danger' : ''}>
            <td>{row.id}</td>
            <td>
              <a onClick={() => (selected = row.id)}>{row.label}</a>
            </td>
            <td>
              <a class="remove">x</a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});
