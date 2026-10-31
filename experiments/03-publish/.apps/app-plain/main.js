// 完全不编译：使用方手写 getter，组件库照样能用。验证“没有构建插件也能装上就用”
import { component, mount, signal } from '@hilt/runtime';
import { Button } from '@hilt/ui';

const title = signal('plain');
const clicks = signal(0);
window.api = { setTitle: (next) => (title.value = next), clicks: () => clicks.value };

mount(
  () =>
    component(Button, {
      id: 'plain',
      class: 'from-plain',
      get title() {
        return title.value;
      },
      onClick: () => clicks.value++,
      children: '没有编译',
    }),
  document.getElementById('app'),
);
