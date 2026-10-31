// value={_bind(x)}：prop 不再有下划线，全程就是元素和组件自己的属性名。
declare global {
  interface BindRune {
    <T>(target: T): T;
    trim: BindRune;
    lazy: BindRune;
    number: BindRune;
    group<T>(list: T[]): boolean;
  }
  const _bind: BindRune;
}

interface InputProps {
  /** 输入框的值，可以用 _bind 绑定 */
  value?: string;
  /** 值变化时通知 */
  onValueChange?: (next: string) => void;
  size?: 'sm' | 'md';
}
export const Input = _component(({ value = _state(''), size = 'md' }: InputProps) => {
  const text: string = value;
  value = 'x';
  // @ts-expect-error 写入类型不对
  value = 1;
  return <input value={_bind(value)} class={text + size} />;
});

let name = _state('');
let count = _state(0);
let flag = _state(false);
let list = _state<string[]>([]);
let open = _state(false);
const form = _state({ name: '', rows: [{ qty: 1 }] });

export const usage = (
  <main>
    {/* 组件：值的类型由 prop 检查 */}
    <Input value={_bind(name)} />
    <Input value={name} />
    <Input value="字面量" />
    <Input value={_bind(name)} onValueChange={(next) => next.length} />
    <Input value={_bind(form.name)} />
    {/* @ts-expect-error 类型不对 */}
    <Input value={_bind(count)} />

    {/* 原生：还是原生属性 */}
    <input value={name} />
    <input value={_bind(name)} />
    <input value={_bind.trim(name)} />
    <input value={_bind.lazy.trim(name)} />
    <input type="number" value={_bind(count)} />
    <input type="checkbox" checked={_bind(flag)} />
    <input type="checkbox" value="a" checked={_bind.group(list)} />
    <details open={_bind(open)} />
    <select value={_bind(name)} />
    <textarea value={_bind(name)} />
    {/* @ts-expect-error div 没有 value */}
    <div value={_bind(name)} />
    {/* @ts-expect-error details 没有 checked */}
    <details checked={_bind(flag)} />
  </main>
);

// 类型层拦不住的，运行时诊断负责：绑到只读 prop 不报类型错
export const readOnlyNotCaught = <Input size={_bind('sm' as 'sm' | 'md')} />;
