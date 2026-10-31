// 浏览器里跑的部分：三层组件（App → Button → BaseButton → <button>），语义检查与性能。
import { signal } from 'alien-signals';
import { createSignal } from 'solid-js';
import { effect, KITS, stats } from './kits.js';

const tpl = document.createElement('button');

const BASE_STATIC = { class: 'base', 'data-part': 'root', tabindex: 0 };
const hoistedTpl = document.createElement('button');
hoistedTpl.className = 'base';
hoistedTpl.setAttribute('data-part', 'root');
hoistedTpl.setAttribute('tabindex', '0');

function BaseButton(props, kit) {
  const rest = kit.omit(props, ['children']);
  if (kit.hoistTemplate) {
    const el = hoistedTpl.cloneNode();
    kit.spread(el, kit.merge(BASE_STATIC, rest), BASE_STATIC);
    return el;
  }
  const el = tpl.cloneNode();
  kit.spread(el, kit.merge(BASE_STATIC, rest));
  return el;
}

/** 手写基线：编译器把一切都看穿时的样子，模板克隆 + 三个绑定 + 两层事件，没有合并 */
const directTpl = document.createElement('button');
directTpl.className = 'base btn user';
for (const [key, value] of Object.entries({
  'data-part': 'root',
  tabindex: '0',
  type: 'button',
  role: 'button',
  'data-scope': 'button',
  'data-computed': 'x',
  'aria-label': 'x',
})) {
  directTpl.setAttribute(key, value);
}
function mountDirect(count) {
  const host = document.createElement('div');
  document.body.append(host);
  const loading = signal(false);
  const titles = [];
  const noop = () => {};
  const dispose = KITS['proxy-static'].root(() => {
    for (let i = 0; i < count; i++) {
      const el = directTpl.cloneNode();
      const title = signal(`t${i}`);
      titles.push(title);
      el.setAttribute('data-id', i);
      effect(() => el.setAttribute('title', title()));
      effect(() => {
        if (loading()) {
          el.setAttribute('aria-busy', 'true');
          el.setAttribute('disabled', '');
        } else {
          el.removeAttribute('aria-busy');
          el.removeAttribute('disabled');
        }
      });
      el.addEventListener('click', noop);
      host.append(el);
    }
  });
  return { host, setLoading: loading, titles, counters: { staticGetter: 0 }, dispose };
}
function Button(props, kit) {
  const rest = kit.omit(props, ['loading']);
  return BaseButton(
    kit.merge(
      { class: 'btn', type: 'button', role: 'button', 'data-scope': 'button', onClick: props.internalClick },
      rest,
      {
        get 'aria-busy'() {
          return props.loading ? 'true' : undefined;
        },
        get disabled() {
          return props.loading || undefined;
        },
      },
    ),
    kit,
  );
}

const makeSignal = (name, value) => {
  if (name !== 'solid') {
    const s = signal(value);
    return [s, s];
  }
  const [get, set] = createSignal(value);
  return [get, (next) => set(() => next)];
};

function mountAll(name, count) {
  if (name === 'direct') return mountDirect(count);
  const kit = KITS[name];
  const host = document.createElement('div');
  document.body.append(host);
  const [loading, setLoading] = makeSignal(name, false);
  const titles = [];
  const counters = { staticGetter: 0 };
  const noop = () => {};
  const dispose = kit.root(() => {
    for (let i = 0; i < count; i++) {
      const [title, setTitle] = makeSignal(name, `t${i}`);
      titles.push(setTitle);
      host.append(
        Button(
          {
            get title() {
              return title();
            },
            get loading() {
              return loading();
            },
            // 读不到任何响应式数据的 getter：编译器遇到非字面量表达式时就会生成这样的
            get 'data-computed'() {
              counters.staticGetter++;
              return 'x';
            },
            'aria-label': 'x',
            class: 'user',
            'data-id': i,
            onClick: noop,
            internalClick: noop,
          },
          kit,
        ),
        kit,
      );
    }
  });
  return { host, setLoading, titles, counters, dispose };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const now = () => performance.now();

window.bench = async (name, count) => {
  const app0 = { first: null };
  const t0 = now();
  const app = mountAll(name, count);
  const mount = now() - t0;
  app0.first = app.host.firstChild;
  const attrs = [...app0.first.attributes].map((a) => a.name).length;

  const before = stats.domWrites;
  const evalsBefore = app.counters.staticGetter;
  const t1 = now();
  for (let i = 0; i < 1000; i++) app.titles[(i * 7919) % count](`n${i}`);
  const updateOne = now() - t1;
  const writesPerOne = (stats.domWrites - before) / 1000;
  const evalsPerOne = (app.counters.staticGetter - evalsBefore) / 1000;

  const allRounds = [];
  let flag = false;
  for (let i = 0; i < 5; i++) {
    flag = !flag;
    const t = now();
    app.setLoading(flag);
    allRounds.push(now() - t);
  }
  const updateAll = median(allRounds);

  const t2 = now();
  app.dispose();
  app.host.remove();
  const dispose = now() - t2;
  return { mount, updateOne, updateAll, dispose, writesPerOne, evalsPerOne, attrs };
};

window.heap = async (name, count) => {
  window.__keep = mountAll(name, count);
};
window.drop = () => {
  window.__keep?.dispose();
  window.__keep?.host.remove();
  window.__keep = undefined;
};

// ---- 语义 ----
window.semantics = (name) => {
  const kit = KITS[name];
  const results = {};
  const check = (label, fn) => {
    try {
      const value = fn();
      results[label] = value === true ? 'ok' : `fail: ${JSON.stringify(value)}`;
    } catch (error) {
      results[label] = `error: ${error.message}`;
    }
  };

  check('class 按层拼接', () => {
    let el;
    kit.root(() => {
      el = kit_el(kit, kit.merge({ class: 'a' }, { class: 'b' }, { class: 'c' }));
    });
    return el.className === 'a b c' || el.className;
  });

  check('上层 undefined 不盖掉下层，恢复后再次生效', () => {
    const [v, setV] = makeSignal(name, undefined);
    let el;
    kit.root(() => {
      el = kit_el(
        kit,
        kit.merge({ title: 'default' }, {
          get title() {
            return v();
          },
        }),
      );
    });
    const a = el.getAttribute('title');
    setV('user');
    const b = el.getAttribute('title');
    setV(undefined);
    const c = el.getAttribute('title');
    return (a === 'default' && b === 'user' && c === 'default') || [a, b, c];
  });

  check('事件：上层先执行，preventDefault 跳过下层', () => {
    const calls = [];
    let prevent = false;
    let el;
    kit.root(() => {
      el = kit_el(
        kit,
        kit.merge(
          { onClick: () => calls.push('internal') },
          {
            onClick: (event) => {
              calls.push('user');
              if (prevent) event.preventDefault();
            },
          },
        ),
      );
    });
    document.body.append(el);
    el.click();
    prevent = true;
    el.click();
    el.remove();
    const got = calls.join(',');
    return got === 'user,internal,user' || got;
  });

  check('事件：使用方写 undefined 不盖掉内部的', () => {
    const calls = [];
    let el;
    kit.root(() => {
      el = kit_el(kit, kit.merge({ onClick: () => calls.push('internal') }, { onClick: undefined }));
    });
    document.body.append(el);
    el.click();
    el.remove();
    return calls.join() === 'internal' || calls;
  });

  check('受管层盖过使用方', () => {
    let el;
    kit.root(() => {
      el = kit_el(kit, kit.merge({ role: 'a' }, { role: 'user' }, { role: 'managed' }));
    });
    return el.getAttribute('role') === 'managed' || el.getAttribute('role');
  });

  check('被盖住的 getter 不求值（惰性）', () => {
    let evaluated = 0;
    let el;
    kit.root(() => {
      el = kit_el(
        kit,
        kit.merge(
          {
            get role() {
              evaluated++;
              return 'hidden';
            },
          },
          { role: 'managed' },
        ),
      );
    });
    return (evaluated === 0 && el.getAttribute('role') === 'managed') || { evaluated };
  });

  check('改一个键不重算其他键', () => {
    const [v, setV] = makeSignal(name, 'a');
    let other = 0;
    kit.root(() => {
      kit_el(kit, {
        get title() {
          return v();
        },
        get 'data-other'() {
          other++;
          return 'o';
        },
      });
    });
    const before = other;
    setV('b');
    return other === before || { reEvaluated: other - before };
  });

  check('动态键：出现、消失后恢复下层', () => {
    const [extra, setExtra] = makeSignal(name, null);
    let el;
    kit.root(() => {
      el = kit_el(
        kit,
        kit.merge({ title: 'base' }, name === 'solid' ? extra : () => extra()),
      );
    });
    const a = el.getAttribute('title');
    const b0 = el.hasAttribute('data-x');
    setExtra({ title: 'dyn', 'data-x': '1' });
    const c = el.getAttribute('title');
    const d = el.getAttribute('data-x');
    setExtra(null);
    const e = el.getAttribute('title');
    const f = el.hasAttribute('data-x');
    return (a === 'base' && !b0 && c === 'dyn' && d === '1' && e === 'base' && !f) || [a, b0, c, d, e, f];
  });

  check('style 按属性合并', () => {
    let el;
    kit.root(() => {
      el = kit_el(kit, kit.merge({ style: { color: 'red', top: '1px' } }, { style: { top: '2px' } }));
    });
    return (el.style.color === 'red' && el.style.top === '2px') || el.getAttribute('style');
  });

  check('ref 每层都拿到元素', () => {
    const got = [];
    let el;
    kit.root(() => {
      el = kit_el(kit, kit.merge({ ref: (e) => got.push(['a', e]) }, { ref: (e) => got.push(['b', e]) }));
    });
    return (got.length === 2 && got[0][1] === el && got[1][1] === el) || got.length;
  });

  return results;
};
function kit_el(kit, props) {
  const el = document.createElement('button');
  kit.spread(el, props);
  return el;
}
