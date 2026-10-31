/**
 * 按钮。默认是次要样式：一屏最多一个 primary，颜色只留给要紧的操作。
 *
 *   <Button variant="primary" onClick={save}>保存</Button>
 *
 * 其余属性原样落到原生 button 上。type 默认 button，避免在表单里意外提交。
 */
import { merge, type Prop } from 'hiltkit';
import { create } from 'hiltkit/css';
import type { HtmlProps } from 'hiltkit/jsx-runtime';
import { rippleStyles, useRipple } from '../theme/ripple';
import { t } from '../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends HtmlProps<'button'> {
  /** 外观。默认 secondary */
  variant?: ButtonVariant;
  /** 尺寸。默认 md */
  size?: ButtonSize;
  /** 按下时的波纹。不写时跟随 Provider */
  ripple?: Prop<boolean | undefined>;
}

const transition = ['background-color', 'border-color', 'color']
  .map((name) => `${name} ${t.durations.fast} ${t.easings.standard}`)
  .join(', ');

const styles = create({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '_xs',
    minWidth: '_buttonMin',
    borderWidth: '_thin',
    borderStyle: 'solid',
    borderRadius: '_sm',
    fontFamily: '_sans',
    fontWeight: '_medium',
    lineHeight: '_tight',
    whiteSpace: 'nowrap',
    cursor: { default: 'pointer', _disabled: 'default' },
    outlineWidth: { default: 0, _focusVisible: '_thick' },
    outlineStyle: 'solid',
    outlineColor: '_focus',
    outlineOffset: '_thin',
    transition,
  },
  sm: { height: '_controlSm', paddingInline: '_md', fontSize: '_sm' },
  md: { height: '_controlMd', paddingInline: '_lg', fontSize: '_md' },
  lg: { height: '_controlLg', paddingInline: '_xl', fontSize: '_md' },
  primary: {
    color: { default: '_onAccent', _disabled: '_textDisabled' },
    borderColor: { default: '_accent', _hover: '_accentHover', _disabled: 'transparent' },
    backgroundColor: { default: '_accent', _hover: '_accentHover', _disabled: '_fillDisabled' },
  },
  secondary: {
    color: { default: '_text', _disabled: '_textDisabled' },
    borderColor: { default: '_borderSubtle', _hover: '_border', _disabled: '_fillDisabled' },
    backgroundColor: { default: 'transparent', _hover: '_fillHover', _disabled: 'transparent' },
  },
  ghost: {
    color: { default: '_text', _disabled: '_textDisabled' },
    borderColor: 'transparent',
    backgroundColor: { default: 'transparent', _hover: '_fillHover', _disabled: 'transparent' },
  },
  danger: {
    color: { default: '_onBad', _disabled: '_textDisabled' },
    borderColor: { default: '_badFill', _hover: '_badFillHover', _disabled: 'transparent' },
    backgroundColor: { default: '_badFill', _hover: '_badFillHover', _disabled: '_fillDisabled' },
  },
});

export function Button({
  variant = 'secondary',
  size = 'md',
  ripple,
  children,
  ...rest
}: ButtonProps) {
  const handlers = useRipple(ripple);
  return (
    <button
      {...merge({ type: 'button' as const }, rest as object, {
        sx: [styles.root, styles[size], styles[variant], rippleStyles.host],
        onPointerDown: handlers.onPointerDown,
        onKeyDown: handlers.onKeyDown,
      })}
    >
      {children}
    </button>
  );
}
