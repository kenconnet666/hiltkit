// 组件库样例：发布时只转 JSX，产物是一份 JS 加 .d.ts，服务端和浏览器共用
import {
  createContext,
  inject,
  merge,
  model,
  provide,
  read,
  sig,
  type Child,
  type Model,
  type Prop,
} from 'hiltkit';
import type { HtmlProps } from 'hiltkit/jsx-runtime';
import { create } from 'hiltkit/css';

const styles = create({
  button: { padding: '4px', color: 'rgb(255, 0, 0)' },
  on: { color: 'rgb(0, 128, 0)' },
});

export interface ButtonProps extends HtmlProps<'button'> {
  loading?: Prop<boolean>;
}
export function Button({ loading, children, ...rest }: ButtonProps) {
  return (
    <button
      {...merge(rest, {
        class: 'lib-button',
        type: 'button',
        sx: [styles.button],
        onClick: (event: Event) => {
          if (read(loading)) event.preventDefault();
        },
      })}
      aria-busy={() => (read(loading) ? 'true' : 'false')}
    >
      {children}
    </button>
  );
}

export interface SwitchProps extends Omit<HtmlProps<'input'>, 'checked'> {
  checked?: Model<boolean>;
  label?: Prop<string>;
}
export function Switch({ checked, label, ...rest }: SwitchProps) {
  const on = model(checked, false);
  return (
    <label sx={[() => on() && styles.on]} data-state={() => (on() ? 'on' : 'off')}>
      <input type="checkbox" {...rest} checked={on} />
      {label}
    </label>
  );
}

export interface SelectProps<T> {
  value?: Model<T | undefined>;
  options: readonly T[];
  text: (item: T) => string;
  id?: string;
}
/** 泛型组件：调用方的 T 由 options 推出来 */
export function Select<T>({ value, options, text, id }: SelectProps<T>) {
  const selected = model<T | undefined>(value, undefined);
  return (
    <div id={id}>
      {options.map((item) => (
        <button
          type="button"
          aria-pressed={() => (selected() === item ? 'true' : 'false')}
          onClick={() => selected.set(item)}
        >
          {text(item)}
        </button>
      ))}
    </div>
  );
}

const Theme = createContext('light');
export function ThemeProvider({ value, children }: { value: string; children?: Child }) {
  provide(Theme, value);
  return children;
}
export function ThemeName({ id }: { id: string }) {
  return <b id={id}>{inject(Theme)}</b>;
}
export const useCounter = (start = 0) => {
  const count = sig(start);
  return { count, add: () => count.inc() };
};
