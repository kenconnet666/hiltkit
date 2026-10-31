// 类型层的正负例：每个 @ts-expect-error 都必须真的报错，否则 tsc 会反过来报“多余的注释”
import { bound, component, computed, fields, member, model, prop, ref, trimmed, writable, type Model, type ReadRef, type Ref } from './hilt';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expect<T extends true>(): T | void {}

const name = ref('');
const age = ref(1);
const maybe = ref<string | null>(null);
const list = ref<string[]>([]);
const upper = computed(() => name.value.toUpperCase());

// ---- 只读和可写 ----
// @ts-expect-error computed 不能写
upper.value = 'x';
const needsRef = (value: Ref<string>) => value;
needsRef(name);
// @ts-expect-error computed 不能当可写的壳传
needsRef(upper);
const readsOnly = (value: ReadRef<string>) => value;
readsOnly(name);
readsOnly(upper);
// @ts-expect-error 类型不同的壳
needsRef(age);
// 不变：Ref<string> 不能给 Ref<string | null>，否则子组件能写进 null（_bind 查不出这种错）
const needsNullable = (value: Ref<string | null>) => value;
// @ts-expect-error
needsNullable(name);
needsNullable(maybe);

// ---- 派生的壳：类型不对就没法调 ----
trimmed(name);
// @ts-expect-error 只有字符串能 trim
trimmed(age);
member(list, 'a');
// @ts-expect-error 元素类型不对
member(list, 1);

// ---- 路径代理：可空路径传播（同 easy-query 的 u.company.name）----
const form = { name: 'a', age: 1, address: { city: 'x' } as { city: string } | null, tags: ['a'] };
const $ = fields(form);
expect<Equal<typeof $.name.value, string>>();
expect<Equal<typeof $.age.value, number>>();
expect<Equal<typeof $.address.city.value, string | null>>();
needsRef($.name);
// @ts-expect-error 上一层可空，所以结果可空，不是 Ref<string>
needsRef($.address.city);
// @ts-expect-error 没有这个字段
$.nothing;
// @ts-expect-error 字符串没有子字段
$.name.length;

// ---- schema：一份声明推出调用方的输入和组件内部的形状（同 easy-query 的 Insert 和 Row）----
const Switch = component(
  {
    checked: bound(false),
    size: prop.of<'sm' | 'md'>('md'),
    label: prop<string>(),
    id: prop.required<string>(),
  },
  (props) => {
    expect<Equal<typeof props.checked, Ref<boolean>>>();
    expect<Equal<typeof props.size, 'sm' | 'md'>>();
    expect<Equal<typeof props.label, string | undefined>>();
    expect<Equal<typeof props.id, string>>();
    // @ts-expect-error 只读
    props.size = 'sm';
    return <i />;
  },
);
const on = ref(false);
const text = ref('');
<Switch id="a" />;
<Switch id="a" checked={true} />;
<Switch id="a" checked={on} />;
<Switch id="a" checked={writable(() => on.value, (next) => void next)} />;
// @ts-expect-error 缺必填
<Switch />;
// @ts-expect-error 壳的类型不对
<Switch id="a" checked={text} />;
// @ts-expect-error 只读的派生不能双向绑（_bind 只能在运行时警告）
<Switch id="a" checked={computed(() => true)} />;
// @ts-expect-error 取值范围
<Switch id="a" size="xl" />;

// ---- 不用 schema：普通函数 + 接口。泛型组件只有这条路最顺 ----
interface SelectProps<T> {
  value?: Model<T>;
  options: readonly T[];
  label?: (item: T) => string;
}
function Select<T>(props: SelectProps<T>) {
  const value = model<T | undefined>(props as any, 'value', undefined);
  expect<Equal<typeof value, Ref<T | undefined>>>();
  return <i />;
}
const picked = ref('a');
<Select value={picked} options={['a', 'b']} />;
<Select value="a" options={['a', 'b']} label={(item) => item.toUpperCase()} />;
// @ts-expect-error 选项和值的类型对不上
<Select value={picked} options={[1, 2]} />;

// ---- 原生元素：传壳双向，传值单向 ----
<input value={name} />;
<input value={name.value} />;
<input type="checkbox" checked={on} />;
// @ts-expect-error 只读的壳不能双向绑；要单向就写 .value
<input value={upper} />;
// @ts-expect-error 壳的类型对不上
<input type="checkbox" checked={name} />;
// @ts-expect-error 其他属性不收壳，忘了 .value 编译期就报
<input title={name} />;

// ---- this 限定的方法写法（同 easy-query 的 like(this: Expr<string | null>)）：只有类型对得上才能调 ----
interface Shell<T> extends Ref<T> {
  trim(this: Shell<string>): Shell<string>;
  has<I>(this: Shell<readonly I[]> | Shell<I[]>, item: I): Shell<boolean>;
  toggle(this: Shell<boolean>): void;
}
declare const nameShell: Shell<string>;
declare const ageShell: Shell<number>;
declare const tagsShell: Shell<string[]>;
nameShell.trim();
// @ts-expect-error 数字没有 trim
ageShell.trim();
tagsShell.has('a');
// @ts-expect-error 元素类型不对
tagsShell.has(1);
// @ts-expect-error 只有布尔能 toggle
nameShell.toggle();

// ---- 符文体系里为什么不能直接解构默认值：局部变量的类型就是 prop 的类型 ----
interface FieldProps {
  value?: Model<string>;
}
const WrongRune = (({ value = '' }: FieldProps) => {
  // @ts-expect-error 类型上 value 是 string | Ref<string>，但编译后是字符串：类型和运行时对不上
  value.toUpperCase();
}) as unknown;
const RightRune = (({ value: source }: FieldProps) => {
  let value = _model(source, '');
  value.toUpperCase();
  value = 'x';
}) as unknown;
void WrongRune, RightRune;
export {};