/**
 * 组件文案。每个组件自己带一份英文默认值，语言包只覆盖要翻译的部分：
 * 用不到的组件连文案一起摇掉，也不会有一个几百行、所有组件挤在一起的大对象。
 *
 *   const messages = defineMessages('dialog', { close: 'Close', title: (name: string) => `Edit ${name}` });
 *   const t = useMessages(messages);
 *   <button aria-label={() => t().close} />
 *
 * 这里的 Lookup 由 Provider 提供，所以组件不用知道语言包从哪来。
 */
import { derived, type ReadSig } from 'hiltkit';
import { useLocaleState } from './locale';

/** 一条文案：固定文字，或者按参数写出来的函数 */
export type Message = string | ((...args: any[]) => string);
/** 一个组件的全部文案 */
export type Messages = Readonly<Record<string, Message>>;

/**
 * 所有组件的文案登记处，键是命名空间。语言包按它检查：少翻一条、写错名字都报错。
 * 组件库自己的组件在 `locale/catalog.ts` 登记；应用可以用声明合并加自己的：
 *
 *   declare module '@hiltkit/ui' { interface MessageCatalog { orders: typeof orderMessages.defaults } }
 */
export interface MessageCatalog {}

/** 语言包：命名空间 -> 文案，可以只翻一部分，其余回退到上一层、最后是组件自带的英文 */
export type MessagePack = {
  readonly [Namespace in keyof MessageCatalog]?: Partial<MessageCatalog[Namespace]>;
};

/** defineMessages 的结果：传给 useMessages */
export interface MessageDefinition<M extends Messages> {
  readonly namespace: string;
  readonly defaults: M;
}

/** 声明一组文案。defaults 是英文，也是这组文案的类型来源 */
export const defineMessages = <M extends Messages>(
  namespace: string,
  defaults: M,
): MessageDefinition<M> => ({ namespace, defaults });

/**
 * 读当前语言的文案。返回读取函数：`t().close`，写在函数子节点或函数属性里就跟着语言变。
 * 同一层语言包没变时不重新合并。
 */
export function useMessages<M extends Messages>(definition: MessageDefinition<M>): ReadSig<M> {
  const state = useLocaleState();
  return derived(() => {
    const merged: Record<string, Message> = { ...definition.defaults };
    // packs 外层在前：内层写了的覆盖外层
    for (const pack of state.packs()) {
      const part = (pack as Record<string, Messages | undefined>)[definition.namespace];
      if (part) Object.assign(merged, part);
    }
    return merged as unknown as M;
  });
}
