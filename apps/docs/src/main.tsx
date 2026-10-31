import { mount, sig } from 'hiltkit';
import { Button } from '@hiltkit/ui';

function App() {
  const count = sig(0);
  return (
    <main>
      <h1>hiltkit</h1>
      <p id="count">{count}</p>
      <button type="button" onClick={() => count.inc()}>
        加一
      </button>
      <Button>开始</Button>
    </main>
  );
}

mount(() => <App />, document.getElementById('app')!);
