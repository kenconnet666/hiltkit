/**
 * 应用级的东西：每个 mount、hydrate、renderToString 一个应用实例，互相隔离。
 * 服务按应用单例（服务端按请求隔离），useId 按渲染顺序编号（服务端和客户端一致）。
 */
import {
  getContext,
  getOwner,
  provideValue,
  runSetup,
  runWith,
  scope,
  type Context,
  type EffectNode,
} from '../reactivity/kernel';

/** 上下文里 useId 计数器的键 */
export const IDS = Symbol('ids');
const APP = Symbol('app');

/** 服务端和客户端一致的唯一 id，给 label 的 for、aria-* 用 */
export function useId(): string {
  const ids = getContext()[IDS] as { prefix: string; next: number };
  return `${ids.prefix}${ids.next++}`;
}

/** 服务：第一次 use 时才创建，整个应用（或 provide 的那棵子树）一份，effect 跟着应用走；服务端按请求隔离 */
export function createService<T>(factory: () => T) {
  const id = Symbol('service');
  return {
    use(): T {
      const context = getContext();
      if (context[id] !== undefined) return context[id] as T;
      const app = context[APP] as
        { services: Map<symbol, unknown>; node: EffectNode; context: Context } | undefined;
      if (!app) throw new Error('服务只能在组件或其他服务里使用');
      if (!app.services.has(id)) {
        app.services.set(
          id,
          runWith(app.node, app.context, () => runSetup(factory, undefined)),
        );
      }
      return app.services.get(id) as T;
    },
    /** 这棵子树用自己的一份；传了值就用传的（测试替身） */
    provide(value?: T): T {
      const instance = value !== undefined ? value : runSetup(factory, undefined);
      provideValue(id, instance);
      return instance;
    },
  };
}

/** 建一个应用实例，run 在它的作用域里执行。返回根节点（销毁时 dispose）和 run 的结果 */
export function inApp<T>(run: () => T): { node: EffectNode; result: T } {
  let result!: T;
  const node = runWith(undefined, Object.create(getContext()) as Context, () =>
    scope(() => {
      provideValue(IDS, { prefix: 'h', next: 0 });
      provideValue(APP, { services: new Map(), node: getOwner(), context: getContext() });
      result = run();
    }),
  );
  return { node, result };
}
