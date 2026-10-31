// 手写出“编译产物形状”的组件。写法对照 03-publish/packages/ui/dist/index.js：
//   omit / merge / component / spread / insert，getter 键是对象字面量里的 get。
// 凡是某个优化需要编译器配合的地方（模块级 Set、提升的层、原型 getter 类），这里按 cfg 切换成编译器会生成的样子。
import { cfg, counters } from './config.js';
import { KEYS, GETTERS } from './layers.js';
import { component, computed, effect, insert, merge, omit, renderEffect, root, signal, spread, template, viewOf } from './runtime.js';

// ======================= 场景 a：三层按钮 App → Button → BaseButton → <button> =======================
const tplButton = template('<button></button>');
// 提升：组件自己的静态层写进模板（编译器看得见字面量）
const tplButtonBaked = template('<button class="base" data-part="root" tabindex="0"></button>');
const BASE_STATIC = { class: 'base', 'data-part': 'root', tabindex: '0' };
const OMIT_BASE = new Set(['children']);
const OMIT_BUTTON = new Set(['loading', 'internalClick']);

const BaseButton = (props) => {
  const rest = omit(props, cfg.hoistSet ? OMIT_BASE : ['children']);
  const el = (cfg.hoist ? tplButtonBaked : tplButton)();
  if (cfg.hoist) spread(el, merge(BASE_STATIC, rest), BASE_STATIC);
  else spread(el, merge({ class: 'base', 'data-part': 'root', tabindex: '0' }, rest));
  counters.getterObjs += 0;
  return el;
};

// shape：getter 在原型上的类。每个实例同一张隐藏类；键清单、getter 清单是原型上的常量
class ManagedLayer {
  constructor(props) {
    this.props = props;
  }
  get 'aria-busy'() {
    return this.props.loading ? 'true' : undefined;
  }
  get disabled() {
    return this.props.loading || undefined;
  }
}
ManagedLayer.prototype[KEYS] = ['aria-busy', 'disabled'];
ManagedLayer.prototype[GETTERS] = new Set(['aria-busy', 'disabled']);

const Button = (_props) => {
  const props = viewOf(_props);
  const rest = omit(_props, cfg.hoistSet ? OMIT_BUTTON : ['loading', 'internalClick']);
  let managed;
  if (cfg.shape) managed = new ManagedLayer(props);
  else {
    counters.closures += 2;
    managed = {
      get 'aria-busy'() {
        return props.loading ? 'true' : undefined;
      },
      get disabled() {
        return props.loading || undefined;
      },
    };
  }
  return component(
    BaseButton,
    merge({ class: 'btn', type: 'button', role: 'button', 'data-scope': 'button', onClick: props.internalClick }, rest, managed),
  );
};

// App 里每个按钮的 props。shape 时用同一个类，数据键是字段，getter 在原型上
class UserProps {
  constructor(title, loading, counts, id, handler) {
    this.title$ = title;
    this.loading$ = loading;
    this.counts$ = counts;
    this.class = 'user';
    this['aria-label'] = 'x';
    this['data-id'] = id;
    this.onClick = handler;
    this.internalClick = handler;
  }
  get title() {
    return this.title$.value;
  }
  get loading() {
    return this.loading$.value;
  }
  get 'data-computed'() {
    this.counts$.staticGetter++;
    return 'x';
  }
}
UserProps.prototype[KEYS] = ['title', 'loading', 'data-computed', 'class', 'aria-label', 'data-id', 'onClick', 'internalClick'];
UserProps.prototype[GETTERS] = new Set(['title', 'loading', 'data-computed']);

// 形状实验：键相同、顺序不同的字面量，让同一段 spread 代码见到不同的隐藏类
function userPropsVariant(variant, title, loading, counts, id, noop) {
  counters.closures += 3;
  const getters = {
    get title() {
      return title.value;
    },
    get loading() {
      return loading.value;
    },
    get 'data-computed'() {
      counts.staticGetter++;
      return 'x';
    },
  };
  switch (variant) {
    case 1:
      return Object.defineProperties(
        { onClick: noop, internalClick: noop, 'data-id': id, 'aria-label': 'x', class: 'user' },
        Object.getOwnPropertyDescriptors(getters),
      );
    case 2:
      return Object.defineProperties(
        { class: 'user', 'data-id': id, onClick: noop, internalClick: noop, 'aria-label': 'x' },
        Object.getOwnPropertyDescriptors(getters),
      );
    default:
      return Object.defineProperties(
        { 'aria-label': 'x', onClick: noop, class: 'user', internalClick: noop, 'data-id': id },
        Object.getOwnPropertyDescriptors(getters),
      );
  }
}

function userProps(title, loading, counts, id, noop) {
  if (cfg.shape) return new UserProps(title, loading, counts, id, noop);
  if (cfg.noise > 0) return userPropsVariant(id % cfg.noise, title, loading, counts, id, noop);
  counters.closures += 3;
  return {
    get title() {
      return title.value;
    },
    get loading() {
      return loading.value;
    },
    // 读不到任何响应式数据的 getter：编译器遇到非字面量表达式时就会生成这样的
    get 'data-computed'() {
      counts.staticGetter++;
      return 'x';
    },
    'aria-label': 'x',
    class: 'user',
    'data-id': id,
    onClick: noop,
    internalClick: noop,
  };
}

function mountButtons(count) {
  const host = document.createElement('div');
  document.body.append(host);
  const loading = signal(false);
  const titles = [];
  const counts = { staticGetter: 0 };
  const noop = () => {};
  const dispose = root(() => {
    for (let i = 0; i < count; i++) {
      const title = signal(`t${i}`);
      titles.push(title);
      host.append(component(Button, userProps(title, loading, counts, i, noop)));
    }
  });
  return {
    host,
    dispose,
    // 单个更新：改某一个按钮的 title；全部更新：改共享的 loading
    updateOne: (i, n) => (titles[i].value = `n${n}`),
    updateAll: (flag) => (loading.value = flag),
    fire: (i) => host.children[i].click(),
    size: count,
    counts,
  };
}

// 手写基线：编译器把一切都看穿时的样子，没有合并、没有层
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
  const dispose = root(() => {
    for (let i = 0; i < count; i++) {
      const el = directTpl.cloneNode();
      const title = signal(`t${i}`);
      titles.push(title);
      el.setAttribute('data-id', i);
      renderEffect(() => el.setAttribute('title', title.value));
      renderEffect(() => {
        if (loading.value) {
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
  return {
    host,
    dispose,
    updateOne: (i, n) => (titles[i].value = `n${n}`),
    updateAll: (flag) => (loading.value = flag),
    fire: (i) => host.children[i].click(),
    size: count,
    counts: { staticGetter: 0 },
  };
}

// ======================= 场景 b：表单字段 Field → Label + Input + Hint =======================
// 一个组件 4 个元素（div、label、input、span）、2 层组件嵌套、一个 _effect、一个 _derived、8 个 props（5 静态、2 getter、1 事件）
const tplField = template('<div class="field"></div>');
const tplLabel = template('<label></label>');
const tplLabelBaked = template('<label class="label"></label>');
const tplInput = template('<input>');
const tplInputBaked = template('<input class="base-input" type="text">');
const tplHint = template('<span class="hint"></span>');

const OMIT_FIELD_INPUT = new Set(['label', 'hint']);
const OMIT_CHILDREN = new Set(['children']);
const LABEL_STATIC = { class: 'label' };
const BASE_INPUT_STATIC = { class: 'base-input', type: 'text' };
const FIELD_NAME = 'email'; // 模块里的常量：编译器看不出它是字面量，会生成 getter

const Label = (_props) => {
  const props = viewOf(_props);
  const rest = omit(_props, cfg.hoistSet ? OMIT_CHILDREN : ['children']);
  const el = (cfg.hoist ? tplLabelBaked : tplLabel)();
  if (cfg.hoist) spread(el, merge(LABEL_STATIC, rest), LABEL_STATIC);
  else spread(el, merge({ class: 'label' }, rest));
  insert(el, () => props.children);
  return el;
};
const Hint = (_props) => {
  const props = viewOf(_props);
  const el = tplHint();
  insert(el, () => props.children);
  return el;
};
const Input = (_props) => {
  const rest = omit(_props, cfg.hoistSet ? OMIT_CHILDREN : ['children']);
  const el = (cfg.hoist ? tplInputBaked : tplInput)();
  if (cfg.hoist) spread(el, merge(BASE_INPUT_STATIC, rest), BASE_INPUT_STATIC);
  else spread(el, merge({ class: 'base-input', type: 'text' }, rest));
  return el;
};

const sink = { n: 0 };
class InputLayer {
  constructor(invalid) {
    this.invalid$ = invalid;
  }
  get 'aria-invalid'() {
    return this.invalid$.value ? 'true' : undefined;
  }
  get 'data-field'() {
    return FIELD_NAME;
  }
}
InputLayer.prototype[KEYS] = ['aria-invalid', 'data-field'];
InputLayer.prototype[GETTERS] = new Set(['aria-invalid', 'data-field']);
class TextProps {
  constructor(props) {
    this.props = props;
  }
  get children() {
    return this.props.label;
  }
}
TextProps.prototype[KEYS] = ['children'];
TextProps.prototype[GETTERS] = new Set(['children']);
class HintProps {
  constructor(props) {
    this.props = props;
  }
  get children() {
    return this.props.hint;
  }
}
HintProps.prototype[KEYS] = ['children'];
HintProps.prototype[GETTERS] = new Set(['children']);
class FieldUserProps {
  constructor(id, value, readonly, onInput) {
    this.id = id;
    this.name = 'email';
    this.label = 'Email';
    this.hint = 'We never share it';
    this.placeholder = 'you@example.com';
    this.onInput = onInput;
    this.value$ = value;
    this.readonly$ = readonly;
  }
  get value() {
    return this.value$.value;
  }
  get readonly() {
    return this.readonly$.value ? '' : undefined;
  }
}
FieldUserProps.prototype[KEYS] = ['id', 'name', 'label', 'hint', 'placeholder', 'onInput', 'value', 'readonly'];
FieldUserProps.prototype[GETTERS] = new Set(['value', 'readonly']);

const Field = (_props) => {
  const props = viewOf(_props);
  const rest = omit(_props, cfg.hoistSet ? OMIT_FIELD_INPUT : ['label', 'hint']);
  const length = computed(() => props.value.length); // _derived
  const invalid = computed(() => length.value > 10); // _derived 的派生
  effect(() => {
    // _effect：读 length，依赖在第一次运行时建立
    sink.n = length.value;
  });
  const el = tplField();
  let inputLayer;
  let labelProps;
  let hintProps;
  if (cfg.shape) {
    inputLayer = new InputLayer(invalid);
    labelProps = new TextProps(props);
    hintProps = new HintProps(props);
  } else {
    counters.closures += 4;
    inputLayer = {
      get 'aria-invalid'() {
        return invalid.value ? 'true' : undefined;
      },
      get 'data-field'() {
        return FIELD_NAME;
      },
    };
    labelProps = {
      get children() {
        return props.label;
      },
    };
    hintProps = {
      get children() {
        return props.hint;
      },
    };
  }
  el.append(
    component(Label, labelProps),
    component(Input, merge({ autocomplete: 'off' }, rest, inputLayer)),
    component(Hint, hintProps),
  );
  return el;
};

function fieldProps(id, value, readonly, onInput) {
  if (cfg.shape) return new FieldUserProps(id, value, readonly, onInput);
  counters.closures += 2;
  return {
    id,
    name: 'email',
    label: 'Email',
    hint: 'We never share it',
    placeholder: 'you@example.com',
    onInput,
    get value() {
      return value.value;
    },
    get readonly() {
      return readonly.value ? '' : undefined;
    },
  };
}

function mountFields(count) {
  const host = document.createElement('div');
  document.body.append(host);
  const readonly = signal(false);
  const values = [];
  const onInput = () => {};
  const dispose = root(() => {
    for (let i = 0; i < count; i++) {
      const value = signal(`v${i}`);
      values.push(value);
      host.append(component(Field, fieldProps(`f${i}`, value, readonly, onInput)));
    }
  });
  return {
    host,
    dispose,
    // 单个更新：改某一个字段的 value（长度变化，_derived 与 _effect 都会跑）；全部更新：改共享的 readonly
    updateOne: (i, n) => (values[i].value = 'x'.repeat(1 + (n % 14))),
    updateAll: (flag) => (readonly.value = flag),
    fire: (i) => host.children[i].children[1].dispatchEvent(new Event('input', { bubbles: true })),
    size: count,
    counts: {},
  };
}

// 手写基线（b）：一个模板带全部静态属性，只有四个绑定：value、readonly、aria-invalid、_effect
const directFieldTpl = document.createElement('div');
directFieldTpl.className = 'field';
directFieldTpl.innerHTML =
  '<label class="label">Email</label><input class="base-input" type="text" name="email" placeholder="you@example.com" autocomplete="off" data-field="email"><span class="hint">We never share it</span>';
function mountFieldsDirect(count) {
  const host = document.createElement('div');
  document.body.append(host);
  const readonly = signal(false);
  const values = [];
  const onInput = () => {};
  const dispose = root(() => {
    for (let i = 0; i < count; i++) {
      const el = directFieldTpl.cloneNode(true);
      const input = el.children[1];
      const value = signal(`v${i}`);
      values.push(value);
      input.id = `f${i}`;
      const length = computed(() => value.value.length);
      const invalid = computed(() => length.value > 10);
      effect(() => {
        sink.n = length.value;
      });
      renderEffect(() => (input.value = value.value));
      renderEffect(() => (readonly.value ? input.setAttribute('readonly', '') : input.removeAttribute('readonly')));
      renderEffect(() => (invalid.value ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid')));
      input.addEventListener('input', onInput);
      host.append(el);
    }
  });
  return {
    host,
    dispose,
    updateOne: (i, n) => (values[i].value = 'x'.repeat(1 + (n % 14))),
    updateAll: (flag) => (readonly.value = flag),
    fire: (i) => host.children[i].children[1].dispatchEvent(new Event('input', { bubbles: true })),
    size: count,
    counts: {},
  };
}

export const SCENARIOS = {
  a: { mount: mountButtons, count: 10_000, label: '三层按钮' },
  direct: { mount: mountDirect, count: 10_000, label: '手写基线' },
  b: { mount: mountFields, count: 5_000, label: '表单字段' },
  directB: { mount: mountFieldsDirect, count: 5_000, label: '表单字段手写基线' },
};
export { Button, BaseButton, Field, Label, Input, Hint, signal, merge, omit, spread, component, root };
