// 事件：onClick、后缀 Capture / Once / Passive 及其组合、on:名字 逃生、currentTarget 是该元素。
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

export const Events = _component<{}>(() => {
  let name = _state('');
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <input
        onInput={(e) => (name = e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => e.currentTarget.valueAsNumber}
        onPaste={(e) => e.clipboardData}
      />
      <textarea onInput={(e) => e.currentTarget.value.length} />
      <select onChange={(e) => e.currentTarget.selectedOptions} />
      <button onClick={(e) => e.currentTarget.form} />
      <a onClick={(e) => e.currentTarget.href} />
      <svg onClick={(e) => e.currentTarget.viewBox} />
      <circle onPointerDown={(e) => e.currentTarget.r} />
      <div onClick={(e) => { const el: HTMLDivElement = e.currentTarget; const ev: MouseEvent = e; void [el, ev]; }} />
      {/* @ts-expect-error currentTarget 是 div，不是 input */}
      <div onClick={(e) => { const el: HTMLInputElement = e.currentTarget; void el; }} />
      <div onDblClick={(e) => e.detail} onContextMenu={(e) => e.preventDefault()} onKeyUp={(e) => e.code} />
      <div onWheel={(e) => e.deltaY} onPointerEnter={(e) => e.pointerType} onTouchStart={(e) => e.touches} />
      <video onTimeUpdate={(e) => e.currentTarget.currentTime} onCanPlay={(e) => e.currentTarget.duration} />
      <dialog onClose={(e) => e.currentTarget.returnValue} onCancel={() => {}} />
      <details onToggle={(e) => e.currentTarget.open} />

      {/* ---- 后缀：Capture / Once / Passive ---- */}
      <div onClickCapture={(e) => e.clientX} />
      <div onClickOnce={(e) => e.clientX} />
      <div onWheelPassive={(e) => e.deltaY} />
      {/* 常用事件的单个后缀是精确类型；其余事件的单个后缀走模式索引签名：事件对象是通用 Event，事件名不检查 */}
      <div onFullscreenChangeCapture={(e) => e.type} onPointerEnterOnce={(e) => e.type} />
      <div onClikCapture={() => {}} />
      {/* @ts-expect-error 通用 Event 上没有 clientX（onPointerEnter 不在精确类型的清单里） */}
      <div onPointerEnterOnce={(e) => e.clientX} />

      {/* ---- 组合后缀，顺序随意（运行时从尾部逐个剥）：事件对象是通用 Event，要精确类型就标注参数（带上 currentTarget）---- */}
      <div onClickCaptureOnce={(e) => e.currentTarget.id} />
      <div onClickOnceCapture={(e: MouseEvent & { currentTarget: HTMLDivElement }) => e.clientX} />
      <div onWheelCapturePassive={(e: WheelEvent & { currentTarget: HTMLDivElement }) => e.deltaY} />
      <div onWheelPassiveOnce={(e: WheelEvent & { currentTarget: HTMLDivElement }) => e.deltaY} />
      <div onTouchStartCaptureOncePassive={(e: TouchEvent & { currentTarget: HTMLDivElement }) => e.touches} />
      <div onTouchStartPassiveCaptureOnce={(e) => e.type} />
      {/* 组合后缀的限制：事件名只检查“以合法后缀结尾”，onClikCaptureOnce 这种拼错的名字过得去 */}
      <div onClikCaptureOnce={() => {}} />
      {/* @ts-expect-error 组合后缀的处理函数参数不是该事件的类型：MouseEvent 的 clientX 在通用 Event 上没有 */}
      <div onClickCaptureOnce={(e) => e.clientX} />
      <input onKeyDownCapture={(e) => e.currentTarget.value} />
      <div onPointerMoveOnce={(e) => e.pointerId} />
      <div onAnimationEnd={(e) => e.animationName} onTransitionEnd={(e) => e.propertyName} />
      {/* 事件参数随事件变：onWheelPassive 的参数是 WheelEvent */}
      <div onWheelPassive={(e) => assertType<Equal<typeof e.deltaY, number>>()} />

      {/* ---- on:名字：键名原样当事件名，给大小写敏感的自定义事件 ---- */}
      <div on:myEvent={(e) => e.type} on:click={(e) => e.currentTarget.id} />

      {/* ---- 反例 ---- */}
      {/* @ts-expect-error div 没有 .value */}
      <div onInput={(e) => e.currentTarget.value} />
      {/* @ts-expect-error 事件名拼错（onClik） */}
      <div onClik={() => {}} />
      {/* @ts-expect-error 后缀拼错（Captrue） */}
      <div onClickCaptrue={() => {}} />
      {/* 后缀重复也过得去（模式只看结尾，运行时照样逐个剥掉），不当作错误 */}
      <div onClickCaptureCapture={() => {}} />
      {/* @ts-expect-error 参数类型：click 是 MouseEvent，没有 key */}
      <div onClick={(e) => e.key} />
      {/* @ts-expect-error 处理函数必须是函数 */}
      <div onClick="alert(1)" />
      {/* @ts-expect-error 小写 onclick 不是事件键 */}
      <div onclick={() => {}} />
      {/* @ts-expect-error on: 的处理函数必须是函数 */}
      <div on:foo="x" />
      {/* @ts-expect-error SVG 元素上同样检查 currentTarget（circle 没有 viewBox） */}
      <circle onClick={(e) => e.currentTarget.viewBox} />
      {name}
    </form>
  );
});
