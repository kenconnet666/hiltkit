// 懒加载的组件：模块执行才算真的加载了
import { inject } from '@hilt/runtime';
import { Theme } from './shared';

if (typeof window !== 'undefined') (window as any).log.heavyLoaded++;

export default _component(({ id, label, onHit }) => {
  let hits = _state(0);
  const theme = inject(Theme);
  return (
    <button
      id={id}
      data-theme={theme}
      onClick={() => {
        hits++;
        onHit?.();
      }}
    >
      {label}:{hits}
    </button>
  );
});
