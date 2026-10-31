import { Boundary, createContext, flushSync, inject, mount, onCleanup, Portal, provide } from '@hilt/runtime';
import { create, recipe } from '@hilt/css';

const styles = create({ root: { padding: '1px' }, on: { color: 'red' }, bar: (width: string) => ({ width }) });
const part = recipe({ name: 'Leak', parts: ['root'], variants: { size: { sm: { root: { fontSize: '10px' } }, lg: { root: { fontSize: '20px' } } } } });
const Theme = createContext('x');

const Child = _component(({ tick, ...rest }: any) => {
  const theme = inject(Theme);
  let ref = _state<any>(null);
  const local = _state({ a: { b: 1 } });
  const s = part({ size: tick % 2 ? 'sm' : 'lg' });
  onCleanup(() => void local.a);
  _effect(() => {
    void tick;
    return () => void 0;
  });
  return (
    <section ref={ref} {...s.root} {...rest} sx={[styles.root, tick % 2 && styles.on, styles.bar(`${tick}px`)]} data-theme={theme}>
      <input value={local.a.b} />
      {tick % 3 ? <b>{tick}</b> : <i>{local.a.b}</i>}
    </section>
  );
});
const Provider = _component(({ children }: any) => {
  provide(Theme, 'y');
  return children;
});

const Branch = _component(() => {
  let show = _state(true);
  let tick = _state(0);
  (window as any).step = () => {
    show = !show;
    tick++;
  };
  return <div>{show && <Provider><Child tick={tick} class="c" onClick={() => void tick} /></Provider>}</div>;
});
const ListCase = _component(() => {
  let rows = _state<any[]>([]);
  (window as any).step = () => {
    rows = rows.length ? [] : Array.from({ length: 100 }, (_, id) => ({ id, label: `r${id}` }));
  };
  return <ul>{rows.map((row) => <li key={row.id}><Child tick={row.id} />{row.label}</li>)}</ul>;
});
let nextId = 0;
const RowsCase = _component(() => {
  const rows = _state(Array.from({ length: 20 }, () => ({ id: nextId++ })));
  (window as any).step = () => {
    rows.shift();
    rows.push({ id: nextId++ });
  };
  return <ul>{rows.map((row) => <li><Child tick={row.id} /></li>)}</ul>;
});
// 定位用：分别去掉 Child、只留 Child 但档位固定
const RowsPlain = _component(() => {
  const rows = _state(Array.from({ length: 20 }, () => ({ id: nextId++ })));
  (window as any).step = () => {
    rows.shift();
    rows.push({ id: nextId++ });
  };
  return <ul>{rows.map((row) => <li>{row.id}</li>)}</ul>;
});
const RowsFixed = _component(() => {
  const rows = _state(Array.from({ length: 20 }, () => ({ id: nextId++ })));
  (window as any).step = () => {
    rows.shift();
    rows.push({ id: nextId++ });
  };
  return <ul>{rows.map(() => <li><Child tick={7} /></li>)}</ul>;
});
const WidthOnly = _component(({ tick }: any) => <p sx={[styles.root, styles.bar(`${tick}px`)]} />);
const RowsWidth = _component(() => {
  const rows = _state(Array.from({ length: 20 }, () => ({ id: nextId++ })));
  (window as any).step = () => {
    rows.shift();
    rows.push({ id: nextId++ });
  };
  return <ul>{rows.map((row) => <li><WidthOnly tick={row.id} /></li>)}</ul>;
});
const Bomb = _component(({ armed }: any) => {
  if (armed) throw new Error('炸');
  return <b>好</b>;
});
const BoundaryCase = _component(() => {
  let armed = _state(true);
  let retry: any;
  (window as any).step = () => {
    armed = !armed;
    retry?.();
  };
  return (
    <div>
      <Boundary fallback={(error: Error, again: () => void) => {
        retry = again;
        return <p>{error.message}</p>;
      }}>
        <Child tick={1} />
        <Bomb armed={armed} />
      </Boundary>
    </div>
  );
});
const PortalCase = _component(() => {
  let open = _state(false);
  (window as any).step = () => (open = !open);
  return <div>{open && <Portal><Child tick={2} /></Portal>}</div>;
});
const StateCase = _component(() => {
  let data = _state<any>({ list: [{ x: 1 }], map: new Map([['a', { y: 1 }]]) });
  let n = 0;
  (window as any).step = () => {
    data = { list: [{ x: ++n }, { x: n + 1 }], map: new Map([['a', { y: n }]]) };
  };
  return <p>{data.list[0].x}{data.map.get('a').y}{data.list.map((item: any) => item.x).join()}</p>;
});

const CASES: any = { cycleBranch: Branch, cycleList: ListCase, cycleRows: RowsCase, cycleRowsPlain: RowsPlain, cycleRowsFixed: RowsFixed, cycleRowsWidth: RowsWidth, cycleBoundary: BoundaryCase, cyclePortal: PortalCase, cycleState: StateCase };
let run: (times: number) => void;
(window as any).leakApi = {
  setup(name: string) {
    if (name === 'cycleApp') {
      const host = document.createElement('div');
      document.body.append(host);
      run = (times) => {
        for (let i = 0; i < times; i++) {
          const stop = mount(() => <Branch />, host);
          flushSync();
          stop();
          host.textContent = '';
        }
      };
      return;
    }
    const Case = CASES[name];
    mount(() => <Case />, document.body);
    run = (times) => {
      for (let i = 0; i < times; i++) {
        (window as any).step();
        flushSync();
      }
    };
  },
  run: (times: number) => run(times),
  domCount: () => document.body.querySelectorAll('section').length,
};
