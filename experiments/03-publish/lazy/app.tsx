import { lazy, provide } from '@hilt/runtime';
import { Theme } from './shared';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const load = () => delay(150).then(() => import('./heavy'));

const OnLoad = lazy(load, { hydrate: 'load' });
const OnVisible = lazy(load, { hydrate: 'visible' });
const OnIdle = lazy(load, { hydrate: 'idle' });
const OnInteraction = lazy(load, { hydrate: 'interaction' });

export const App = _component(() => {
  provide(Theme, 'dark');
  let label = _state('L');
  let hits = _state(0);
  let showCancelled = _state(true);
  if (typeof window !== 'undefined') {
    (window as any).api = {
      setLabel: (next: string) => (label = next),
      setCancelled: (next: boolean) => (showCancelled = next),
      hits: () => hits,
    };
  }
  return (
    <main>
      <OnLoad id="on-load" label="load" />
      <div style="height: 3000px">占位</div>
      <OnVisible id="on-visible" label="visible" />
      <OnIdle id="on-idle" label="idle" />
      <OnInteraction id="on-interaction" label="click" onHit={() => hits++} />
      <OnInteraction id="on-changed" label={label} />
      {showCancelled ? <OnInteraction id="on-cancelled" label="x" /> : null}
    </main>
  );
});
