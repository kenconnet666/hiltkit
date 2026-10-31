// _bind：value={_bind(x)} 对原生元素与组件同写法；声明了“可绑定”的 prop 才收；修饰符可链式。
import type { BindableProps } from '@hilt/runtime';

interface InputProps extends BindableProps<{ value: string }> {
  size?: 'sm' | 'md';
  /** 没有 onKindChange：不是可绑定 prop */
  kind?: 'a' | 'b';
}
export const Input = _component<InputProps>(({ value = _bindable(''), size = 'md' }) => (
  <input value={_bind(value)} class={size} />
));

interface ToggleProps extends BindableProps<{ open: boolean }> {}
export const Toggle = _component<ToggleProps>(({ open = _bindable(false) }) => <details open={_bind(open)} />);

/** 可绑定的数组 prop 声明成可变数组：子组件会写回，readonly 与“写回”矛盾（Bound 是不变的，string[] 变量绑不到 readonly string[]） */
interface TagsProps extends BindableProps<{ tags: string[] }> {}
export const Tags = _component<TagsProps>(({ tags = _bindable.raw<string[]>([]) }) => <ul>{tags.length}</ul>);

interface SelectProps<T> extends BindableProps<{ value: T }> {
  options: readonly T[];
}
export const Pick = _component(<T,>({ value = _bindable<T>(), options }: SelectProps<T>) => (
  <div>{String(value ?? options[0])}</div>
));

let name = _state('');
let count = _state(0);
let flag = _state(false);
let list = _state<string[]>([]);
let picked = _state('');
let mode = _state<'sm' | 'md'>('sm');
let files = _state.raw<FileList | null>(null);
const form = _state({ name: '', rows: [{ qty: 1, tags: ['a'] }] });
let wide = _state('sm');

export const usage = (
  <main>
    {/* ---- 组件：声明了可绑定的 prop ---- */}
    <Input value={_bind(name)} />
    <Input value={name} />
    <Input value="字面量" />
    <Input value={_bind(name)} onValueChange={(next) => next.length} />
    <Input value={_bind(form.name)} />
    <Input value={_bind(form.rows[0].tags[0])} />
    <Input value={_bind.trim(name)} />
    <Input value={_bind.lazy.trim(name)} />
    <Input value={_bind.trim.lazy(name)} />
    <Toggle open={_bind(flag)} />
    <Tags tags={_bind(list)} />
    <Pick value={_bind(name)} options={['a', 'b']} />

    {/* 值的类型不对 */}
    {/* @ts-expect-error number 绑不到 string 的 prop */}
    <Input value={_bind(count)} />
    {/* @ts-expect-error 布尔绑不到 string */}
    <Toggle open={_bind(name)} />
    {/* @ts-expect-error 泛型：T 从 options 推出 string，绑 number 变量 */}
    <Pick value={_bind(count)} options={['a', 'b']} />
    {/* @ts-expect-error 绑定是双向的：string 变量可能被子组件写成任意字符串，装不进字面量联合 */}
    <Input value={_bind(wide)} size={_bind(wide)} />

    {/* 绑到只读 prop（没有 onXxxChange）：类型层报错 */}
    {/* @ts-expect-error size 没有 onSizeChange，不可绑定 */}
    <Input size={_bind(mode)} />
    {/* @ts-expect-error kind 同理 */}
    <Input kind={_bind('a' as 'a' | 'b')} />
    {/* @ts-expect-error 修饰符不改变这一点 */}
    <Input size={_bind.lazy(mode)} />

    {/* ---- 原生元素：还是原生属性名 ---- */}
    <input value={name} />
    <input value={_bind(name)} />
    <input value={_bind.trim(name)} />
    <input value={_bind.lazy.trim(name)} />
    <input type="text" value={_bind(name)} />
    <input type="number" value={_bind(count)} />
    <input type="range" value={_bind(count)} />
    <input type="date" value={_bind(name)} />
    <input value={_bind.number(count)} />
    <input value={_bind.lazy.number(count)} />
    <input type="checkbox" checked={_bind(flag)} />
    <input type="checkbox" value="a" checked={_bind.group(list)} />
    <input type="radio" value="a" checked={_bind.group(picked)} />
    <input type="file" files={_bind(files)} />
    <input type="checkbox" indeterminate={_bind(flag)} />
    <details open={_bind(flag)} />
    <dialog open={_bind(flag)} />
    <select value={_bind(name)}><option value="a">a</option></select>
    <select multiple value={_bind(list)} />
    <textarea value={_bind(name)} />
    <video muted={_bind(flag)} volume={_bind(count)} currentTime={_bind(count)} />

    {/* 反例 */}
    {/* @ts-expect-error 文本框绑数字变量要写 .number */}
    <input value={_bind(count)} />
    {/* @ts-expect-error type="number" 绑字符串变量 */}
    <input type="number" value={_bind(name)} />
    {/* @ts-expect-error checkbox 的 checked 是布尔 */}
    <input type="checkbox" checked={_bind(name)} />
    {/* @ts-expect-error 文本框没有 checked */}
    <input type="text" checked={_bind(flag)} />
    {/* @ts-expect-error div 没有 value */}
    <div value={_bind(name)} />
    {/* @ts-expect-error details 没有 checked */}
    <details checked={_bind(flag)} />
    {/* @ts-expect-error .trim 的目标必须是字符串 */}
    <input value={_bind.trim(count)} />
    {/* @ts-expect-error .number 的目标必须是数字变量 */}
    <input value={_bind.number(name)} />
    {/* @ts-expect-error id 是只读属性，原生元素上不可绑定 */}
    <input id={_bind(name)} />
    {/* @ts-expect-error 非布尔类型的 open */}
    <details open={_bind(count)} />
  </main>
);

// 没有 _bind 标记的普通值不受影响；_bind 的结果不能当普通值用
// @ts-expect-error Bound 不是 string
export const notAString: string = _bind(name);
