// _bindable 声明 + _bind 绑定。

interface InputProps {
  /** 输入框的值，可以用 _bind 绑定 */
  value?: string;
  /** 值变化时通知 */
  onValueChange?: (next: string) => void;
  size?: 'sm' | 'md';
}
export const Input = _component(({ value = _bindable(''), size = 'md' }: InputProps) => {
  const text: string = value;
  value = 'x';
  // @ts-expect-error 写入类型不对
  value = 1;
  return <input value={_bind(value)} class={text + size} />;
});

// 没有默认值
export const NoDefault = _component(({ value = _bindable<string>() }: InputProps) => {
  const maybe: string | undefined = value;
  // @ts-expect-error 没给默认值就可能是 undefined
  const text: string = value;
  return <input value={maybe ?? text} />;
});

// 布尔不会收窄成 false
interface ToggleProps {
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}
export const Toggle = _component(({ open = _bindable(false) }: ToggleProps) => {
  if (open === true) open = false;
  return <div />;
});

// 字面量联合：默认值要在联合内
interface SizeProps {
  size?: 'sm' | 'md';
}
export const Sized = _component(({ size = _bindable('md') }: SizeProps) => {
  const narrow: 'sm' | 'md' = size;
  return <div class={narrow} />;
});
// @ts-expect-error 默认值不在联合内
export const BadSize = _component(({ size = _bindable('xl') }: SizeProps) => <div class={size} />);

// 对象、raw
interface ListProps {
  rows?: readonly number[];
  tags?: string[];
}
export const List = _component(({ rows = _bindable.raw<readonly number[]>([]), tags = _bindable<string[]>([]) }: ListProps) => {
  tags.push('a');
  // @ts-expect-error readonly
  rows.push(1);
  return <div class={tags.join() + rows.length} />;
});

// 泛型组件
interface SelectProps<T> {
  value?: T;
  onValueChange?: (next: T) => void;
  options: readonly T[];
}
export const Select = _component(<T,>({ value = _bindable<T>(), options }: SelectProps<T>) => {
  const picked: T | undefined = value;
  return <div class={String(picked ?? options[0])} />;
});

// 使用方
let name = _state('');
let count = _state(0);
export const a = <Input value={_bind(name)} />;
export const b = <Input value={_bind(name)} onValueChange={(next) => next.length} />;
export const c = <Input value={name} onValueChange={(next) => (name = next)} />;
// @ts-expect-error 类型不对
export const d = <Input value={_bind(count)} />;
export const e = <Toggle open={true} />;
export const f = <Select value={_bind(name)} options={['a', 'b']} />;
