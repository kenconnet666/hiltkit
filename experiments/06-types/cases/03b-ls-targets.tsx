/**
 * 第 3 条的语言服务实测靶子：同一个“值 + 变化回调”用四种写法声明，ls-probe.mjs 在这里量
 * 跳转 / 悬停文档 / 重命名 / 引用 / 补全。文件本身也要通过 tsc，保证四种写法在类型上等价。
 */
import type { Bindable } from 'exp06';

// A：Bindable<'value', T>，模板字面量 + 映射类型生成两个属性
interface PropsA<T> extends Bindable<'value', T> {
  label?: string;
}

// B：手写两个属性（带 JSDoc）
interface PropsB<T> {
  /** 当前值（B） */
  _value?: T;
  /** 值变化时调用（B） */
  onValueChange?: (next: T) => void;
  label?: string;
}

// C：_value 手写、回调由同态映射 + as 改名生成
type WithChange<P> = P & {
  [K in keyof P & `_${string}` as K extends `_${infer N}` ? `on${Capitalize<N>}Change` : never]?: (
    next: NonNullable<P[K]>,
  ) => void;
};
interface BaseC<T> {
  /** 当前值（C） */
  _value?: T;
  label?: string;
}
type PropsC<T> = WithChange<BaseC<T>>;

// D：与 A 同，但 Bindable 之外再手写 JSDoc 的“文档属性”：属性声明在接口里，生成的只有回调
interface PropsD<T> extends Bindable<'value', T> {
  /** 当前值（D：与 Bindable 生成的 _value 同名重复声明，类型必须一致） */
  _value?: T;
}

export const SelectA = _component(<T,>({ _value: value, onValueChange, label }: PropsA<T>) => <i>{label}</i>);
export const SelectB = _component(<T,>({ _value: value, onValueChange, label }: PropsB<T>) => <i>{label}</i>);
export const SelectC = _component(<T,>({ _value: value, onValueChange, label }: PropsC<T>) => <i>{label}</i>);
export const SelectD = _component(<T,>({ _value: value, onValueChange }: PropsD<T>) => <i />);

export const use = () => {
  let v = _state('a');
  return (
    <>
      <SelectA _value={v} onValueChange={(n) => n} />
      <SelectB _value={v} onValueChange={(n) => n} />
      <SelectC _value={v} onValueChange={(n) => n} />
      <SelectD _value={v} onValueChange={(n) => n} />
    </>
  );
};
