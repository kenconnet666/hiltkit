// 生成 Vue 版的单文件组件（同一份给 3.5 虚拟 DOM 和 3.6 Vapor 编译）
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./vue/', import.meta.url));
mkdirSync(dir, { recursive: true });
const files = {
  'Switch.vue': `<script setup>
defineOptions({ inheritAttrs: false });
const checked = defineModel('checked', { default: false });
defineProps({ label: String });
</script>
<template>
  <label :data-state="checked ? 'on' : 'off'"><input type="checkbox" v-bind="$attrs" v-model="checked" />{{ label }}</label>
</template>
`,
  'SwitchRow.vue': `<script setup>
import { ref } from 'vue';
import Switch from './Switch.vue';
const on = ref(false);
(window.setters ??= []).push(() => (on.value = !on.value));
</script>
<template><Switch label="x" v-model:checked="on" /></template>
`,
  'Switches.vue': `<script setup>
import SwitchRow from './SwitchRow.vue';
const ids = window.ids;
</script>
<template><div><SwitchRow v-for="item in ids" :key="item.i" /></div></template>
`,
  'Base.vue': `<script setup>const name = "Base";</script>
<template><button class="base" data-part="root"><slot /></button></template>
`,
  'Mid.vue': `<script setup>
import Base from './Base.vue';
defineProps({ size: { type: String, default: 'md' } });
</script>
<template><Base :class="'btn btn-' + size"><slot /></Base></template>
`,
  'ButtonRow.vue': `<script setup>
import Mid from './Mid.vue';
defineProps({ index: Number, title: String });
const noop = () => {};
</script>
<template><Mid :id="'b' + index" size="md" :title="title" @click="noop">保存</Mid></template>
`,
  'Buttons.vue': `<script setup>
import { ref } from 'vue';
import ButtonRow from './ButtonRow.vue';
const ids = window.ids;
const title = ref('a');
window.setAll = (next) => (title.value = next);
</script>
<template><div><ButtonRow v-for="item in ids" :key="item.i" :index="item.i" :title="title" /></div></template>
`,
  'SsrRows.vue': `<script setup>
import { shallowRef } from 'vue';
const rows = shallowRef(globalThis.ssrData);
const selected = shallowRef(null);
const noop = () => {};
</script>
<template>
  <table><tbody>
    <tr v-for="row in rows" :key="row.id" :class="{ danger: selected === row.id }">
      <td>{{ row.id }}</td>
      <td><a @click="selected = row.id">{{ row.label }}</a></td>
      <td><a class="remove" @click="noop">x</a></td>
    </tr>
  </tbody></table>
</template>
`,
};
for (const [name, text] of Object.entries(files)) writeFileSync(`${dir}${name}`, text);
