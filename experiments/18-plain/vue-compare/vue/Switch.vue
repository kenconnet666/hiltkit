<script setup>
defineOptions({ inheritAttrs: false });
const checked = defineModel('checked', { default: false });
defineProps({ label: String });
</script>
<template>
  <label :data-state="checked ? 'on' : 'off'"><input type="checkbox" v-bind="$attrs" v-model="checked" />{{ label }}</label>
</template>
