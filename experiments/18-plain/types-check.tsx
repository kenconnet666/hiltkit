// 类型正负例：只靠 TS，没有任何插件。每个 @ts-expect-error 都必须真的报错。
import { derived, For, merge, model, sig, when, type Model, type Prop, type ReadOnly, type ReadSig, type Sig } from 'hilt';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expect<T extends true>(): T | void {}

const name = sig('');
const age = sig(1);
const on = sig(false);
const maybe = sig<string | null>(null);
const list = sig<string[]>([]);
const upper = derived(() => name().toUpperCase());

// ---- 读写 ----
expect<Equal<ReturnType<typeof name>, string>>();
name.set('a');
// @ts-expect-error 类型不对
name.set(1);
// @ts-expect-error derived 没有 set
upper.set('x');
// @ts-expect-error 调用结果不能赋值
name() = 'x';
// @ts-expect-error 调用结果不能自增
age()++;

// ---- 方法：类型对不上就调不了 ----
age.inc();
on.toggle();
name.trim();
list.has('a');
// @ts-expect-error 字符串没有 inc
name.inc();
// @ts-expect-error 数字没有 toggle
age.toggle();
// @ts-expect-error 布尔没有 trim
on.trim();
// @ts-expect-error 元素类型不对
list.has(1);
// @ts-expect-error 不是数组
name.has('a');

// ---- 默认深代理：字段直接读写，类型照常检查 ----
const form = sig({ name: 'a', age: 1, address: { city: 'x' } as { city: string } | null, tags: ['a'] });
form().name = 'b';
form().tags.push('c');
expect<Equal<typeof form, Sig<{ name: string; age: number; address: { city: string } | null; tags: string[] }>>>();
// @ts-expect-error 字段类型不对
form().name = 1;
// @ts-expect-error 没有这个字段
form().nothing;
// @ts-expect-error 上一层可空，要判断
form().address.city;

// ---- at：取字段的壳，类型由路径推出来 ----
const nameField = form.at((f) => f.name);
expect<Equal<typeof nameField, Sig<string>>>();
nameField.set('c');
// @ts-expect-error 字段类型不对
nameField.set(1);
const cityField = form.at((f) => f.address?.city);
expect<Equal<typeof cityField, Sig<string | undefined>>>();
// @ts-expect-error 可空路径不能当 Sig<string>
const city: Sig<string> = cityField;
// @ts-expect-error 没有这个字段
form.at((f) => f.nothing);

// ---- fields：解构出来还是壳 ----
const { name: nameShell, age: ageShell, tags } = form.fields();
expect<Equal<typeof nameShell, Sig<string>>>();
ageShell.inc();
tags.has('a');
// @ts-expect-error 字符串没有 inc
nameShell.inc();
// @ts-expect-error 没有这个字段
form.fields().nothing;

// ---- raw：写法一样，只是不代理 ----
const rows2 = sig.raw([{ id: 1 }]);
rows2.set([...rows2(), { id: 2 }]);

// ---- 普通函数组件：泛型直接可用，不需要包装 ----
interface SelectProps<T> {
  value?: Model<T>;
  options: readonly T[];
  label?: (item: T) => string;
}
function Select<T>({ value, options }: SelectProps<T>) {
  const selected = model<T | undefined>(value as Model<T | undefined> | undefined, undefined);
  expect<Equal<typeof selected, Sig<T | undefined>>>();
  return <i>{options.length}</i>;
}
const picked = sig('a');
<Select value={picked} options={['a', 'b']} />;
<Select value="a" options={['a', 'b']} label={(item) => item.toUpperCase()} />;
// @ts-expect-error 选项和值的类型对不上
<Select value={picked} options={[1, 2]} />;

// ---- 可绑定 prop：Sig 双向，值和只读函数单向 ----
function Switch(_: { checked?: Model<boolean>; size?: Prop<'sm' | 'md'>; label?: Prop<string> }) {
  return <i />;
}
<Switch />;
<Switch checked={true} />;
<Switch checked={on} />;
<Switch checked={derived(() => true)} />;
<Switch checked={() => on()} />;
<Switch size="sm" />;
<Switch size={() => 'md'} />;
<Switch label={name} />;
// @ts-expect-error 壳的类型不对
<Switch checked={name} />;
// @ts-expect-error 取值范围
<Switch size="xl" />;
function Clearable(_: { value?: Model<string | null> }) {
  return <i />;
}
<Clearable value={maybe} />;
// @ts-expect-error 不变：子组件能写 null，Sig<string> 不能传
<Clearable value={name} />;
function ReadOnlyLabel(_: { text?: Prop<string | null> }) {
  return <i />;
}
// 只读 prop 协变就够了：子组件写不了
<ReadOnlyLabel text={name} />;
function MustBind(_: { value: Sig<string> }) {
  return <i />;
}
<MustBind value={name} />;
// @ts-expect-error 必须能写回的 prop 不收只读
<MustBind value={upper} />;
const onlyRead: ReadOnly<string> = upper;
void onlyRead;

// ---- 原生元素 ----
<input value={name} />;
<input value={upper} />;
<input value={name()} />;
<input type="checkbox" checked={on} />;
<a href={name} title={name} />;
// @ts-expect-error 类型对不上
<input type="checkbox" checked={name} />;
// @ts-expect-error 类型对不上
<a title={age} />;
// @ts-expect-error 没有这个属性
<a nothing="x" />;
// @ts-expect-error input 没有 href
<input href="x" />;
<button onClick={(event) => event.currentTarget.disabled} />;
<button onClickCapture={(event) => event.clientX} />;
// @ts-expect-error 事件参数类型不对
<button onClick={(event: KeyboardEvent) => event.key} />;
const el = sig<HTMLElement | null>(null);
<div ref={el} />;
// @ts-expect-error ref 不收普通字符串 Sig
<div ref={name} />;

// ---- 下面这些 TS 查不出，是不用编译器的代价：写了调用就只取一次 ----
<p title={name()}>{name()}</p>;

// ---- 方法摘下来当回调：运行时 this 丢了 ----
<button onClick={on.toggle} />;

// ---- 列表与条件 ----
const rows = sig([{ id: 1, name: 'a' }]);
<For each={rows}>{(row) => <li>{row.name}</li>}</For>;
<For each={rows} by={(row) => row.id}>{(row, index) => <li data-i={index}>{() => row().name}</li>}</For>;
const user = sig<{ name: string } | null>(null);
when(user, (u) => {
  expect<Equal<typeof u, ReadSig<{ name: string }>>>();
  return <b>{() => u().name}</b>;
});

// ---- 合并 ----
const merged = merge({ class: 'a', id: 'x' }, { title: 'b' });
expect<Equal<typeof merged.title, 'b'>>();
export {};
