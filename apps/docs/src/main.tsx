import { mount } from 'hiltkit';
import { Button } from '@hiltkit/ui';

mount(
  () => (
    <main>
      <h1>hiltkit</h1>
      <Button>开始</Button>
    </main>
  ),
  document.getElementById('app')!,
);
