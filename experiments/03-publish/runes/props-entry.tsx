// 解构和整体 props 能否并存；顶层读被诊断抓到；转交。
import { flushSync, mount, warnings } from '@hilt/runtime';

(window as any).flushSync = flushSync;
(window as any).warnings = warnings;

// 解构
const ByDestructure = _component(({ id = 'destructure', value, size = 'md' }) => <p id={id} data-size={size}>{value}</p>);
// 整体 props：读属性就是活的
const ByProps = _component((props) => <p id="props" data-size={props.size ?? 'md'}>{props.value}</p>);
// 整体 props 直接交给组合式函数、转交给下一层
function useLabel(options: { value: string }) {
  return { get text() { return `标签:${options.value}`; } };
}
const Composed = _component((props) => {
  const label = useLabel(props);
  return <p id="composed">{label.text}</p>;
});
const Forwarded = _component((props) => <ByDestructure {...props} />);
// 解构的 rest 同样能交给组合式函数
const RestToHook = _component(({ size, ...rest }) => {
  const label = useLabel(rest);
  return <p id="rest-hook" data-size={size}>{label.text}</p>;
});
// 顶层读：只拿到当前值，诊断要抓到
const ReadsAtTop = _component(({ value }) => {
  const snapshot = value;
  return <p id="top-read">{snapshot}</p>;
});

const App = _component(() => {
  let value = _state('a');
  let size = _state('sm');
  (window as any).setValue = (next: string) => (value = next);
  (window as any).setSize = (next: string) => (size = next);
  return (
    <main>
      <ByDestructure value={value} size={size} />
      <ByProps value={value} size={size} />
      <Composed value={value} />
      <Forwarded id="forwarded" value={value} size={size} />
      <RestToHook value={value} size={size} />
    </main>
  );
});

mount(() => <App />, document.body);
(window as any).mountTopRead = () => {
  const host = document.createElement('div');
  document.body.append(host);
  const Host = _component(() => {
    let value = _state('初值');
    (window as any).setTop = (next: string) => (value = next);
    return <ReadsAtTop value={value} />;
  });
  mount(() => <Host />, host);
};
