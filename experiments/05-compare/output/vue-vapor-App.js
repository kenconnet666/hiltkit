import { createComponent as _createComponent, setStaticTemplateRef as _setStaticTemplateRef, template as _template } from 'vue';
const t0 = _template("<b>child", 2)
import { ref } from 'vue';
import Counter from './Counter.vue';

export default {
  __name: 'App',
  __vapor: true,
  setup(__props) {

const el = ref(null);


  const _on_click = () => console.log('outer click')
  const n1 = _createComponent(Counter, {
    label: "n",
    class: "outer",
    style: { color: 'red' },
    onClick: () => _on_click
  }, () => {
    const n0 = t0()
    return n0
  }, true)
  _setStaticTemplateRef(n1, el, null, "el")
  return n1

}

}