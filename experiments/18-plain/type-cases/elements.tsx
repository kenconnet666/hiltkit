// 元素属性的类型正负例：class / style、布尔属性、false 的规则、React 拼写、ARIA / data、ref、活的属性、能写回的 value / checked、SVG。
// 每个 @ts-expect-error 都必须真的报错。
import { derived, sig, type Sig } from 'hilt';
import type { Attr, BoolAttr, HtmlProps, SvgProps } from 'hilt/jsx-runtime';

declare const cond: boolean;
declare const maybe: string | undefined;
const text = sig('');
const count = sig(0);
const flag = sig(false);
const choice = sig<'a' | 'b'>('a');
const upper = derived(() => text().toUpperCase());
let box: HTMLDivElement | null = null;

export const Attrs = (
  <main>
    {/* ---- class：字符串 / 数组 / 对象 / 函数，可嵌套 ---- */}
    <div class="a b" />
    <div class={['a', cond && 'b', null, undefined, ['c', { d: cond, e: 0 }]]} />
    <div class={{ active: cond, 'is-open': flag, hidden: maybe, live: () => flag() }} />
    <div class={cond && 'x'} />
    <div class={() => 'x'} />
    <div class={() => [flag() && 'on', { big: count() > 1 }]} />
    <div class={['a', () => flag() && 'b', [() => ({ c: true })]]} />
    <div class={text} />
    {/* @ts-expect-error 数字不是 class */}
    <div class={1} />
    {/* @ts-expect-error 函数返回数字也不是 */}
    <div class={() => 1} />
    {/* @ts-expect-error 数组里的数字 */}
    <div class={['a', 2]} />

    {/* ---- style：字符串、对象；字段值可以是函数；数字长度只收 0 ---- */}
    <div style="color: red; --x: 1" />
    <div style={{ color: 'red', width: '10px', opacity: 0.5, zIndex: 3, flexGrow: 1, margin: 0 }} />
    <div style={{ '--gap': '8px', '--n': 3 }} />
    <div style={{ width: cond ? '10px' : undefined }} />
    <div style={{ color: text, width: () => `${count()}px`, '--live': () => count() }} />
    <div style={() => ({ color: 'red' })} />
    <div style={() => 'color: red'} />
    <div style={text} />
    {/* @ts-expect-error 长度数字：不补 px，所以只允许 0 和字符串 */}
    <div style={{ width: 10 }} />
    {/* @ts-expect-error 函数返回数字长度也一样 */}
    <div style={{ width: () => 10 }} />
    {/* @ts-expect-error 同上（边距） */}
    <div style={{ marginTop: 8 }} />
    {/* @ts-expect-error 拼错属性名 */}
    <div style={{ colour: 'red' }} />
    {/* @ts-expect-error 自定义属性必须以 -- 开头 */}
    <div style={{ gap8: '8px' }} />
    {/* @ts-expect-error style 不收数组 */}
    <div style={[{ color: 'red' }]} />

    {/* ---- 布尔属性：true / false，字符串不收 ---- */}
    <button disabled />
    <button disabled={cond} />
    <button disabled={flag} />
    <button disabled={() => flag() || undefined} />
    <input readonly required />
    <div hidden />
    <div hidden="until-found" />
    <div popover="manual" />
    <details open />
    <video controls loop muted autoplay playsinline />
    {/* @ts-expect-error "false" 字符串是真值，容易写错 */}
    <button disabled="false" />
    {/* @ts-expect-error 同上 */}
    <button disabled="disabled" />
    {/* @ts-expect-error 空字符串在 JS 里是假值，组件读它会判反 */}
    <button disabled="" />
    {/* @ts-expect-error 数字不是布尔属性 */}
    <button disabled={1} />
    {/* @ts-expect-error 读取函数返回的类型也要对 */}
    <button disabled={() => 'yes'} />

    {/* ---- 所有普通属性都收 值 | 读取函数 ---- */}
    <a href={text} title={() => text()} target={() => '_blank'} id={upper} />
    <img src={() => `/a/${count()}.png`} alt={text} width={count} height={() => '10px'} loading={() => 'lazy'} />
    <div tabindex={count} hidden={flag} draggable={() => false} translate={flag} />
    <div aria-label={text} aria-busy={flag} aria-level={count} aria-pressed={() => 'mixed'} role={() => 'button'} />
    <div data-open={flag} data-n={count} data-t={() => text()} data-x={() => (cond ? '' : undefined)} />
    <progress value={count} max={() => 100} />
    <option value={text} selected={flag} />
    {/* @ts-expect-error 读取函数返回的类型要对 */}
    <a title={count} />
    {/* @ts-expect-error 读取函数返回 boolean 的字符串属性 */}
    <a href={() => flag()} />
    {/* @ts-expect-error 枚举型：取值范围 */}
    <a target={1} />
    {/* @ts-expect-error aria 的取值范围，读取函数一样检查 */}
    <div aria-live={() => 'loud'} />

    {/* ---- 非布尔属性：false 合法的只有枚举型（写成 "false"）---- */}
    <div aria-hidden={false} aria-expanded={cond} aria-busy="true" aria-pressed="mixed" />
    <div draggable={false} spellcheck={false} contenteditable={false} />
    <div translate={false} />
    <div data-open={false} data-count={3} data-x="s" />
    <div id={cond ? 'x' : undefined} id-not-checked="hyphen" />
    {/* @ts-expect-error cond && 'x' 在字符串属性上会产生 false */}
    <div id={cond && 'x'} />
    {/* @ts-expect-error 读取函数里一样 */}
    <div id={() => cond && 'x'} />
    {/* @ts-expect-error 同上（title） */}
    <div title={cond && 'x'} />
    {/* @ts-expect-error 同上（href） */}
    <a href={cond && '/x'} />
    {/* @ts-expect-error aria-label 是字符串属性 */}
    <div aria-label={cond && 'x'} />
    {/* @ts-expect-error aria-label 读取函数里的 false */}
    <div aria-label={() => flag() && 'x'} />
    {/* @ts-expect-error tabindex 不收 false */}
    <div tabindex={false} />
    {/* @ts-expect-error aria-hidden 的取值 */}
    <div aria-hidden="maybe" />
    {/* @ts-expect-error aria-checked 的取值 */}
    <div aria-checked="yes" />
    {/* @ts-expect-error aria-level 是数字 */}
    <div aria-level="2" />

    {/* ---- React 拼写：报错并指向正确写法 ---- */}
    {/* @ts-expect-error className → class */}
    <div className="x" />
    {/* @ts-expect-error htmlFor → for */}
    <label htmlFor="a" />
    {/* @ts-expect-error tabIndex → tabindex */}
    <div tabIndex={0} />
    {/* @ts-expect-error readOnly → readonly */}
    <input readOnly />
    {/* @ts-expect-error autoFocus → autofocus */}
    <input autoFocus />
    {/* @ts-expect-error onDoubleClick → onDblClick */}
    <div onDoubleClick={() => {}} />
    {/* @ts-expect-error defaultValue → value */}
    <input defaultValue="x" />
    {/* @ts-expect-error SVG：strokeWidth → stroke-width */}
    <svg strokeWidth={2} />
    {/* @ts-expect-error SVG：fillRule → fill-rule */}
    <path fillRule="evenodd" />
    {/* @ts-expect-error SVG：clipPath → clip-path */}
    <g clipPath="url(#a)" />

    {/* ---- ARIA / role / data ---- */}
    <div role="button" aria-label="x" aria-level={2} aria-live="polite" aria-controls="a" />
    <div role="custom-role" />

    {/* ---- ref：Sig 或回调，元素类型要对得上 ---- */}
    <div ref={(el) => (box = el)} />
    <input ref={(el) => el?.focus()} />
    <svg ref={(el) => el?.getBBox()} />
    <div ref={sig<HTMLDivElement | null>(null)} />
    <div ref={sig<HTMLElement | null>(null)} />
    {/* @ts-expect-error 参数可能是 null */}
    <input ref={(el) => el.focus()} />
    {/* @ts-expect-error 回调参数是 HTMLInputElement，没有 getBBox */}
    <input ref={(el) => el?.getBBox()} />
    {/* @ts-expect-error 字符串 Sig 不是 ref */}
    <div ref={text} />
    {/* @ts-expect-error 别的元素的 Sig 收不下这个元素 */}
    <button ref={sig<HTMLDivElement | null>(null)} />
    {/* @ts-expect-error 不收 null 的 Sig：卸载时会写 null */}
    <div ref={sig<HTMLDivElement>(document.createElement('div'))} />

    {/* ---- value / checked：传 Sig 双向，传值或只读函数单向 ---- */}
    <input value={text} />
    <input value={upper} />
    <input value={text()} />
    <input value={() => text()} />
    <input type="number" value={count} />
    <input type="checkbox" checked={flag} />
    <input type="checkbox" checked={derived(() => !flag())} />
    <input type="checkbox" checked />
    <input type="checkbox" checked={() => count() > 1} />
    <input value={sig<string | undefined>(undefined)} />
    <textarea value={text} />
    <select value={text} />
    {/* @ts-expect-error 勾选框要布尔 */}
    <input type="checkbox" checked={text} />
    {/* @ts-expect-error 布尔 Sig 绑不到文本框 */}
    <input value={flag} />
    {/* @ts-expect-error 联合收窄的 Sig 会被写入任意字符串 */}
    <input value={choice} />
    {/* @ts-expect-error textarea 写回字符串，数字 Sig 不行 */}
    <textarea value={count} />
    {/* @ts-expect-error 读取函数返回类型不对 */}
    <input value={() => flag()} />
    {/* @ts-expect-error 勾选框不收字符串 */}
    <input type="checkbox" checked="yes" />

    {/* ---- 其他标签专属属性 ---- */}
    <a href="/x" target="_blank" rel="noopener" download />
    <img src="a.png" alt="" width={10} height="10" loading="lazy" />
    <form method="post" novalidate onSubmit={(e) => e.preventDefault()} />
    <textarea rows={3} maxlength={10} />
    <td colspan={2} />
    <ol reversed start={3} />
    <label for="a" />
    {/* @ts-expect-error loading 取值 */}
    <img loading="auto" />
    {/* @ts-expect-error button 没有 href */}
    <button href="/x" />
    {/* @ts-expect-error div 没有 disabled */}
    <div disabled />
    {/* @ts-expect-error 没有这个属性 */}
    <a nothing="x" />

    {/* ---- SVG ---- */}
    <svg viewBox="0 0 8 8" width={8} height="8" stroke-width={() => count()} fill={text} class={['icon', () => flag() && 'on']}>
      <path d="M0 0" fill-rule="evenodd" stroke-linecap="round" opacity={0.5} />
      <circle cx={1} cy={count} r="2" onClick={(e) => e.currentTarget.r.baseVal.value} />
      <linearGradient id="g" gradientUnits="userSpaceOnUse">
        <stop offset={0.5} stop-color="red" />
      </linearGradient>
    </svg>
    {/* @ts-expect-error path 没有 cx */}
    <path cx={1} />
    {/* @ts-expect-error stroke-linecap 取值 */}
    <path stroke-linecap="triangle" />

    {/* ---- key：标准 JSX 的 key，任何元素都收（位置由编译器之外的规则管）---- */}
    {[1, 2].map((n) => <li key={n}>{n}</li>)}
    {/* @ts-expect-error key 的类型 */}
    <li key={{}} />

    {/* ---- children ---- */}
    <p>
      文本 {1} {cond && <b />} {() => text()} {[<i />, '字']} {null}
    </p>
    {/* @ts-expect-error 普通对象不是内容 */}
    <p>{{ a: 1 }}</p>
  </main>
);

// ---- 组件转发 rest：HtmlProps / SvgProps、Omit、Attr ----
interface CardProps extends Omit<HtmlProps<'section'>, 'title'> {
  title?: Attr<string>;
  open?: Attr<BoolAttr>;
}
export function Card({ title, open, children, ...rest }: CardProps) {
  return (
    <section {...rest} aria-label={title} hidden={() => !open}>
      {children}
    </section>
  );
}
<Card title={text} open={flag} class="c" onClick={(e) => e.currentTarget.dataset} sx={[]} data-x="1">
  内容
</Card>;
// @ts-expect-error title 被组件改成了读取函数
<Card title={1} />;
// @ts-expect-error 被 Omit 的 title 不是 HtmlProps 的 title 了，没有别的写法
<Card title={{ a: 1 }} />;

export function Icon(props: SvgProps<'svg'>) {
  return <svg {...props} viewBox="0 0 8 8" />;
}
<Icon stroke-width={2} class="i" />;
// @ts-expect-error svg 没有 href
<Icon href="x" />;

// 只读 prop 协变就够了：Sig 可以传给只读
function Label(_: { text?: Attr<string> }) {
  return <i />;
}
<Label text={text} />;
<Label text={upper} />;
<Label text="x" />;
const writable: Sig<string> = text;
void writable;

// ---- HtmlProps 的第二个参数：组件自己管理的属性（键重映射，后缀事件的精确类型保留）----
interface ManagedProps extends HtmlProps<'button', 'type' | 'aria-busy'> {
  busy?: Attr<boolean>;
}
export function Managed({ busy, children, ...rest }: ManagedProps) {
  return (
    <button {...rest} type="button" aria-busy={busy}>
      {children}
    </button>
  );
}
<Managed busy={flag} onClickCapture={(event) => event.clientX} onKeyDownOnce={(event) => event.key} on:foo={(event) => event.type} class="x" />;
// @ts-expect-error type 被组件管理了
<Managed type="submit" />;
// @ts-expect-error 连字符属性也拦下（JSX 不检查类型里没有的连字符属性，所以显式标成 never）
<Managed aria-busy="true" />;
// @ts-expect-error 精确的后缀事件类型保留：clientX 在 KeyboardEvent 上不存在
<Managed onKeyDownCapture={(event) => event.clientX} />;
// 对照：内置 Omit 会让后缀事件退回通用 Event
interface OmitProps extends Omit<HtmlProps<'button'>, 'type'> {}
// @ts-expect-error 退回通用 Event：没有 key
<Managed2 onKeyDownCapture={(event) => event.key} />;
declare function Managed2(props: OmitProps): unknown;
