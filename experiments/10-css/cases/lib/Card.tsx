// 预编译组件库里的另一个组件：自己有样式（create），也转交 ...rest（使用方的 sx 排在后面）
import { create } from '@hilt/css';

const styles = create({
  root: { padding: 4, color: 'rgb(255, 0, 0)' },
  hot: { color: 'rgb(255, 165, 0)' },
});

export const Card = _component(({ hot, children, ...rest }) => (
  <section class="lib-card" sx={[styles.root, hot && styles.hot]} {...rest}>
    {children}
  </section>
));
