/**
 * 第 1、2 条：_component 的参数解构、rest 的类型、泛型组件、受管属性。
 */
import { css, For, type Children, type JSX, type PartProps } from 'exp06';

const styles = css.create({ root: { display: 'inline-flex' } });

// ---- 基础写法：_component<Props>(...) --------------------------------------------------------

interface ButtonProps extends PartProps<'button', 'role' | 'aria-busy'> {
  size?: 'sm' | 'md';
  loading?: boolean;
  propsIcon?: PartProps<'svg', 'children'>;
  icon?: JSX.Element;
}

export const Button = _component<ButtonProps>(
  ({ size = 'md', loading, icon, propsIcon, children, ...rest }) => {
    // 默认值把 'sm' | 'md' | undefined 收窄成 'sm' | 'md'
    const s: 'sm' | 'md' = size;
    // children 的类型就是 PartProps 里的 Children
    const c: Children = children;

    // rest 恰好排除了已解构的键：解构出的键不在 rest 里
    // @ts-expect-error size 已经被解构，rest 里没有
    rest.size;
    // @ts-expect-error propsIcon 已经被解构
    rest.propsIcon;
    // @ts-expect-error children 已经被解构
    rest.children;
    // 没解构的键还在
    rest.sx;
    rest.onClick;
    rest.type;
    rest.disabled;

    return (
      <button type="button" class="btn" sx={styles.root} {...rest} aria-busy={loading ? 'true' : undefined}>
        {icon}
        {children}
        {propsIcon && <svg {...propsIcon} />}
      </button>
    );
  },
);

// ---- 使用方：受管属性不能传 --------------------------------------------------------------------

export const useButton = () => (
  <>
    <Button size="sm" onClick={(e) => e.currentTarget.disabled}>
      确定
    </Button>
    {/* @ts-expect-error role 是受管属性，PartProps 的第二个参数把它去掉了 */}
    <Button role="switch" />
    {/* @ts-expect-error aria-busy 带连字符：只用 Omit 的话 JSX 不会报错，必须显式标成 never */}
    <Button aria-busy="true" />
    {/* @ts-expect-error size 的取值 */}
    <Button size="xl" />
    {/* 非受管的 aria 照常可传 */}
    <Button aria-label="x" aria-pressed="true" />
    {/* children 可以是元素、文本、假值、数组 */}
    <Button>
      {false}
      {[<span>a</span>, 'b']}
    </Button>
  </>
);

// ---- children 收窄 -----------------------------------------------------------------------------

interface TextButtonProps extends PartProps<'button', 'children'> {
  children: string;
}
export const TextButton = _component<TextButtonProps>(({ children, ...rest }) => (
  <button {...rest}>{children}</button>
));
export const useTextButton = () => (
  <>
    <TextButton>hi</TextButton>
    {/* @ts-expect-error children 收窄为 string */}
    <TextButton>{1 + 1}</TextButton>
    {/* @ts-expect-error children 必填 */}
    <TextButton />
  </>
);

// ---- 不声明 children 的组件：给它内容就报错 ----------------------------------------------------

interface BadgeProps {
  label: string;
}
export const Badge = _component<BadgeProps>(({ label }) => <b>{label}</b>);
export const useBadge = () => (
  <>
    <Badge label="x" />
    {/* @ts-expect-error Badge 没有 children prop */}
    <Badge label="x">内容</Badge>
  </>
);

// ---- 泛型组件：两种写法 ---------------------------------------------------------------------

interface ListProps<T> {
  items: readonly T[];
  render?: (item: T) => JSX.Element;
  selected?: T;
  children?: Children;
}
// 写法 A：_component(<T,>(props) => …)：T 能保留
export const ListA = _component(<T,>({ items, render, selected, ...rest }: ListProps<T>) => (
  <ul {...rest}>
    <For each={items}>{(item) => <li aria-selected={item === selected}>{render?.(item)}</li>}</For>
  </ul>
));
// 写法 B：_component<ListProps<string>>(…) 只能写死类型，不是泛型组件
export const ListB = _component<ListProps<string>>(({ items }) => <ul>{items.length}</ul>);

export const useList = () => (
  <>
    {/* T 从 items 推出 */}
    <ListA items={[1, 2, 3]} render={(n) => <i>{n.toFixed()}</i>} selected={2} />
    <ListA items={['a', 'b']} render={(s) => <i>{s.toUpperCase()}</i>} />
    {/* @ts-expect-error selected 与 items 的 T 冲突（T 同时从两处推：string 与 number） */}
    <ListA items={['a']} selected={1} />
    {/* 显式类型实参 */}
    <ListA<number> items={[1]} />
    <ListB items={['x']} />
    {/* @ts-expect-error 写法 B 不是泛型 */}
    <ListB items={[1]} />
  </>
);

// 泛型组件的 rest：Omit 了已解构的键，仍能展开到 <ul>
export const ListC = _component(<T extends { id: string }>({ items, ...rest }: ListProps<T>) => (
  <ul {...rest}>{items.map((item) => <li key={item.id}>{item.id}</li>)}</ul>
));
export const useListC = () => (
  <>
    <ListC items={[{ id: 'a', n: 1 }]} />
    {/* @ts-expect-error 约束 T extends { id: string } */}
    <ListC items={[{ n: 1 }]} />
  </>
);
