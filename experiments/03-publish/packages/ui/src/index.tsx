// 组件库样例：写法同 vue-tsx-pro 的符文，但没有渲染函数，组件体只执行一次。
import { For } from '@hilt/runtime';

export const BaseButton = _component(({ children, ...rest }) => (
  <button class="base" data-part="root" tabindex="0" {...rest}>
    {children}
  </button>
));

/** 属性按书写顺序合并：内部默认 < 使用方的 rest < 受管属性 */
export const Button = _component(({ size = 'md', loading, children, onClick, ...rest }) => {
  let clicks = _state(0);
  return (
    <BaseButton
      class={`btn btn-${size}`}
      type="button"
      data-scope="button"
      data-clicks={clicks}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) clicks++;
      }}
      {...rest}
      aria-busy={loading ? 'true' : undefined}
      disabled={loading || undefined}
    >
      {loading ? <span class="spinner">…</span> : null}
      {children}
    </BaseButton>
  );
});

export const Switch = _component(({ checked = _bindable(false), label, ...rest }) => (
  <label class="switch" {...rest}>
    <input type="checkbox" checked={_bind(checked)} />
    <span data-state={checked ? 'on' : 'off'}>{label}</span>
  </label>
));

export const List = _component(({ items, children, ...rest }) => (
  <ul class="list" {...rest}>
    <For each={items}>{(item) => <li>{children(item)}</li>}</For>
  </ul>
));

// 只有 app-tree-shake 检查它是否被摇掉
export const NeverUsed = _component(() => <div class="never-used-marker">never used marker</div>);
