// 事件的类型正负例：onXxx、后缀 Capture / Once / Passive（常用事件精确，其余走模式索引签名）、currentTarget 是该元素、on:名字 逃生口。
import { sig } from 'hilt';

const on = sig(false);
const count = sig(0);

export const Events = (
  <main>
    {/* ---- 精确类型：事件对象与 currentTarget ---- */}
    <button onClick={(event) => event.currentTarget.disabled} />
    <button onClick={(event) => event.clientX + event.button} />
    <input onInput={(event) => event.currentTarget.value.toUpperCase()} />
    <input onKeyDown={(event) => event.key} onChange={(event) => event.currentTarget.checked} />
    <input onFocus={(event) => event.relatedTarget} onBlur={(event) => event.currentTarget.select()} />
    <div onPointerDown={(event) => event.pointerId} onWheel={(event) => event.deltaY} />
    <form onSubmit={(event) => event.currentTarget.elements.length} />
    <textarea onSelect={(event) => event.currentTarget.selectionStart} />
    <video onTimeUpdate={(event) => event.currentTarget.currentTime} onCanPlay={(event) => event.currentTarget.duration} />
    <details onToggle={(event) => event.currentTarget.open} />
    <dialog onClose={(event) => event.currentTarget.returnValue} />
    <a onDblClick={(event) => event.currentTarget.href} onContextMenu={(event) => event.pageX} />
    <img onLoad={(event) => event.currentTarget.naturalWidth} onError={(event) => event.currentTarget.currentSrc} />
    <div onDragStart={(event) => event.dataTransfer} onTransitionEnd={(event) => event.propertyName} onAnimationEnd={(event) => event.animationName} />
    <div onScroll={(event) => event.currentTarget.scrollTop} onTouchStart={(event) => event.touches.length} />
    {/* 方法摘下来用（Sig 的方法已绑定）、箭头函数、预先定义的处理函数 */}
    <button onClick={on.toggle} />
    <button onClick={() => count.inc()} />
    <button onClick={function (this: unknown, event: MouseEvent) { return event.detail; }} />
    {/* @ts-expect-error 事件参数类型不对（键盘事件没有 clientX 的 MouseEvent） */}
    <button onClick={(event: KeyboardEvent) => event.key} />
    {/* @ts-expect-error MouseEvent 没有 key */}
    <button onClick={(event) => event.key} />
    {/* @ts-expect-error currentTarget 是 button，没有 value 以外的 input 属性 */}
    <button onClick={(event) => event.currentTarget.checked} />
    {/* @ts-expect-error div 的 currentTarget 没有 value */}
    <div onInput={(event) => event.currentTarget.value} />
    {/* @ts-expect-error 事件处理函数是监听器，不是读取函数的返回值 */}
    <button onClick="alert(1)" />
    {/* @ts-expect-error 不是函数 */}
    <button onClick={1} />

    {/* ---- 后缀：常用事件的单个后缀是精确类型 ---- */}
    <button onClickCapture={(event) => event.clientX} onClickOnce={(event) => event.currentTarget.disabled} onClickPassive={(event) => event.button} />
    <div onScrollPassive={(event) => event.currentTarget.scrollTop} onWheelPassive={(event) => event.deltaY} />
    <input onKeyDownCapture={(event) => event.key} onInputOnce={(event) => event.currentTarget.value} />
    <div onPointerMovePassive={(event) => event.pressure} onTouchStartPassive={(event) => event.touches} />
    {/* @ts-expect-error 精确类型的后缀事件，参数类型不对 */}
    <button onClickCapture={(event) => event.key} />
    {/* @ts-expect-error 同上（Once） */}
    <input onKeyDownOnce={(event) => event.clientX} />

    {/* ---- 后缀：其余事件、组合后缀走模式索引签名（事件对象是通用 Event，要精确类型就标注参数）---- */}
    <div onMouseEnterCapture={(event) => event.type} />
    <div onClickCaptureOnce={(event) => event.currentTarget.id} onClickOncePassive={() => {}} onScrollPassiveCapture={() => {}} />
    <div onPointerEnterOnceCapture={(event: PointerEvent & { currentTarget: HTMLDivElement }) => event.pointerId} />
    <div onFocusInCapture={(event: FocusEvent & { currentTarget: HTMLDivElement }) => event.relatedTarget} />
    {/* @ts-expect-error 标注的事件类型要带 currentTarget，否则和通用 Event 两个方向都不兼容 */}
    <div onFocusInCapture={(event: FocusEvent) => event.relatedTarget} />
    {/* @ts-expect-error 通用 Event 没有 clientX */}
    <div onMouseEnterCapture={(event) => event.clientX} />
    {/* @ts-expect-error currentTarget 仍然是该元素 */}
    <div onMouseEnterCapture={(event) => event.currentTarget.value} />

    {/* ---- on:名字：键名原样当事件名 ---- */}
    <div on:my-Event={(event) => event.type} />
    <div on:transitionend={(event) => event.currentTarget.id} />
    {/* @ts-expect-error on:xxx 的参数是 Event，没有 clientX */}
    <div on:custom={(event) => event.clientX} />

    {/* ---- SVG 元素与 SVG 事件 ---- */}
    <svg onLoad={(event) => event.currentTarget.viewBox.baseVal.width} onClick={(event) => event.currentTarget.createSVGPoint()}>
      <circle onPointerEnter={(event) => event.currentTarget.r.baseVal.value} />
      <path onClick={(event) => event.currentTarget.getTotalLength()} />
    </svg>
    {/* @ts-expect-error circle 的 currentTarget 是 SVGCircleElement，没有 viewBox */}
    <circle onClick={(event) => event.currentTarget.viewBox} />
  </main>
);
