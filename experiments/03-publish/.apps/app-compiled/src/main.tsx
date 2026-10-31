// 使用方自己的代码走编译；@hilt/ui 来自 node_modules，是预编译好的 JS
import { flushSync, mount } from '@hilt/runtime';
import { Button, List, Switch } from '@hilt/ui';

const App = _component(() => {
  let on = _state(false);
  let loading = _state(false);
  let userClicks = _state(0);
  let title = _state<string | undefined>('first');
  let extra = _state<Record<string, string> | null>(null);
  const items = _state([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
  const doubled = _derived(userClicks * 2);

  const api = {
    setLoading: (next: boolean) => (loading = next),
    setTitle: (next: string | undefined) => (title = next),
    setExtra: (next: Record<string, string> | null) => (extra = next),
    setOn: (next: boolean) => (on = next),
    push: (name: string) => items.push({ id: items.length + 1, name }),
    read: () => ({ on, loading, userClicks, doubled }),
    flushSync,
  };
  (window as any).api = api;

  return (
    <main>
      <Button
        id="merged"
        class="user-class"
        title={title}
        loading={loading}
        data-user="1"
        {...extra}
        onClick={() => userClicks++}
      >
        保存 {userClicks}
      </Button>
      <Button id="prevented" onClick={(event: Event) => event.preventDefault()}>
        拦截
      </Button>
      <Switch id="sw" checked={_bind(on)} label="开关" />
      <p id="state">{on ? '开' : '关'}</p>
      <List id="list" items={items}>
        {(item: { name: string }) => <b>{item.name}</b>}
      </List>
    </main>
  );
});

mount(() => <App />, document.getElementById('app')!);
