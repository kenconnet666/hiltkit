// 属性透传语义探针的公共部分：子组件自带 class/style/click/ref，父组件也传同名的，
// 点击按钮、读 DOM，看最后谁生效、谁被合并。
export const log = []; // 点击时被调用的处理函数（own = 子组件自己的，parent = 调用方传入的）
export const refs = []; // ref 回调收到的值

export const ownRef = (el) => refs.push({ who: 'own', value: el });
export const parentRef = (el) => refs.push({ who: 'parent', value: el });

/** 对 root 下每个 button 点一次，汇总 DOM 结果 */
export function collect(root) {
  return [...root.querySelectorAll('button')].map((btn) => {
    log.length = 0;
    btn.click();
    return {
      class: btn.className,
      style: btn.getAttribute('style'),
      clicks: log.join('+') || '(none)',
      refHits:
        refs
          .filter((r) => r.value === btn)
          .map((r) => r.who)
          .join('+') || '(none)',
      // 父组件 ref 拿到的不是元素时（例如 Vue 里是组件实例）
      refOther: refs.some((r) => r.who === 'parent' && !(r.value instanceof Element)) ? 'parent ref 收到非元素' : '',
    };
  });
}
