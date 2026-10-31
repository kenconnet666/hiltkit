// 把 vue-tsx-pro 的 Button、Field、Switch、Tabs 迁到“零编译”路线：普通函数组件、原生解构、标准 TS JSX。
// 规则：传函数（sig / 箭头函数）是活的，传值只取一次；有 set 才能写回。Props 全部写真实类型，没有 any。
import { createContext, derived, dynamic, effect, inject, merge, model, onCleanup, provide, read, sig, useId, when, type Child, type Model, type Prop, type ReadSig } from 'hilt';
import type { HtmlProps } from 'hilt/jsx-runtime';
import { create, recipe } from 'hilt/css';

/** 测试用：组件函数跑了几次 */
export const ported = { rebuilt: { button: 0 } };

/** 部件属性：值或读取函数，键集合可以随时变（经 dynamic 落到元素上） */
type PartProps<K extends keyof HTMLElementTagNameMap> = Prop<HtmlProps<K> | undefined>;

// ---------------- 按钮 ----------------
const styles = create({
  root: { display: 'inline-flex', position: 'relative', gap: '4px', cursor: 'pointer' },
  fullWidth: { display: 'flex', width: '100%' },
  disabled: { opacity: 0.5, cursor: 'not-allowed' },
  content: { display: 'inline-flex', gap: '4px' },
  hidden: { opacity: 0 },
  spinner: { position: 'absolute', inset: 0 },
  sm: { fontSize: '12px' },
  md: { fontSize: '14px' },
});
const buttonRecipe = recipe({
  name: 'Button',
  parts: ['root'],
  variants: { variant: { solid: {}, outline: {} }, tone: { accent: {}, danger: {} } },
  compound: [
    { when: { variant: 'solid', tone: 'accent' }, root: { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(0, 0, 255)' } },
    { when: { variant: 'solid', tone: 'danger' }, root: { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(255, 0, 0)' } },
    { when: { variant: 'outline', tone: 'accent' }, root: { color: 'rgb(0, 0, 255)', backgroundColor: 'transparent' } },
    { when: { variant: 'outline', tone: 'danger' }, root: { color: 'rgb(255, 0, 0)', backgroundColor: 'transparent' } },
  ],
});

export type ButtonVariant = 'solid' | 'outline';
export type ButtonTone = 'accent' | 'danger';
export type ButtonSize = 'sm' | 'md';

/** 按钮组向子按钮提供的外观：都是 Prop，子按钮在派生里读 */
export interface ButtonGroup {
  variant?: Prop<ButtonVariant | undefined>;
  tone?: Prop<ButtonTone | undefined>;
  size?: Prop<ButtonSize | undefined>;
}
export const ButtonGroupContext = createContext<ButtonGroup | null>(null);

interface AppearanceOptions {
  variant: Prop<ButtonVariant | undefined>;
  tone: Prop<ButtonTone | undefined>;
  size: Prop<ButtonSize | undefined>;
}
/** 自己写的优先，其次按钮组，最后默认 */
function useButtonAppearance(options: AppearanceOptions, fallbackVariant: ButtonVariant) {
  const group = inject(ButtonGroupContext);
  return {
    variant: derived(() => read(options.variant) ?? read(group?.variant) ?? fallbackVariant),
    tone: derived(() => read(options.tone) ?? read(group?.tone) ?? 'accent'),
    size: derived(() => read(options.size) ?? read(group?.size)),
  };
}

/** 加载态延迟显示指示，避免一闪而过 */
function useDelayedLoading(loading: Prop<boolean>, delay = 400): ReadSig<boolean> {
  const visible = sig(false);
  effect(() => {
    if (!read(loading)) {
      visible.set(false);
      return;
    }
    const id = setTimeout(() => visible.set(true), delay);
    return () => clearTimeout(id);
  });
  return visible;
}

interface ButtonState {
  disabled: Prop<boolean>;
  loading: Prop<boolean>;
  focusableWhenDisabled: Prop<boolean>;
}
/**
 * 受管的按钮属性。不用把使用方的 onClick 传进来再转调：merge 里靠后的先执行，
 * preventDefault 之后使用方的 onClick 自动跳过。
 */
function useButtonBehavior(state: ButtonState) {
  const soft = derived(() => read(state.disabled) && read(state.focusableWhenDisabled));
  return {
    disabled: () => (read(state.disabled) && !read(state.focusableWhenDisabled)) || undefined,
    'aria-disabled': () => (soft() ? 'true' : undefined),
    'aria-busy': () => (read(state.loading) ? 'true' : undefined),
    'data-loading': () => (read(state.loading) ? '' : undefined),
    'data-disabled': () => (read(state.disabled) ? '' : undefined),
    onClick(event: MouseEvent) {
      if (read(state.loading) || soft()) event.preventDefault();
    },
  };
}

export interface IconProps extends HtmlProps<'i'> {
  icon: Prop<string>;
}
export function Icon({ icon, ...rest }: IconProps) {
  return <i {...merge({ class: 'icon', 'data-icon': icon }, rest)} />;
}
export function Spinner(props: HtmlProps<'span'>) {
  return <span {...merge({ class: 'spinner' }, props)} />;
}

export interface ButtonProps extends Omit<HtmlProps<'button'>, 'type' | 'disabled'> {
  variant?: Prop<ButtonVariant | undefined>;
  tone?: Prop<ButtonTone | undefined>;
  size?: Prop<ButtonSize | undefined>;
  loading?: Prop<boolean>;
  icon?: Prop<string | undefined>;
  iconEnd?: Prop<string | undefined>;
  fullWidth?: Prop<boolean>;
  disabled?: Prop<boolean>;
  focusableWhenDisabled?: Prop<boolean>;
  type?: Prop<'button' | 'submit' | 'reset'>;
  propsContent?: PartProps<'span'>;
  propsIcon?: PartProps<'i'>;
  propsIconEnd?: PartProps<'i'>;
  propsSpinner?: PartProps<'span'>;
}

export function Button({
  variant,
  tone,
  size,
  loading = false,
  icon,
  iconEnd,
  fullWidth = false,
  propsContent,
  propsIcon,
  propsIconEnd,
  propsSpinner,
  disabled = false,
  focusableWhenDisabled = false,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  ported.rebuilt.button++;
  const appearance = useButtonAppearance({ variant, tone, size }, 'solid');
  const spinner = useDelayedLoading(loading);
  const behavior = useButtonBehavior({ disabled, loading, focusableWhenDisabled });
  const parts = buttonRecipe({ variant: appearance.variant, tone: appearance.tone });
  const own = {
    type,
    sx: [
      styles.root,
      () => {
        const name = appearance.size();
        return name && styles[name];
      },
      () => read(fullWidth) && styles.fullWidth,
      () => read(disabled) && styles.disabled,
    ],
  };
  return (
    <button {...merge(merge(parts.root, own), rest, behavior)}>
      <span sx={[styles.content, () => spinner() && styles.hidden]} {...dynamic(() => read(propsContent))}>
        {/* 图标的 class 要和 Icon 自己的拼接，而 dynamic 会整个替换同名键（bugs/dynamic-layering.mjs），所以这里在函数里重建图标 */}
        {when(icon, (name) => () => <Icon icon={name} {...read(propsIcon)} />)}
        {children}
        {when(iconEnd, (name) => () => <Icon icon={name} {...read(propsIconEnd)} />)}
      </span>
      {() => spinner() && <Spinner sx={styles.spinner} {...dynamic(() => read(propsSpinner))} />}
    </button>
  );
}

// ---------------- 表单字段 ----------------
interface FieldControl {
  id: Prop<string | undefined>;
  invalid: Prop<boolean>;
  disabled: Prop<boolean>;
  describedBy: Prop<string | undefined>;
}
const FieldContext = createContext<FieldControl | null>(null);

export interface FieldProps {
  id: Prop<string>;
  invalid?: Prop<boolean>;
  disabled?: Prop<boolean>;
  description?: Prop<string | undefined>;
  children?: Child;
}
export function Field({ id, invalid = false, disabled = false, description, children }: FieldProps) {
  provide(FieldContext, { id, invalid, disabled, describedBy: () => (read(description) ? `${read(id)}-desc` : undefined) });
  return (
    <div class="field">
      {children}
      {when(description, (text) => (
        <p id={() => `${read(id)}-desc`}>{text}</p>
      ))}
    </div>
  );
}

interface FieldControlOptions {
  id?: Prop<string | undefined>;
  invalid?: Prop<boolean | undefined>;
  required?: Prop<boolean | undefined>;
  disabled?: Prop<boolean | undefined>;
  readonly?: Prop<boolean | undefined>;
}
/** 自己传的优先，其次 Field 提供的；返回的都是读取函数 */
function useFieldControl(options: FieldControlOptions) {
  const field = inject(FieldContext);
  return {
    id: derived(() => read(options.id) ?? read(field?.id)),
    disabled: derived(() => read(options.disabled) ?? read(field?.disabled) ?? false),
    invalid: derived(() => read(options.invalid) ?? read(field?.invalid) ?? false),
    describedBy: derived(() => read(field?.describedBy)),
    readonly: derived(() => read(options.readonly) ?? false),
    required: derived(() => read(options.required) ?? false),
  };
}

// ---------------- 开关 ----------------
const switchStyles = create({
  label: { display: 'inline-flex', gap: '4px' },
  input: { width: '30px', height: '16px' },
  on: { accentColor: 'rgb(0, 128, 0)' },
  off: { accentColor: 'rgb(128, 128, 128)' },
  invalid: { outlineColor: 'rgb(255, 0, 0)' },
  thumb: { display: 'inline-block', marginInlineStart: '2px' },
  thumbOn: { marginInlineStart: '14px' },
  contentHidden: { visibility: 'hidden' },
});

export interface SwitchProps extends Omit<HtmlProps<'input'>, 'checked' | 'type' | 'value'> {
  checked?: Model<boolean>;
  invalid?: Prop<boolean | undefined>;
  loading?: Prop<boolean>;
  checkedContent?: Child;
  uncheckedContent?: Child;
  propsRoot?: PartProps<'label'>;
  propsThumb?: PartProps<'span'>;
  propsContent?: PartProps<'span'>;
  propsLabel?: PartProps<'span'>;
}

const present = (content: Child) => (typeof content === 'function' ? content() : content) != null;

export function Switch({
  checked,
  disabled,
  readonly,
  required,
  invalid,
  loading = false,
  checkedContent,
  uncheckedContent,
  id,
  propsRoot,
  propsThumb,
  propsContent,
  propsLabel,
  children,
  ...rest
}: SwitchProps) {
  const on = model(checked, false);
  const control = useFieldControl({ id, invalid, required, disabled, readonly });
  const spinner = useDelayedLoading(loading);
  const wide = derived(() => present(checkedContent) || present(uncheckedContent));
  // 参数在调用时取一次；内容是否隐藏靠 sx 里的函数，跟着 on 变
  const content = (shown: boolean, child: Child) => (
    <span sx={[() => shown !== on() && switchStyles.contentHidden]} {...dynamic(() => read(propsContent))} aria-hidden="true">
      {child}
    </span>
  );
  return (
    <label
      sx={[switchStyles.label]}
      {...dynamic(() => read(propsRoot))}
      data-state={() => (on() ? 'checked' : 'unchecked')}
      data-disabled={() => (control.disabled() ? '' : undefined)}
      data-readonly={() => (control.readonly() ? '' : undefined)}
      data-loading={() => (read(loading) ? '' : undefined)}
    >
      <input
        {...merge(
          merge({ sx: [switchStyles.input, () => (on() ? switchStyles.on : switchStyles.off), () => control.invalid() && switchStyles.invalid] }, rest),
          {
            type: 'checkbox',
            role: 'switch',
            id: control.id,
            checked: on,
            disabled: control.disabled,
            required: control.required,
            'aria-invalid': () => (control.invalid() ? 'true' : undefined),
            'aria-readonly': () => (control.readonly() ? 'true' : undefined),
            'aria-describedby': control.describedBy,
            'aria-busy': () => (read(loading) ? 'true' : undefined),
            onClick(event: MouseEvent) {
              if (read(loading) || control.readonly()) event.preventDefault();
            },
          },
        )}
      />
      {() => wide() && content(true, checkedContent)}
      {() => wide() && content(false, uncheckedContent)}
      <span sx={[switchStyles.thumb, () => on() && switchStyles.thumbOn]} {...dynamic(() => read(propsThumb))}>
        {() => spinner() && <Spinner />}
      </span>
      {children && <span {...dynamic(() => read(propsLabel))}>{children}</span>}
    </label>
  );
}

// ---------------- 标签页 ----------------
type Orientation = 'horizontal' | 'vertical';
type Activation = 'automatic' | 'manual';

interface TabsApi {
  value: ReadSig<string | undefined>;
  orientation: Prop<Orientation>;
  activation: Prop<Activation>;
  lazy: Prop<boolean>;
  select(next: string): void;
  id(part: 'tab' | 'panel', tab: string): string;
  /** 在子组件自己的设置期调用，返回注销函数 */
  register(tab: string): () => void;
}
const TabsContext = createContext<TabsApi | null>(null);
const useTabs = () => {
  const tabs = inject(TabsContext);
  if (!tabs) throw new Error('Tab、TabList、TabPanel 必须放在 Tabs 里');
  return tabs;
};
const tabStyles = create({
  root: { display: 'flex', flexDirection: 'column', gap: '8px' },
  vertical: { flexDirection: 'row' },
  tab: { color: 'rgb(100, 100, 100)' },
  active: { color: 'rgb(0, 0, 255)' },
});

export interface TabsProps extends HtmlProps<'div'> {
  value?: Model<string | undefined>;
  orientation?: Prop<Orientation>;
  activation?: Prop<Activation>;
  variant?: Prop<'line' | 'enclosed'>;
  lazy?: Prop<boolean>;
}
export function Tabs({ value, orientation = 'horizontal', activation = 'automatic', variant, lazy = false, children, ...rest }: TabsProps) {
  void variant;
  const baseId = useId();
  const selected = model(value, undefined);
  const registered = sig<string[]>([]);
  const current = derived(() => selected() ?? registered()[0]);
  provide(TabsContext, {
    value: current,
    orientation,
    activation,
    lazy,
    select: (next) => selected.set(next),
    id: (part, tab) => `${baseId}-${part}-${tab}`,
    register(tab) {
      registered.update((list) => [...list, tab]);
      return () => registered.update((list) => list.filter((item) => item !== tab));
    },
  });
  return (
    <div {...merge({ sx: [tabStyles.root, () => read(orientation) === 'vertical' && tabStyles.vertical] }, rest, { 'data-orientation': orientation })}>
      {children}
    </div>
  );
}

export function TabList({ children, ...rest }: HtmlProps<'div'>) {
  const tabs = useTabs();
  const onKeyDown = (event: KeyboardEvent) => {
    const list = event.currentTarget as HTMLElement;
    const items = [...list.querySelectorAll<HTMLElement>('[role=tab]:not([disabled])')];
    const index = items.indexOf(event.target as HTMLElement);
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta || index < 0) return;
    event.preventDefault();
    const next = items[(index + delta + items.length) % items.length];
    if (!next) return;
    next.focus();
    if (read(tabs.activation) === 'automatic' && next.dataset.value !== undefined) tabs.select(next.dataset.value);
  };
  return (
    <div {...merge({ role: 'tablist', onKeyDown }, rest, { 'aria-orientation': tabs.orientation })}>{children}</div>
  );
}

export interface TabProps extends HtmlProps<'button'> {
  value: string;
}
export function Tab({ value, disabled, children, ...rest }: TabProps) {
  const tabs = useTabs();
  const selected = derived(() => tabs.value() === value);
  // 不放进 effect：服务端也要注册，否则默认选中第一个对不上
  onCleanup(tabs.register(value));
  return (
    <button
      {...merge(
        // 自己的 onClick 排在 rest 前面：使用方的先执行，它 preventDefault 就不切换
        merge({ type: 'button', sx: [tabStyles.tab, () => selected() && tabStyles.active], onClick: () => tabs.select(value) }, rest),
        {
          role: 'tab',
          'data-value': value,
          id: tabs.id('tab', value),
          'aria-selected': () => (selected() ? 'true' : 'false'),
          'aria-controls': tabs.id('panel', value),
          tabindex: () => (selected() ? '0' : '-1'),
          disabled,
        },
      )}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps extends HtmlProps<'div'> {
  value: string;
}
export function TabPanel({ value, children, ...rest }: TabPanelProps) {
  const tabs = useTabs();
  const selected = derived(() => tabs.value() === value);
  const seen = sig(false);
  effect(() => {
    if (selected()) seen.set(true);
  });
  // 初始输出不能只靠 effect：服务端不跑它，选中的面板要由 selected 直接决定
  const show = derived(() => selected() || seen() || !read(tabs.lazy));
  return (
    <div {...merge(merge({ role: 'tabpanel' }, rest), { id: tabs.id('panel', value), 'aria-labelledby': tabs.id('tab', value), hidden: () => !selected() })}>
      {() => show() && children}
    </div>
  );
}
