// 组件：_component<Props>、参数标注、默认值、rest 转发（HtmlProps / SvgProps）、children、泛型。
import type { BindableProps, Children, HtmlProps, JsxElement, SvgProps } from '@hilt/runtime';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

// ---- 1. _component<Props>：参数是上下文推断出来的 ----
interface BadgeProps {
  tone?: 'info' | 'danger';
  count: number;
  children?: Children;
}
export const Badge = _component<BadgeProps>(({ tone = 'info', count, children }) => {
  assertType<Equal<typeof tone, 'info' | 'danger'>>();
  return <span class={tone}>{count}{children}</span>;
});
export const useBadge = (
  <>
    <Badge count={1} />
    <Badge count={1} tone="danger">文本{1}<b>粗</b></Badge>
    {/* @ts-expect-error 缺必填 */}
    <Badge />
    {/* @ts-expect-error tone 取值 */}
    <Badge count={1} tone="warn" />
    {/* @ts-expect-error 没有这个 prop */}
    <Badge count={1} nope />
  </>
);

// ---- 2. 参数写标注（默认值会被检查）----
interface SizeProps {
  size?: 'sm' | 'md';
}
export const Sized = _component(({
  // @ts-expect-error 'xl' 不在 'sm' | 'md' 里
  size = 'xl',
}: SizeProps) => <i class={size} />);

// ---- 3. 无 props 的组件 ----
export const Empty = _component(() => <hr />);
export const useEmpty = (
  <>
    <Empty />
    {/* @ts-expect-error 没有 props 的组件不收属性 */}
    <Empty id="x" />
  </>
);

// ---- 4. rest 转发到原生元素 ----
interface ButtonProps extends HtmlProps<'button', 'type' | 'aria-busy'> {
  variant?: 'solid' | 'soft';
  loading?: boolean;
}
export const Button = _component<ButtonProps>(({ variant = 'solid', loading, children, ...rest }) => (
  <button type="button" aria-busy={loading ? 'true' : undefined} data-variant={variant} {...rest}>
    {children}
  </button>
));
export const useButton = (
  <>
    <Button variant="soft" onClick={(e) => e.currentTarget.form} disabled>确定</Button>
    <Button sx={[{ marginTop: '_md' }]} class={['a', { b: true }]} style={{ outline: '1px solid red' }} />
    <Button ref={(el) => el?.focus()} />
    {/* @ts-expect-error type 由组件管理 */}
    <Button type="submit" />
    {/* @ts-expect-error aria-busy 由组件管理（连字符属性要靠 never 显式拦） */}
    <Button aria-busy="true" />
    {/* @ts-expect-error variant 取值 */}
    <Button variant="ghost" />
  </>
);

// 转发到别的标签会被拒（currentTarget 的元素类型不同）
export const Cross = _component<HtmlProps<'button'>>(({ ...rest }) => (
  <>
    <button {...rest} />
    {/* @ts-expect-error button 的 props 不能展开到 <a> */}
    <a {...rest} />
  </>
));

// ---- 5. children 的类型 ----
interface PanelProps {
  /** 具名插槽：JSX 元素 */
  header?: JsxElement;
  /** 渲染函数 */
  footer?: (close: () => void) => JsxElement;
  children?: Children;
}
export const Panel = _component<PanelProps>(({ header, footer, children }) => (
  <section>
    {header}
    {children}
    {footer?.(() => {})}
  </section>
));
export const usePanel = (
  <>
    <Panel header={<h1>标题</h1>} footer={(close) => <button onClick={close}>关</button>} />
    <Panel>{[1, 2, 3].map((n) => <i key={n}>{n}</i>)}</Panel>
    <Panel>{null}{false}{undefined}{'x'}{1}</Panel>
    {/* @ts-expect-error 字符串不是 JSX 元素 */}
    <Panel header="标题" />
    {/* @ts-expect-error 对象不是子节点 */}
    <Panel>{{ a: 1 }}</Panel>
  </>
);

// ---- 6. 转发到 SVG；部件不要 children ----
interface IconProps extends SvgProps<'svg', 'children' | 'viewBox'> {
  name: string;
}
export const Icon = _component<IconProps>(({ name, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2} aria-label={name} {...rest}>
    <path d="M0 0L24 24" />
  </svg>
));
export const useIcon = (
  <>
    <Icon name="x" width={16} onClick={(e) => e.currentTarget.viewBox} />
    {/* @ts-expect-error children 由图标自己管 */}
    <Icon name="x"><path /></Icon>
  </>
);

// ---- 7. 泛型组件 ----
interface ListProps<T> {
  items: readonly T[];
  render: (item: T, index: number) => JsxElement;
}
export const List = _component(<T,>({ items, render }: ListProps<T>) => <ul>{items.map(render)}</ul>);
export const useList = (
  <>
    <List items={[1, 2]} render={(n) => <li>{n.toFixed()}</li>} />
    {/* @ts-expect-error T 从 items 推出 number，render 里没有 length */}
    <List items={[1, 2]} render={(n) => <li>{n.length}</li>} />
  </>
);

// ---- 8. 可绑定 prop 与默认值 ----
interface FieldProps extends BindableProps<{ value: string; open: boolean }> {
  size?: 'sm' | 'md';
}
export const Field = _component<FieldProps>(({ value = _bindable(''), open = _bindable(false), size = 'md' }) => {
  assertType<Equal<typeof value, string>>();
  assertType<Equal<typeof open, boolean>>();
  value = 'x';
  // @ts-expect-error 写入类型不对
  value = 1;
  if (open === true) open = false; // 布尔字面量默认值不会收窄成 false
  return <input value={_bind(value)} class={size} />;
});
export const NoDefault = _component<FieldProps>(({ value = _bindable<string>() }) => {
  const maybe: string | undefined = value;
  // @ts-expect-error 没给默认值就可能是 undefined
  const text: string = value;
  return <input value={maybe ?? text} />;
});

// ---- 9. 只读 prop 不能赋值：类型层做不到 ----
export const ReadonlyHole = _component<{ size?: 'sm' | 'md' }>(({ size = 'md' }) => {
  // 做不到：解构出来的是普通局部变量，TypeScript 没有“只读的解构绑定”，赋值照样通过。
  // 这一条只能靠编译器诊断（同一个函数里对非 _bindable / _state 默认值的解构绑定赋值，语法层就能认出来）。
  size = 'sm';
  return <i class={size} />;
});
