import { toDisplayString as _toDisplayString, renderSlot as _renderSlot, createTextVNode as _createTextVNode, normalizeClass as _normalizeClass, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue"

const _hoisted_1 = ["data-doubled"]

import { computed, ref } from 'vue';

export default {
  __name: 'Counter',
  props: { label: String },
  setup(__props) {

// 小组件：状态、派生、动态属性、透传（默认 attrs fallthrough）、slot

const count = ref(0);
const doubled = computed(() => count.value * 2);

return (_ctx, _cache) => {
  return (_openBlock(), _createElementBlock("button", {
    class: _normalizeClass(['btn', { big: doubled.value > 4 }]),
    "data-doubled": doubled.value,
    onClick: _cache[0] || (_cache[0] = $event => (count.value++))
  }, [
    _createTextVNode(_toDisplayString(__props.label) + ": " + _toDisplayString(count.value) + " / " + _toDisplayString(doubled.value) + " ", 1 /* TEXT */),
    _renderSlot(_ctx.$slots, "default")
  ], 10 /* CLASS, PROPS */, _hoisted_1))
}
}

}