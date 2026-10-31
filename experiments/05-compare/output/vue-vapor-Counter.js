import { child as _child, setClass as _setClass, setAttr as _setAttr, toDisplayString as _toDisplayString, setText as _setText, renderEffect as _renderEffect, setInsertionState as _setInsertionState, createSlot as _createSlot, on as _on, template as _template } from 'vue';
const t0 = _template("<button> ", 1)
import { computed, ref } from 'vue';

export default {
  __name: 'Counter',
  props: { label: String },
  __vapor: true,
  setup(__props) {

// 小组件：状态、派生、动态属性、透传（默认 attrs fallthrough）、slot

const count = ref(0);
const doubled = computed(() => count.value * 2);


  const n2 = t0()
  const n0 = _child(n2, true)
  _renderEffect(() => {
    const _doubled = doubled.value
    _setClass(n2, ['btn', { big: _doubled > 4 }])
    _setAttr(n2, "data-doubled", _doubled)
    _setText(n0, _toDisplayString(__props.label) + ": " + _toDisplayString(count.value) + " / " + _toDisplayString(_doubled) + " ")
  })
  _setInsertionState(n2, 1)
  const n1 = _createSlot()
  _on(n2, "click", () => (count.value++))
  return n2

}

}