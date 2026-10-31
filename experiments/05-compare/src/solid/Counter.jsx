import { createMemo, createSignal, splitProps } from 'solid-js';

// 小组件：状态、派生、动态属性、透传 rest、children
export function Counter(props) {
  const [local, rest] = splitProps(props, ['label', 'children']);
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  return (
    <button {...rest} class={'btn ' + (doubled() > 4 ? 'big' : '')} data-doubled={doubled()} onClick={() => setCount((c) => c + 1)}>
      {local.label}: {count()} / {doubled()} {local.children}
    </button>
  );
}
