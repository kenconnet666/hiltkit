/**
 * 其他：ref、事件的 currentTarget、For / map、跨标签展开 rest、_component<Props> 的默认值漏洞。
 */
import { For, type PartProps } from 'exp06';

// ---- ref ---------------------------------------------------------------------------------------

export const Refs = _component<{}>(() => {
  let input = _state<HTMLInputElement | null>(null);
  let box = _state<HTMLDivElement>(); // 没有初始值：HTMLDivElement | undefined
  const onlyType = _state.raw<HTMLButtonElement | null>(null);
  return (
    <div ref={box}>
      <input ref={input} />
      <input ref={(el) => el.focus()} />
      <button ref={onlyType} />
      <svg ref={(el) => el.getBBox()} />
      {/* @ts-expect-error input 元素的变量不能给 button（HTMLInputElement 缺少 HTMLButtonElement 的成员） */}
      <button ref={input} />
      {/* @ts-expect-error div 的变量不能给 input */}
      <input ref={box} />
      {/* @ts-expect-error 回调参数是 HTMLInputElement，没有 getBBox */}
      <input ref={(el) => el.getBBox()} />
      {/* 做不到：HTMLInputElement 结构上兼容 HTMLDivElement（后者只多一个已废弃的 align，前者也有），div 的 ref 放过了 input 的变量 */}
      <div ref={input} />
    </div>
  );
});

// ---- 事件 --------------------------------------------------------------------------------------

export const Events = _component<{}>(() => {
  let name = _state('');
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <input
        onInput={(e) => (name = e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onFocus={(e) => e.currentTarget.select()}
      />
      <textarea onInput={(e) => e.currentTarget.value.length} />
      <select onChange={(e) => e.currentTarget.selectedOptions} />
      <button onClick={(e) => e.currentTarget.form} />
      <a onClick={(e) => e.currentTarget.href} />
      <svg onClick={(e) => e.currentTarget.viewBox} />
      {/* @ts-expect-error div 没有 .value */}
      <div onInput={(e) => e.currentTarget.value} />
      {/* @ts-expect-error 事件名拼错（onclik） */}
      <div onClik={() => {}} />
      {/* 带 data-* / 未登记的连字符属性：JSX 不检查（TS 规则），这里不报错 */}
      <div data-state="open" aria-foo="x" />
      {/* @ts-expect-error aria-busy 的取值 */}
      <div aria-busy="maybe" />
      {name}
    </form>
  );
});

// ---- 把 rest 展开到别的标签 --------------------------------------------------------------------

export const Cross = _component<PartProps<'button'>>(({ ...rest }) => (
  <>
    <button {...rest} />
    {/* @ts-expect-error button 的 props 不能展开到 <a>：onClick 的 currentTarget、type 等不兼容 */}
    <a {...rest} />
  </>
));
export const CrossDiv = _component<PartProps<'div'>>(({ ...rest }) => (
  <>
    <div {...rest} />
    {/* 妥协：div 的 props 展开到 <section> 也被拒（事件的 currentTarget 是 HTMLDivElement，逆变不兼容）；Vue 版的联合标签 SharedAttributes 就是为这个 */}
    {/* @ts-expect-error currentTarget: HTMLDivElement 与 HTMLElement 的逆变冲突 */}
    <section {...rest} />
  </>
));

// ---- For / map ---------------------------------------------------------------------------------

interface Row {
  id: number;
  name: string;
}
export const Lists = _component<{ rows: Row[]; maybe?: Row[] | null }>(({ rows, maybe }) => (
  <ul>
    <For each={rows}>{(row, i) => <li>{row.name + i}</li>}</For>
    <For each={maybe} fallback={<li>空</li>}>
      {(row) => <li>{row.id}</li>}
    </For>
    {rows.map((row) => (
      <li key={row.id}>{row.name}</li>
    ))}
    {rows.map((row) => row.name)}
    <For each={rows}>
      {/* @ts-expect-error For 的 children 必须是函数（错误落在子元素上） */}
      <li />
    </For>
    {/* @ts-expect-error 缺 each */}
    <For>{() => <li />}</For>
  </ul>
));

// ---- _component<Props>(…) 里默认值不被检查（TS 对“上下文推断出的解构参数”不校验默认值） --------------------

interface SizeProps {
  size?: 'sm' | 'md';
}
// 漏洞：默认值 'xl' 不在联合里，却没有报错，局部变量 size 被悄悄加宽成 string
export const DefaultHole = _component<SizeProps>(({ size = 'xl' }) => {
  const wide: string = size;
  // @ts-expect-error 类型已被加宽：它不再是 'sm' | 'md'
  const narrow: 'sm' | 'md' = size;
  void [wide, narrow];
  return <i />;
});
// 参数写了类型标注就会检查（推荐写法）
export const DefaultChecked = _component(({
  // @ts-expect-error 'xl' 不在 'sm' | 'md' 里
  size = 'xl',
}: SizeProps) => <i />);
