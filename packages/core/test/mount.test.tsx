import { expect, test } from 'vitest';
import { mount } from 'hiltkit';

test('JSX 经工作区源码渲染到真实 DOM', () => {
  const Greeting = ({ name }: { name: string }) => <p class="greeting">你好，{name}</p>;
  const host = document.createElement('div');
  mount(() => <Greeting name="hiltkit" />, host);
  expect(host.innerHTML).toBe('<p class="greeting">你好，hiltkit</p>');
});
