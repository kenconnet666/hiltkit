// prop 的默认值写 _state：类型上和 _bindable 是否等价。
interface InputProps {
  /** 输入框的值 */
  _value?: string;
  /** 值变化时通知 */
  onValueChange?: (next: string) => void;
}
export const Input = _component(({ _value: value = _state('') }: InputProps) => {
  const text: string = value;
  value = 'x';
  // @ts-expect-error 写入类型不对
  value = 1;
  return <input value={text} />;
});

// 没有默认值
export const NoDefault = _component(({ _value: value = _state<string>() }: InputProps) => {
  const maybe: string | undefined = value;
  // @ts-expect-error 没给默认值就可能是 undefined
  const text: string = value;
  return <input value={maybe ?? text} />;
});

// 布尔：_state 的 boolean 重载不会收窄成 false
interface ToggleProps {
  _open?: boolean;
  onOpenChange?: (next: boolean) => void;
}
export const Toggle = _component(({ _open: open = _state(false) }: ToggleProps) => {
  if (open === true) open = false;
  return <div />;
});

// 字面量联合：默认值要在联合内
interface SizeProps {
  _size?: 'sm' | 'md';
}
export const Sized = _component(({ _size: size = _state('md') }: SizeProps) => {
  const narrow: 'sm' | 'md' = size;
  return <div class={narrow} />;
});
// @ts-expect-error 默认值不在联合内
export const BadSize = _component(({ _size: size = _state('xl') }: SizeProps) => <div class={size} />);

// 对象、raw
interface ListProps {
  _rows?: readonly number[];
  _tags?: string[];
}
export const List = _component(({ _rows: rows = _state.raw<readonly number[]>([]), _tags: tags = _state<string[]>([]) }: ListProps) => {
  tags.push('a');
  // @ts-expect-error readonly
  rows.push(1);
  return <div class={tags.join() + rows.length} />;
});

// 泛型组件
interface SelectProps<T> {
  _value?: T;
  onValueChange?: (next: T) => void;
  options: readonly T[];
}
export const Select = _component(<T,>({ _value: value = _state<T>(), options }: SelectProps<T>) => {
  const picked: T | undefined = value;
  return <div class={String(picked ?? options[0])} />;
});

// 使用方不受影响
let name = _state('');
export const a = <Input _value={name} />;
export const b = <Input _value={name} onValueChange={(next) => (name = next)} />;
// @ts-expect-error 类型不对
export const c = <Input _value={1} />;
export const d = <Toggle _open={true} />;
export const e = <Select _value="a" options={['a', 'b']} />;
