// 主题、token 直写、波纹、按钮：真浏览器里跑
import { describe, expect, test, vi } from 'vitest';
import { flushSync, mount, sig } from 'hiltkit';
import { create } from 'hiltkit/css';
import {
  Button,
  Provider,
  darkTheme,
  defineTheme,
  lightTheme,
  navyTheme,
  rippleStyles,
  t,
  transitions,
  useRipple,
  useTheme,
  type Theme,
} from '@hiltkit/ui';

const render = (view: () => unknown) => {
  const host = document.body.appendChild(document.createElement('div'));
  const unmount = mount(view, host);
  return { host, unmount };
};
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};
const styles = create({
  box: {
    color: '_text',
    backgroundColor: '_surface',
    borderTopColor: '_accent',
    borderTopStyle: 'solid',
    borderTopWidth: '_thin',
    borderRadius: '_sm',
    paddingBlock: '_md',
    fontSize: '_lg',
    transitionDuration: '_fast',
  },
});

describe('token 直写', () => {
  test('短写按属性找到对应的组，落到 CSS 变量上', () => {
    const { host, unmount } = render(() => <i sx={styles.box} />);
    const style = getComputedStyle(host.querySelector('i')!);
    expect(style.borderTopLeftRadius).toBe('3px');
    expect(style.paddingBlockStart).toBe('12px');
    expect(style.fontSize).toBe('16px');
    expect(style.color).toBe(rgb(lightTheme.colors.text));
    unmount();
  });

  test('t 给模板字符串用，是 CSS 变量引用', () => {
    expect(t.colors.accent).toMatch(/^var\(--hk-colors-accent\)$/);
    expect(t.durations.fast).toMatch(/^var\(--hk-durations-fast\)$/);
  });

  test('不写主题时就是亮色', () => {
    const { host, unmount } = render(() => <i sx={styles.box} />);
    expect(getComputedStyle(host.querySelector('i')!).backgroundColor).toBe(rgb('#FFFFFF'));
    unmount();
  });
});

describe('主题', () => {
  for (const theme of [lightTheme, darkTheme, navyTheme]) {
    test(`${theme.name}：token 跟着换`, () => {
      const { host, unmount } = render(() => (
        <Provider theme={theme}>
          <i sx={styles.box} />
        </Provider>
      ));
      const style = getComputedStyle(host.querySelector('i')!);
      expect(style.color).toBe(rgb(theme.colors.text));
      expect(style.backgroundColor).toBe(rgb(theme.colors.surface));
      expect(style.borderTopColor).toBe(rgb(theme.colors.accent));
      const wrapper = host.firstElementChild as HTMLElement;
      expect(wrapper.dataset.theme).toBe(theme.name);
      expect(wrapper.style.colorScheme).toBe(theme.colorScheme);
      unmount();
    });
  }

  test('切换主题：子树不重建，颜色立即变', () => {
    const theme = sig.raw<Theme>(lightTheme);
    let builds = 0;
    const Child = () => {
      builds++;
      return <i sx={styles.box} />;
    };
    const { host, unmount } = render(() => (
      <Provider theme={theme}>
        <Child />
      </Provider>
    ));
    const element = host.querySelector('i')!;
    theme.set(navyTheme);
    flushSync();
    expect(builds).toBe(1);
    expect(host.querySelector('i')).toBe(element);
    expect(getComputedStyle(element).backgroundColor).toBe(rgb(navyTheme.colors.surface));
    expect(document.documentElement.style.backgroundColor).toBe(rgb(navyTheme.colors.canvas));
    unmount();
    expect(document.documentElement.style.backgroundColor).toBe('');
  });

  test('嵌套：内层主题只影响内层，useTheme 读到最近的', () => {
    let inner: Theme | undefined;
    const Probe = () => {
      const theme = useTheme();
      inner = theme();
      return <b sx={styles.box} />;
    };
    const { host, unmount } = render(() => (
      <Provider theme={lightTheme}>
        <i sx={styles.box} />
        <Provider theme={darkTheme}>
          <Probe />
        </Provider>
      </Provider>
    ));
    expect(inner).toBe(darkTheme);
    expect(getComputedStyle(host.querySelector('i')!).backgroundColor).toBe(rgb('#FFFFFF'));
    expect(getComputedStyle(host.querySelector('b')!).backgroundColor).toBe(
      rgb(darkTheme.colors.surface),
    );
    unmount();
  });

  test('自建主题：只写主色，其余算出来', () => {
    const brand = defineTheme(lightTheme, { name: 'brand', colors: { accent: '#0B6E4F' } });
    expect(brand.colors.onAccent).toBe('#FFFFFF');
    expect(brand.colors.accentText).toBe('#0B6E4F');
    expect(brand.colors.accentHover).toContain('#0B6E4F');
    expect(brand.colors.surface).toBe(lightTheme.colors.surface);
    const bright = defineTheme(lightTheme, { name: 'bright', colors: { accent: '#FFD84D' } });
    expect(bright.colors.onAccent).toBe('#101114');
    const { host, unmount } = render(() => (
      <Provider theme={brand}>
        <i sx={styles.box} />
      </Provider>
    ));
    expect(getComputedStyle(host.querySelector('i')!).borderTopColor).toBe(rgb('#0B6E4F'));
    unmount();
  });

  test('自建主题对比度不够：上报 HILT008', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    defineTheme(lightTheme, { name: 'pale', colors: { text: '#CCCCCC' } });
    expect(warn.mock.calls.map((call) => String(call[0])).join()).toContain('HILT008');
    warn.mockRestore();
  });
});

describe('波纹', () => {
  const press = (element: Element, x = 5, y = 5) =>
    element.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }),
    );
  const count = (element: Element) => element.querySelectorAll('[data-ripple]').length;

  test('按下出现，松开后消失', async () => {
    const { host, unmount } = render(() => (
      <Provider>
        <Button>保存</Button>
      </Provider>
    ));
    const button = host.querySelector('button')!;
    press(button);
    expect(count(button)).toBe(1);
    expect(getComputedStyle(button).overflow).toBe('hidden');
    window.dispatchEvent(new PointerEvent('pointerup'));
    await vi.waitFor(() => expect(count(button)).toBe(0), { timeout: 2000 });
    unmount();
  });

  test('键盘只认 Enter、空格，重复按不算', () => {
    const { host, unmount } = render(() => <Button>保存</Button>);
    const button = host.querySelector('button')!;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    button.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }),
    );
    expect(count(button)).toBe(0);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(count(button)).toBe(1);
    unmount();
  });

  test('右键、禁用的按钮不出波纹', () => {
    const { host, unmount } = render(() => (
      <>
        <Button id="a">甲</Button>
        <Button id="b" disabled>
          乙
        </Button>
      </>
    ));
    const a = host.querySelector('#a')!;
    a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }));
    expect(count(a)).toBe(0);
    const b = host.querySelector('#b')!;
    press(b);
    expect(count(b)).toBe(0);
    unmount();
  });

  test('Provider 关掉，组件可以单独打开', () => {
    const { host, unmount } = render(() => (
      <Provider ripple={false}>
        <Button id="a">甲</Button>
        <Button id="b" ripple>
          乙
        </Button>
      </Provider>
    ));
    press(host.querySelector('#a')!);
    press(host.querySelector('#b')!);
    expect(count(host.querySelector('#a')!)).toBe(0);
    expect(count(host.querySelector('#b')!)).toBe(1);
    unmount();
  });

  test('自己写的组件也能用', () => {
    const Row = () => {
      const ripple = useRipple();
      return (
        <div sx={rippleStyles.host} {...ripple}>
          行
        </div>
      );
    };
    const { host, unmount } = render(() => <Row />);
    press(host.querySelector('div div') ?? host.firstElementChild!);
    expect(host.querySelectorAll('[data-ripple]').length).toBe(1);
    unmount();
  });
});

describe('按钮', () => {
  test('默认 type 是 button，其余属性落到原生元素', () => {
    let clicks = 0;
    const { host, unmount } = render(() => (
      <Button aria-label="存" data-x="1" onClick={() => clicks++} class="mine">
        保存
      </Button>
    ));
    const button = host.querySelector('button')!;
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('存');
    expect(button.dataset.x).toBe('1');
    expect(button.classList.contains('mine')).toBe(true);
    button.click();
    expect(clicks).toBe(1);
    unmount();
  });

  test('外观和尺寸用 token', () => {
    const { host, unmount } = render(() => (
      <Provider theme={navyTheme}>
        <Button variant="primary" size="lg">
          保存
        </Button>
      </Provider>
    ));
    const style = getComputedStyle(host.querySelector('button')!);
    expect(style.backgroundColor).toBe(rgb(navyTheme.colors.accent));
    expect(style.color).toBe(rgb(navyTheme.colors.onAccent));
    expect(style.height).toBe('40px');
    expect(style.borderTopLeftRadius).toBe('3px');
    unmount();
  });
});

describe('弹层进出场', () => {
  test('打开原生 dialog：进场有过渡，结束后停在打开状态', async () => {
    const { host, unmount } = render(() => (
      <dialog sx={[transitions.scale, transitions.backdrop]}>x</dialog>
    ));
    const dialog = host.querySelector('dialog')!;
    dialog.showModal();
    const animations = dialog.getAnimations();
    expect(animations.length).toBeGreaterThan(0);
    await Promise.allSettled(animations.map((animation) => animation.finished));
    const style = getComputedStyle(dialog);
    expect(style.opacity).toBe('1');
    expect(style.transform).toBe('none');
    dialog.close();
    unmount();
  });
});
