import { expect, test } from 'vitest';
import { flushSync, mount, sig } from 'hiltkit';

test('JSX 经工作区源码渲染到真实 DOM', () => {
  const Greeting = ({ name }: { name: string }) => <p class="greeting">你好，{name}</p>;
  const host = document.createElement('div');
  mount(() => <Greeting name="hiltkit" />, host);
  expect(host.innerHTML).toBe('<p class="greeting">你好，hiltkit</p>');
});

test('传函数是活的，传值只取一次', () => {
  const count = sig(1);
  const host = document.createElement('div');
  mount(
    () => (
      <p title={() => String(count())} data-once={count.peek()}>
        {count}
      </p>
    ),
    host,
  );
  count.set(2);
  flushSync();
  const p = host.querySelector('p')!;
  expect(p.textContent).toBe('2');
  expect(p.title).toBe('2');
  expect(p.getAttribute('data-once')).toBe('1');
});
