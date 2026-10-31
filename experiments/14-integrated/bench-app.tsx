// 同一份源码，分别用旧原型和合并版编译：只用两边都有的写法（不用 sx）
import { flushSync, mount } from '@hilt/runtime';

// ---- 三层按钮：组件库的典型形态 ----
const BaseButton = _component(({ children, ...rest }: any) => (
  <button class="base" data-part="root" {...rest}>
    {children}
  </button>
));
const Button = _component(({ size = 'md', loading = false, children, ...rest }: any) => (
  <BaseButton class={`btn btn-${size}`} aria-busy={loading ? 'true' : 'false'} {...rest}>
    {children}
  </BaseButton>
));
const noop = () => {};
const ButtonRow = _component(({ index, title }: any) => (
  <Button id={`b${index}`} class="user" title={title} onClick={noop}>
    保存
  </Button>
));
const Buttons = _component(({ count }: any) => {
  let title = _state('a');
  (window as any).setTitle = (next: string) => (title = next);
  const rows = _state.raw(Array.from({ length: count }, (_, index) => index));
  return <div>{rows.map((index) => <ButtonRow index={index} title={title} />)}</div>;
});

// ---- 表单字段：context + 内容类 prop + 条件 ----
const Field = _component(({ label, invalid = false, description, children }: any) => (
  <div class={invalid ? 'field invalid' : 'field'}>
    <label>{label}</label>
    {children}
    {description && <p>{description}</p>}
  </div>
));
const Fields = _component(({ count }: any) => {
  let invalid = _state(false);
  (window as any).setInvalid = (next: boolean) => (invalid = next);
  const rows = _state.raw(Array.from({ length: count }, (_, index) => index));
  return (
    <form>
      {rows.map((index) => (
        <Field label={`字段 ${index}`} invalid={invalid} description={index % 2 ? '说明' : undefined}>
          <input name={`f${index}`} />
        </Field>
      ))}
    </form>
  );
});

// ---- 行列表（js-framework-benchmark 的操作）：行用深代理 ----
let nextId = 1;
const makeRows = (count: number) => Array.from({ length: count }, () => ({ id: nextId++, label: `row ${nextId}`, selected: false }));
const Rows = _component(() => {
  let rows = _state<any[]>([]);
  (window as any).rowsApi = {
    create: (count: number) => (rows = makeRows(count)),
    updateEvery: (step: number) => {
      for (let i = 0; i < rows.length; i += step) rows[i].label += '!';
    },
    selectRow: (index: number) => (rows[index].selected = !rows[index].selected),
    swap: () => {
      const a = rows[1];
      rows[1] = rows[rows.length - 2];
      rows[rows.length - 2] = a;
    },
    removeOne: () => rows.splice(1, 1),
    clear: () => (rows = []),
  };
  return (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr class={row.selected ? 'danger' : ''}>
            <td>{row.id}</td>
            <td><a onClick={noop}>{row.label}</a></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

// ---- 深层嵌套：每层一个条件分支，改最里面的文字。量 owner 链长了之后的通知成本 ----
const Nest = _component(({ depth, value }: any): any =>
  depth === 0 ? <b id="leaf">{value}</b> : <div>{depth > 0 && <Nest depth={depth - 1} value={value} />}</div>,
);
const Deep = _component(({ depth }: any) => {
  let value = _state(0);
  (window as any).setDeep = (next: number) => (value = next);
  return <Nest depth={depth} value={value} />;
});

(window as any).benchApi = {
  flushSync,
  mountButtons: (count: number) => mount(() => <Buttons count={count} />, document.body),
  mountFields: (count: number) => mount(() => <Fields count={count} />, document.body),
  mountRows: () => mount(() => <Rows />, document.body),
  mountDeep: (depth: number) => mount(() => <Deep depth={depth} />, document.body),
};
