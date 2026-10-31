import { child as _child, setDynamicProps as _setDynamicProps, toDisplayString as _toDisplayString, setText as _setText, renderEffect as _renderEffect, setInsertionState as _setInsertionState, createSlot as _createSlot, template as _template } from 'vue';
const t0 = _template("<label><button> ", 1)
const k0 = ["data-doubled"]
import { computed, ref } from 'vue';

export default /*@__PURE__*/Object.assign({ inheritAttrs: false }, {
  __name: 'CounterAttrs',
  props: { label: String },
  __vapor: true,
  setup(__props, { attrs: $attrs }) {

// 变体：inheritAttrs:false + v-bind="$attrs" 显式透传到内部元素


const count = ref(0);
const doubled = computed(() => count.value * 2);


  const n3 = t0()
  const n2 = _child(n3)
  const n0 = _child(n2, true)
  const _on_click = () => (count.value++)
  _renderEffect(() => {
    const _doubled = doubled.value
    _setDynamicProps(n2, [$attrs, { class: ['btn', { big: _doubled > 4 }], "data-doubled": _doubled, onClick: _on_click }], k0)
    _setText(n0, _toDisplayString(__props.label) + ": " + _toDisplayString(count.value) + " / " + _toDisplayString(_doubled) + " ")
  })
  _setInsertionState(n2, 1)
  const n1 = _createSlot()
  return n3

}

})