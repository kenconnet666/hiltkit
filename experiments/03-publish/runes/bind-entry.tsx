// _bindable 声明、_bind 绑定：组件和原生元素同一种写法。
import { flushSync, mount, warnings } from '@hilt/runtime';

(window as any).flushSync = flushSync;
(window as any).warnings = warnings;
const log: Record<string, any> = { notified: [], built: 0 };
(window as any).log = log;

const Input = _component(({ value = _bindable('默认'), ...rest }) => <input {...rest} value={_bind(value)} />);

// 默认值是对象：和 _state 一样深代理
const Tags = _component(({ tags = _bindable<string[]>(['a']), id }) => {
  (window as any)[`${id}Add`] = (tag: string) => tags.push(tag);
  (window as any)[`${id}Replace`] = (next: string[]) => (tags = next);
  return <p id={id}>{tags.join(',')}</p>;
});

// _bindable.raw：不代理，只有整体替换才更新
const Rows = _component(({ rows = _bindable.raw<number[]>([1]), id }) => {
  (window as any)[`${id}Push`] = () => rows.push(9);
  (window as any)[`${id}Replace`] = (next: number[]) => (rows = next);
  return <p id={id}>{rows.join(',')}</p>;
});

// 默认值只求一次：组件自己的初始状态，不跟其他 prop 走
const Once = _component(({ seed, count = _bindable(seed * 2), id }) => {
  log.built++;
  return <p id={id} onClick={() => count++}>{count}</p>;
});

// 不声明 value：_bind 经 rest 转交，落到原生元素上也要接上
const TextBox = _component(({ ...rest }) => <input class="text" {...rest} />);
// 两层转交
const Outer = _component(({ ...rest }) => <TextBox {...rest} />);
// 只读 prop：绑上去要查得出来
const ReadOnly = _component(({ size }) => <i id="readonly">{size}</i>);

const App = _component(() => {
  let bound = _state('父');
  let boundTags = _state<string[]>(['x']);
  let seed = _state(1);
  let notifying = _state('n');
  let rejected = _state('稳');
  let forwarded = _state('转');
  let forwarded2 = _state('二');

  // 原生
  let plain = _state('p');
  let trimmed = _state('');
  let lazy = _state('');
  let amount = _state(1);
  let forced = _state(0);
  let flag = _state(false);
  let picked = _state<string[]>(['a']);
  let chosen = _state('b');
  let area = _state('t');
  let opened = _state(false);
  let files = _state<FileList | null>(null);
  const form = _state({ name: 'f', rows: [{ qty: 'q' }] });
  let optimistic = _derived(plain);

  (window as any).api = {
    read: () => ({
      bound, boundTags: [...boundTags], notifying, rejected, forwarded, forwarded2, plain, trimmed, lazy, amount, forced, flag,
      picked: [...picked], chosen, area, opened, files: files?.length ?? 0, name: form.name, qty: form.rows[0].qty, optimistic,
    }),
    setBound: (next: string) => (bound = next),
    setSeed: (next: number) => (seed = next),
    setPlain: (next: string) => (plain = next),
    setAmount: (next: number) => (amount = next),
    setFlag: (next: boolean) => (flag = next),
    setPicked: (next: string[]) => (picked = next),
    setOpened: (next: boolean) => (opened = next),
  };

  return (
    <main>
      <Input id="free" />
      <Input id="bound" value={_bind(bound)} />
      <Input id="initial" value="只给初值" />
      <Input id="notify" value={_bind(notifying)} onValueChange={(next: string) => log.notified.push(next)} />
      <Input id="reject" value={rejected} onValueChange={() => {}} />
      <Tags id="ownTags" />
      <Tags id="boundTags" tags={_bind(boundTags)} />
      <Rows id="ownRows" />
      <Once id="once" seed={seed} />
      <TextBox id="forward" value={_bind(forwarded)} />
      <Outer id="forward2" value={_bind(forwarded2)} />

      <input id="plain" value={_bind(plain)} />
      <input id="trim" value={_bind.trim(trimmed)} />
      <input id="lazy" value={_bind.lazy(lazy)} />
      <input id="amount" type="number" value={_bind(amount)} />
      <input id="forced" value={_bind.number(forced)} />
      <input id="flag" type="checkbox" checked={_bind(flag)} />
      <input id="group-a" type="checkbox" value="a" checked={_bind.group(picked)} />
      <input id="group-b" type="checkbox" value="b" checked={_bind.group(picked)} />
      <select id="select" value={_bind(chosen)}>
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
      <textarea id="area" value={_bind(area)} />
      <details id="details" open={_bind(opened)}>
        <summary>摘要</summary>
      </details>
      <input id="file" type="file" files={_bind(files)} />
      <input id="field" value={_bind(form.name)} />
      <input id="cell" value={_bind(form.rows[0].qty)} />
      <input id="override" value={_bind(optimistic)} />
      <input id="oneway" value={plain} />
    </main>
  );
});

mount(() => <App />, document.body);

(window as any).mountReadOnly = () => {
  const host = document.createElement('div');
  document.body.append(host);
  const Wrong = _component(() => {
    let size = _state('md');
    return <ReadOnly size={_bind(size)} />;
  });
  mount(() => <Wrong />, host);
};
