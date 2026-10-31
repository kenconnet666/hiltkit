<script setup vapor>
// 小组件：状态、派生、动态属性、透传（默认 attrs fallthrough）、slot
import { computed, ref } from 'vue';
defineProps({ label: String });
const count = ref(0);
const doubled = computed(() => count.value * 2);
</script>

<template>
  <button :class="['btn', { big: doubled > 4 }]" :data-doubled="doubled" @click="count++">{{ label }}: {{ count }} / {{ doubled }} <slot /></button>
</template>
