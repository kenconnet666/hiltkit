// 属性：class / style、布尔属性、false 的规则、React 拼写、ARIA、ref、key、sx、自定义元素、SVG。
import type { BoolAttr } from '@hilt/runtime';

declare const cond: boolean;
declare const text: string;
declare const maybe: string | undefined;

export const Attrs = _component<{ active?: boolean }>(({ active }) => (
  <main>
    {/* ---- class：字符串 / 数组 / 对象（clsx 规则）---- */}
    <div class="a b" />
    <div class={['a', cond && 'b', null, undefined, ['c', { d: cond, e: 0 }]]} />
    <div class={{ active, 'is-open': cond, hidden: maybe }} />
    <div class={cond && 'x'} />
    <div class={active ? 'on' : undefined} />
    {/* @ts-expect-error 数字不是 class（clsx 会输出 0，这里的规则是不出力） */}
    <div class={1} />
    {/* @ts-expect-error 函数不是 class */}
    <div class={() => 'x'} />

    {/* ---- style：字符串或对象，数字不补 px ---- */}
    <div style="color: red; --x: 1" />
    <div style={{ color: 'red', width: '10px', opacity: 0.5, zIndex: 3, flexGrow: 1, margin: 0 }} />
    <div style={{ '--gap': '8px', '--n': 3 }} />
    <div style={{ width: cond ? '10px' : undefined }} />
    {/* @ts-expect-error 长度数字：不补 px，所以只允许 0 和字符串 */}
    <div style={{ width: 10 }} />
    {/* @ts-expect-error 同上（边距） */}
    <div style={{ marginTop: 8 }} />
    {/* @ts-expect-error 拼错属性名 */}
    <div style={{ colour: 'red' }} />
    {/* @ts-expect-error 自定义属性必须以 -- 开头 */}
    <div style={{ gap8: '8px' }} />
    {/* @ts-expect-error style 不收数组 */}
    <div style={[{ color: 'red' }]} />

    {/* ---- 布尔属性：true / false / ''（空字符串为真）---- */}
    <button disabled />
    <button disabled={cond} />
    <button disabled="" />
    <input readonly="" required />
    <div hidden="" />
    <div hidden="until-found" />
    <div popover="manual" />
    <details open="" />
    <video controls loop="" muted autoplay playsinline />
    {/* @ts-expect-error "false" 字符串是真值，容易写错 */}
    <button disabled="false" />
    {/* @ts-expect-error 同上 */}
    <button disabled="disabled" />
    {/* @ts-expect-error 数字不是布尔属性 */}
    <button disabled={1} />

    {/* ---- 非布尔属性：false 合法的只有枚举型（写成 "false"）---- */}
    <div aria-hidden={false} aria-expanded={cond} aria-busy="true" aria-pressed="mixed" />
    <div draggable={false} spellcheck={false} contenteditable={false} />
    <div translate={false} />
    <div data-open={false} data-count={3} data-x="s" />
    <div id={cond ? 'x' : undefined} id-not-checked="hyphen" />
    {/* @ts-expect-error cond && 'x' 在字符串属性上会产生 false */}
    <div id={cond && 'x'} />
    {/* @ts-expect-error 同上（title） */}
    <div title={cond && 'x'} />
    {/* @ts-expect-error 同上（href） */}
    <a href={cond && '/x'} />
    {/* @ts-expect-error aria-label 是字符串属性 */}
    <div aria-label={cond && 'x'} />
    {/* @ts-expect-error tabindex 是数字属性 */}
    <div tabindex={false} />
    {/* @ts-expect-error aria-hidden 的取值 */}
    <div aria-hidden="maybe" />
    {/* @ts-expect-error aria-checked 的取值 */}
    <div aria-checked="yes" />

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

    {/* ---- ARIA / role ---- */}
    <div role="button" aria-label="x" aria-level={2} aria-live="polite" aria-controls="a" />
    <div role="custom-role" />
    {/* @ts-expect-error aria-level 是数字 */}
    <div aria-level="2" />

    {/* ---- ref：回调，参数是元素或 null ---- */}
    <input ref={(el) => el?.focus()} />
    <input ref={(el) => { if (el) el.select(); }} />
    <svg ref={(el) => el?.getBBox()} />
    <div ref={(el) => (box = el)} />
    {/* @ts-expect-error 参数可能是 null */}
    <input ref={(el) => el.focus()} />
    {/* @ts-expect-error 回调参数是 HTMLInputElement，没有 getBBox */}
    <input ref={(el) => el?.getBBox()} />
    {/* @ts-expect-error 变量不是回调 */}
    <input ref={box} />

    {/* ---- key：列表行 ---- */}
    {[1, 2].map((n) => <li key={n}>{n}</li>)}
    {[1, 2].map((n) => <li key={'a' + n}>{n}</li>)}
    {/* @ts-expect-error key 的类型 */}
    <li key={{}} />
    {/* 做不到：key 只在列表行有意义，类型层看不到“这个元素是不是 map 的返回值”，任何元素都收 key（位置由编译器诊断） */}
    <div key="x" />

    {/* ---- 其他标签专属属性 ---- */}
    <a href="/x" target="_blank" rel="noopener" download />
    <img src="a.png" alt="" width={10} height="10" loading="lazy" />
    <form method="post" novalidate onSubmit={(e) => e.preventDefault()} />
    <textarea rows={3} maxlength={10} />
    <td colspan={2} />
    <ol reversed start={3} />
    {/* @ts-expect-error loading 取值 */}
    <img loading="auto" />
    {/* @ts-expect-error button 没有 href */}
    <button href="/x" />
    {/* @ts-expect-error div 没有 disabled */}
    <div disabled />

    {/* ---- 自定义元素（见 04b-custom-elements.tsx 的声明合并）---- */}
    <x-card heading="h" elevated onXToggle={(e) => e.detail} on:x-other={(e) => e.type} ref={(el) => el?.open} />
    {/* @ts-expect-error 没登记的自定义元素 */}
    <x-unknown />
    {/* @ts-expect-error 属性类型 */}
    <x-card heading={1} />

    {/* ---- SVG ---- */}
    <svg viewBox="0 0 24 24" width={24} height="24" fill="none" stroke="currentColor" stroke-width={2} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="red" />
          <stop offset={1} stop-color="blue" stop-opacity={0.5} />
        </linearGradient>
        <clipPath id="c"><rect x={0} y={0} width="10" height="10" rx={2} /></clipPath>
      </defs>
      <g transform="translate(1 1)" clip-path="url(#c)" opacity={0.5}>
        <path d="M0 0L1 1" stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd" />
        <circle cx={5} cy="5" r={3} />
        <ellipse cx={1} cy={1} rx={2} ry={3} />
        <line x1={0} y1={0} x2={1} y2={1} />
        <polygon points="0,0 1,1 2,0" />
        <text x={1} y={2} text-anchor="middle" font-size={12}>文字<tspan dy={2}>x</tspan></text>
        <use href="#a" x={1} />
        <image href="a.png" width={10} height={10} />
        <filter id="f"><feGaussianBlur stdDeviation={2} in="SourceGraphic" /></filter>
      </g>
    </svg>
    {/* @ts-expect-error circle 没有 d */}
    <circle d="M0 0" />
    {/* @ts-expect-error path 没有 cx */}
    <path cx={1} />
    {/* @ts-expect-error stroke-linecap 取值 */}
    <path stroke-linecap="rounded" />
    {/* @ts-expect-error SVG 元素也没有 HTML 的 disabled */}
    <g disabled />
  </main>
));

let box: HTMLDivElement | null = null;
export const ok: BoolAttr = '';
