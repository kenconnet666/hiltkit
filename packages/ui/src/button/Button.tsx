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

const styles = create({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '_xs',
    borderWidth: '_hairline',
    borderStyle: 'solid',
    borderRadius: '_sm',
    fontFamily: '_sans',
    fontWeight: '_medium',
    lineHeight: '_tight',
    whiteSpace: 'nowrap',
    cursor: { default: 'pointer', _disabled: 'not-allowed' },
    opacity: { default: 1, _disabled: '_disabled' },
    outlineWidth: { default: 0, _focusVisible: '_thick' },
    outlineStyle: 'solid',
    outlineColor: '_focus',
    outlineOffset: '_thin',
    transition: `background-color ${t.durations.fast} ${t.easings.standard}, border-color ${t.durations.fast} ${t.easings.standard}`,
  },
  sm: { height: '_controlSm', paddingInline: '_sm', fontSize: '_xs' },
  md: { height: '_controlMd', paddingInline: '_md', fontSize: '_sm' },
  lg: { height: '_controlLg', paddingInline: '_lg', fontSize: '_md' },
  primary: {
    color: '_onAccent',
    borderColor: '_accent',
    backgroundColor: { default: '_accent', _hover: '_accentHover', _disabled: '_accent' },
  },
  secondary: {
    color: '_text',
    borderColor: { default: '_border', _hover: '_borderStrong', _disabled: '_border' },
    backgroundColor: { default: 'transparent', _hover: '_fillHover', _disabled: 'transparent' },
  },
  ghost: {
    color: '_text',
    borderColor: 'transparent',
    backgroundColor: { default: 'transparent', _hover: '_fillHover', _disabled: 'transparent' },
  },
  danger: {
    color: '_onBad',
    borderColor: '_bad',
    backgroundColor: '_bad',
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
