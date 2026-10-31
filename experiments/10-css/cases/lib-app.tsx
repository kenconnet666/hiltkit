// 使用方：用预编译的组件库（@lib/*），自己 create 样式经 sx 传给库组件
import { flushSync, mount } from '@hilt/runtime';
import { create } from '@hilt/css';
import { Box } from '@lib/Box';
import { Card } from '@lib/Card';

const styles = create({
  mine: { margin: 7, color: 'rgb(0, 128, 0)' },
  wide: (width: string) => ({ width }),
});
let hot = _state(false);
let width = _state('30px');
(window as any).api = { setHot: (v: boolean) => (hot = v), setWidth: (v: string) => (width = v), flushSync };

mount(
  () => (
    <main>
      <Box id="box" sx={[styles.mine, styles.wide(width)]}>盒子</Box>
      <Card id="card" hot={hot} sx={styles.mine}>卡片</Card>
    </main>
  ),
  document.body,
);
