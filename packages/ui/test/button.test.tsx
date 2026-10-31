import { expect, test } from 'vitest';
import { mount } from 'hiltkit';
import { Button } from '@hiltkit/ui';

test('组件库经工作区源码依赖框架', () => {
  const host = document.createElement('div');
  mount(() => <Button>保存</Button>, host);
  expect(host.querySelector('button')?.textContent).toBe('保存');
});
