/**
 * 第 3、4、5 条：Bindable 生成 _value / onValueChange；_bindable 默认值的类型；原生元素的绑定属性。
 * （编辑器跳转 / 悬停 / 重命名的实测在 ../ls-probe.mjs，结果见 ../RESULTS 说明。）
 */
import type { Bindable, PartProps } from 'exp06';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

// ---- 泛型组件：Bindable<'value', T> ---------------------------------------------------------

interface SelectProps<T> extends PartProps<'div'>, Bindable<'value', T> {
  options: T[];
}
export const Select = _component(
  <T,>({ _value: value = _bindable<T>(), onValueChange, options, ...rest }: SelectProps<T>) => {
    // 第 4 条：_bindable<T>() 没给初始值，诚实地是 T | undefined
    assertType<Equal<typeof value, T | undefined>>();
    // 回调的参数类型是 T
    onValueChange?.(options[0]!);
    return <div {...rest} />;
  },
);

// 也可以不写 onValueChange：它留在 rest 里（类型上会被展开到 <div>，运行时由编译器处理）
export const SelectNoCallback = _component(
  <T,>({ _value: value = _bindable<T>(), options, ...rest }: SelectProps<T>) => {
    assertType<'onValueChange' extends keyof typeof rest ? true : false>();
    return <div {...rest} />;
  },
);

export const useSelect = () => {
  let picked = _state('a');
  let num = _state(1);
  let maybe = _state<string | undefined>();
  return (
    <>
      {/* T 从 options 与 _value 一起推出：string */}
      <Select _value={picked} options={['a', 'b']} />
      <Select _value={picked} onValueChange={(next) => next.toUpperCase()} options={['a', 'b']} />
      <Select _value={num} onValueChange={(next) => next.toFixed()} options={[1, 2]} />
      {/* 不绑定也行 */}
      <Select options={[1, 2]} />
      {/* @ts-expect-error T 同时是 string（_value）与 number（options） */}
      <Select _value={picked} options={[1, 2]} />
      {/* @ts-expect-error 回调参数是 string，写成 number 不兼容（方法签名只放过“一方是另一方子类型”的情况） */}
      <Select _value={picked} onValueChange={(next: number) => next} options={['a']} />
      {/* @ts-expect-error 拼错：onValueChanged */}
      <Select _value={picked} onValueChanged={() => {}} options={['a']} />
      {/* undefined 是允许的（_value?: T） */}
      <Select _value={maybe} options={['a']} />
    </>
  );
};

// ---- 联合与字面量：T 的推断 ------------------------------------------------------------------

type Tone = 'info' | 'warn';
export const useSelectLiteral = () => {
  let tone = _state<Tone>('info');
  return (
    <>
      {/* options 是字面量数组：T 的候选是 Tone（来自 _value）与 string（数组字面量拓宽），取 string */}
      {/* @ts-expect-error 于是 next 是 string，赋给 Tone 报错：要 <Select<Tone>> 显式给类型 */}
      <Select _value={tone} onValueChange={(next) => (tone = next)} options={['info', 'warn']} />
      <Select<Tone> _value={tone} onValueChange={(next) => (tone = next)} options={['info', 'warn']} />
      {/* @ts-expect-error 显式 T 之后，'error' 不在 Tone 里 */}
      <Select<Tone> _value={tone} options={['info', 'error']} />
    </>
  );
};

// ---- readonly 数组 ---------------------------------------------------------------------------

interface TagsProps extends Bindable<'value', readonly string[]> {}
export const Tags = _component<TagsProps>(({ _value: value = _bindable<readonly string[]>([]) }) => {
  assertType<Equal<typeof value, readonly string[]>>();
  return <ul>{value.length}</ul>;
});

// 另一种写法：元素类型是类型参数，数组自动 readonly
interface MultiProps<V> extends Bindable<'value', readonly V[]> {
  options: readonly V[];
}
export const Multi = _component(<V,>({ _value: value = _bindable<readonly V[]>([]), options }: MultiProps<V>) => (
  <ul>{value.length + options.length}</ul>
));

export const useTags = () => {
  let mutable = _state<string[]>([]);
  let frozen = _state<readonly string[]>([]);
  return (
    <>
      <Tags _value={mutable} />
      <Tags _value={frozen} />
      {/* 回调写成 (v: string[]) 也被接受：方法签名的双向协变，这里是有意的宽松（也是不严谨的地方） */}
      <Tags _value={mutable} onValueChange={(v: string[]) => v} />
      <Multi _value={frozen} options={['a']} />
      <Multi _value={mutable} options={['a']} onValueChange={(v) => v.map((s) => s.length)} />
    </>
  );
};

// 如果 prop 写成 _value?: V[]（可变数组），readonly 的状态就传不进去
interface MutableTagsProps extends Bindable<'value', string[]> {}
export const MutableTags = _component<MutableTagsProps>(() => <i />);
export const useMutableTags = () => {
  let frozen = _state<readonly string[]>([]);
  // @ts-expect-error readonly string[] 不能赋给 string[]
  return <MutableTags _value={frozen} />;
};

// ---- 多个绑定、名字里带大写 -------------------------------------------------------------------

interface ChartProps extends Bindable<'hiddenSeries', ReadonlySet<string>>, Bindable<'open', boolean> {}
export const Chart = _component<ChartProps>(
  ({ _hiddenSeries: hidden = _bindable<ReadonlySet<string>>(new Set()), _open: open = _bindable(false), onOpenChange }) => {
    assertType<Equal<typeof hidden, ReadonlySet<string>>>();
    // 来自 _bindable(false)：布尔，不会被收窄成 false
    assertType<Equal<typeof open, boolean>>();
    onOpenChange?.(true);
    return <i />;
  },
);
export const useChart = () => {
  let hidden = _state<ReadonlySet<string>>(new Set());
  let open = _state(false);
  return (
    <>
      <Chart _hiddenSeries={hidden} _open={open} onHiddenSeriesChange={(next) => next.size} onOpenChange={(o) => o} />
      {/* @ts-expect-error 回调名是 onHiddenSeriesChange，不是 onHiddenSeriesesChange */}
      <Chart onHiddenSeriesesChange={() => {}} />
      {/* @ts-expect-error _open 是 boolean */}
      <Chart _open="yes" />
    </>
  );
};

// ---- _bindable 作默认值的各种写法 ------------------------------------------------------------

interface SwitchProps extends Bindable<'checked', boolean> {}
export const Switch = _component<SwitchProps>(
  ({ _checked: checked = _bindable(false) }) => {
    assertType<Equal<typeof checked, boolean>>();
    return <i aria-checked={checked} />;
  },
);
// 没有默认值：T | undefined
export const SwitchNoDefault = _component<SwitchProps>(({ _checked: checked }) => {
  assertType<Equal<typeof checked, boolean | undefined>>();
  return <i />;
});
// _bindable<T>() 不带初始值：与不写默认值同型（T | undefined），所以它只表达“这是个本地状态”
export const SwitchEmpty = _component<SwitchProps>(({ _checked: checked = _bindable<boolean>() }) => {
  assertType<Equal<typeof checked, boolean | undefined>>();
  return <i />;
});
// 默认值与 T 不兼容
export const SwitchBadDefault = _component(({
  // @ts-expect-error 默认值是字符串，_checked 是 boolean（参数写了类型标注才检查；见 01-component.tsx 的 DefaultHole）
  _checked: checked = _bindable('yes'),
}: SwitchProps) => <i />);

// ---- 第 5 条：原生元素的绑定属性 ---------------------------------------------------------------

export const Native = _component<{ t: 'text' | 'password'; dyn: string }>(({ t, dyn }) => {
  let name = _state('');
  let n = _state(1);
  let on = _state(false);
  let o = _state(false);
  let files = _state<FileList | null>(null);
  let picks = _state<readonly string[]>([]);
  let color = _state('#fff');
  let sel = _state('a');
  return (
    <form>
      <input _value={name} />
      <input type="text" _value={name} />
      <input type="password" _value={name} />
      <input type="number" _value={n} />
      <input type="range" _value={n} min={0} max={10} />
      <input type="color" _value={color} />
      <input type="checkbox" _checked={on} />
      <input type="checkbox" _checked={picks} value="a" />
      <input type="radio" _checked={on} />
      <input type="file" _files={files} multiple />
      <input type={t} _value={name} />
      <textarea _value={name} />
      <select _value={sel}>
        <option value="a">a</option>
      </select>
      <select multiple _value={picks} />
      <details _open={o} />
      <dialog _open={o} />

      {/* ---- 反例 ---- */}
      {/* @ts-expect-error div 没有 _value */}
      <div _value={name} />
      {/* @ts-expect-error button 没有 _value */}
      <button _value={name} />
      {/* @ts-expect-error 区分 type：text 绑数字 */}
      <input _value={1} type="text" />
      {/* @ts-expect-error 没写 type 等同 text */}
      <input _value={1} />
      {/* @ts-expect-error number 绑字符串 */}
      <input type="number" _value={name} />
      {/* @ts-expect-error checkbox 没有 _value */}
      <input type="checkbox" _value={name} />
      {/* @ts-expect-error text 没有 _checked */}
      <input type="text" _checked={on} />
      {/* @ts-expect-error 没写 type 时没有 _checked */}
      <input _checked={on} />
      {/* @ts-expect-error _files 只在 type="file" */}
      <input type="text" _files={files} />
      {/* @ts-expect-error radio 的 _checked 是 boolean，不收数组 */}
      <input type="radio" _checked={picks} />
      {/* @ts-expect-error div 没有 _open */}
      <div _open={o} />
      {/* @ts-expect-error details 没有 _checked */}
      <details _checked={o} />
      {/* @ts-expect-error select 单选绑字符串，不是数组 */}
      <select _value={picks} />
      {/* @ts-expect-error type 是任意 string 时选不出分支：动态 type 不能带绑定（要妥协：断言成联合） */}
      <input type={dyn} _value={name} />
    </form>
  );
});

// ---- 原生部件 props 里的绑定属性 ------------------------------------------------------------------

// <input> 的属性是联合类型：interface 不能 extends，要用 type；去掉受管属性也要分配到每个分支
type FieldProps = PartProps<'input', 'value' | 'checked' | 'aria-invalid'> & { label: string };
export const Field = _component<FieldProps>(({ label, ...rest }) => (
  <label>
    {label}
    <input {...rest} aria-invalid="false" />
  </label>
));
export const useField = () => {
  let name = _state('');
  let n = _state(1);
  return (
    <>
      <Field label="x" _value={name} />
      <Field label="x" type="number" _value={n} />
      {/* @ts-expect-error 分支仍然有效：number 不能绑字符串 */}
      <Field label="x" type="number" _value={name} />
      {/* @ts-expect-error value 是受管属性 */}
      <Field label="x" value="1" />
      {/* @ts-expect-error aria-invalid 是受管属性（连字符，靠 never 拦） */}
      <Field label="x" aria-invalid="true" />
    </>
  );
};
