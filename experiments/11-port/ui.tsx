// 把 vue-tsx-pro 的 Button、Switch、Tabs 迁到新 API。功能按原组件的主干保留，样式数值从简，只检验写法。
import { createContext, inject, onCleanup, provide } from '@hilt/runtime';
import * as css from '@hilt/css';
import { recipe } from '@hilt/css';

export { css };
export const ported = { rebuilt: { button: 0, content: 0 } };

// ---------------- 按钮 ----------------
const styles = css.create({
  root: { display: 'inline-flex', position: 'relative', gap: '4px', cursor: 'pointer' },
  fullWidth: { display: 'flex', width: '100%' },
  disabled: { opacity: 0.5, cursor: 'not-allowed' },
  content: { display: 'inline-flex', gap: '4px' },
  hidden: { opacity: 0 },
  spinner: { position: 'absolute', inset: 0 },
  sm: { fontSize: '12px' },
  md: { fontSize: '14px' },
  danger: { color: 'rgb(200, 0, 0)' },
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

export const ButtonGroupContext = createContext(null);

/** 原来：useButtonAppearance(() => ({ variant, tone, size, radius }), 'solid')，返回读取函数 */
function useButtonAppearance(options: any, fallbackVariant: string) {
  const group: any = inject(ButtonGroupContext);
  const variant = _derived(options.variant ?? group?.variant ?? fallbackVariant);
  const tone = _derived(options.tone ?? group?.tone ?? 'accent');
  const size = _derived(options.size ?? group?.size);
  return { variant, tone, size };
}

/** 原来：useDelayedLoading(() => loading)，返回 Ref，要写 spinner.value */
function useDelayedLoading(options: any) {
  let visible = _state(false);
  _effect(() => {
    if (!options.loading) {
      visible = false;
      return;
    }
    const id = setTimeout(() => (visible = true), 400);
    return () => clearTimeout(id);
  });
  return { visible };
}

/**
 * 原来要把使用方的 onClick 传进来再转调。现在不用：受管层排在 rest 后面，先执行，
 * preventDefault 之后使用方的 onClick 自动跳过。返回的是活对象，直接展开。
 */
function useButtonBehavior(state: any) {
  const soft = _derived(state.disabled && state.focusableWhenDisabled);
  return {
    disabled: (state.disabled && !state.focusableWhenDisabled) || undefined,
    'aria-disabled': soft ? 'true' : undefined,
    'aria-busy': state.loading ? 'true' : undefined,
    'data-loading': state.loading ? '' : undefined,
    'data-disabled': state.disabled ? '' : undefined,
    onClick(event: Event) {
      if (state.loading || soft) event.preventDefault();
    },
  };
}

export const Icon = _component(({ icon, ...rest }) => <i class="icon" data-icon={icon} {...rest} />);
export const Spinner = _component(({ ...rest }) => <span class="spinner" {...rest} />);

export const Button = _component(
  ({
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
  }: any) => {
    ported.rebuilt.button++;
    const appearance = useButtonAppearance({ variant, tone, size }, 'solid');
    const spinner = useDelayedLoading({ loading });
    const behavior = useButtonBehavior({ disabled, loading, focusableWhenDisabled });
    const parts = buttonRecipe({ variant: appearance.variant, tone: appearance.tone });
    return (
      <button
        {...parts.root}
        type={type}
        sx={[
          styles.root,
          appearance.size && styles[appearance.size],
          fullWidth && styles.fullWidth,
          disabled && styles.disabled,
        ]}
        {...rest}
        {...behavior}
      >
        <span sx={styles.content} {...propsContent} sx={spinner.visible && styles.hidden}>
          {icon && <Icon icon={icon} {...propsIcon} />}
          {children}
          {iconEnd && <Icon icon={iconEnd} {...propsIconEnd} />}
        </span>
        {spinner.visible && <Spinner sx={styles.spinner} {...propsSpinner} />}
      </button>
    );
  },
);

// ---------------- 表单字段 ----------------
const FieldContext = createContext(null);
export const Field = _component(({ id, invalid = false, disabled = false, description, children }: any) => {
  provide(FieldContext, { id, invalid, disabled, describedBy: description ? `${id}-desc` : undefined });
  return (
    <div class="field">
      {children}
      {description && <p id={`${id}-desc`}>{description}</p>}
    </div>
  );
});
/** 原来：useFieldControl(() => ({ id, invalid, required, disabled, readonly }))，返回读取函数，用时写 control().disabled */
function useFieldControl(options: any) {
  const field: any = inject(FieldContext);
  const disabled = _derived(options.disabled ?? field?.disabled ?? false);
  const invalid = _derived(options.invalid ?? field?.invalid ?? false);
  const id = _derived(options.id ?? field?.id);
  const describedBy = _derived(field?.describedBy);
  return { id, disabled, invalid, describedBy, readonly: options.readonly, required: options.required };
}

// ---------------- 开关 ----------------
const switchStyles = css.create({
  label: { display: 'inline-flex', gap: '4px' },
  input: { width: '30px', height: '16px' },
  on: { accentColor: 'rgb(0, 128, 0)' },
  off: { accentColor: 'rgb(128, 128, 128)' },
  invalid: { outlineColor: 'rgb(255, 0, 0)' },
  thumb: { display: 'inline-block', marginInlineStart: '2px' },
  thumbOn: { marginInlineStart: '14px' },
  contentHidden: { visibility: 'hidden' },
});

export const Switch = _component(
  ({
    checked = _bindable(false),
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
  }: any) => {
    const control = useFieldControl({ id, invalid, required, disabled, readonly });
    const spinner = useDelayedLoading({ loading });
    const wide = _derived(checkedContent != null || uncheckedContent != null);
    // 原来是渲染函数里的辅助函数。这里的参数在调用时读一次，内容里的 checked 仍是活的
    const content = (on: boolean, child: any) => (
      <span sx={on !== checked && switchStyles.contentHidden} {...propsContent} aria-hidden="true">
        {child}
      </span>
    );
    return (
      <label
        sx={switchStyles.label}
        {...propsRoot}
        data-state={checked ? 'checked' : 'unchecked'}
        data-disabled={control.disabled ? '' : undefined}
        data-readonly={control.readonly ? '' : undefined}
        data-loading={loading ? '' : undefined}
      >
        <input
          sx={[switchStyles.input, checked ? switchStyles.on : switchStyles.off, control.invalid && switchStyles.invalid]}
          {...rest}
          type="checkbox"
          role="switch"
          id={control.id}
          checked={_bind(checked)}
          disabled={control.disabled}
          required={control.required}
          aria-invalid={control.invalid ? 'true' : undefined}
          aria-readonly={control.readonly ? 'true' : undefined}
          aria-describedby={control.describedBy}
          aria-busy={loading ? 'true' : undefined}
          onClick={(event: Event) => {
            if (loading || control.readonly) event.preventDefault();
          }}
        />
        {wide && content(true, checkedContent)}
        {wide && content(false, uncheckedContent)}
        <span sx={[switchStyles.thumb, checked && switchStyles.thumbOn]} {...propsThumb}>
          {spinner.visible && <Spinner />}
        </span>
        {children && <span {...propsLabel}>{children}</span>}
      </label>
    );
  },
);

// ---------------- 标签页 ----------------
const TabsContext = createContext(null);
const tabStyles = css.create({
  root: { display: 'flex', flexDirection: 'column', gap: '8px' },
  vertical: { flexDirection: 'row' },
  tab: { color: 'rgb(100, 100, 100)' },
  active: { color: 'rgb(0, 0, 255)' },
});
let uid = 0;

export const Tabs = _component(
  ({ value = _bindable<string | undefined>(undefined), orientation = 'horizontal', activation = 'automatic', variant = 'line', lazy = false, children, ...rest }: any) => {
    const baseId = `tabs${++uid}`;
    let registered = _state.raw<string[]>([]);
    const current = _derived(value ?? registered[0]);
    // 原来这里是 8 个手写 getter；活对象规则下直接写
    provide(TabsContext, {
      value: current,
      orientation,
      activation,
      variant,
      lazy,
      select: (next: string) => (value = next),
      id: (part: string, tab: string) => `${baseId}-${part}-${tab}`,
      register(tab: string) {
        // 子组件在自己的设置期调用：只取当前值，不让调用方依赖它
        registered = [..._untrack(registered), tab];
        return () => (registered = registered.filter((item) => item !== tab));
      },
    });
    return (
      <div sx={[tabStyles.root, orientation === 'vertical' && tabStyles.vertical]} {...rest} data-orientation={orientation}>
        {children}
      </div>
    );
  },
);

export const TabList = _component(({ children, ...rest }: any) => {
  const tabs: any = inject(TabsContext);
  const onKeyDown = (event: KeyboardEvent) => {
    const list = event.currentTarget as HTMLElement;
    const items = [...list.querySelectorAll<HTMLElement>('[role=tab]:not([disabled])')];
    const index = items.indexOf(event.target as HTMLElement);
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta || index < 0) return;
    event.preventDefault();
    const next = items[(index + delta + items.length) % items.length];
    next.focus();
    if (tabs.activation === 'automatic') tabs.select(next.dataset.value);
  };
  return (
    <div role="tablist" onKeyDown={onKeyDown} {...rest} aria-orientation={tabs.orientation}>
      {children}
    </div>
  );
});

export const Tab = _component(({ value, disabled = false, children, onClick, ...rest }: any) => {
  const tabs: any = inject(TabsContext);
  const selected = _derived(tabs.value === value);
  // 不放进 _effect：服务端也要注册，否则默认选中第一个对不上；这里也不追踪
  onCleanup(tabs.register(_untrack(value)));
  return (
    <button
      type="button"
      sx={[tabStyles.tab, selected && tabStyles.active]}
      {...rest}
      role="tab"
      data-value={value}
      id={tabs.id('tab', value)}
      aria-selected={selected ? 'true' : 'false'}
      aria-controls={tabs.id('panel', value)}
      tabindex={selected ? '0' : '-1'}
      disabled={disabled}
      onClick={(event: Event) => {
        onClick?.(event);
        if (!event.defaultPrevented) tabs.select(value);
      }}
    >
      {children}
    </button>
  );
});

export const TabPanel = _component(({ value, children, ...rest }: any) => {
  const tabs: any = inject(TabsContext);
  const selected = _derived(tabs.value === value);
  let seen = _state(false);
  _effect(() => {
    if (selected) seen = true;
  });
  return (
    <div role="tabpanel" {...rest} id={tabs.id('panel', value)} aria-labelledby={tabs.id('tab', value)} hidden={!selected}>
      {/* 初始输出不能只靠 _effect：服务端不跑它，选中的面板要由 selected 直接决定 */}
      {(selected || seen || !tabs.lazy) && children}
    </div>
  );
});
