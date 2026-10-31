<script setup vapor>
// 变体：inheritAttrs:false + v-bind="$attrs" 显式透传到内部元素
import { computed, ref } from 'vue';
defineOptions({ inheritAttrs: false });
defineProps({ label: String });
const count = ref(0);
const doubled = computed(() => count.value * 2);
</script>

<template>
  <label>
    <button v-bind="$attrs" :class="['btn', { big: doubled > 4 }]" :data-doubled="doubled" @click="count++">{{ label }}: {{ count }} / {{ doubled }} <slot /></button>
  </label>
</template>
