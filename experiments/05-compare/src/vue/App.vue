<script setup vapor>
import { ref } from 'vue';
import Counter from './Counter.vue';
const el = ref(null);
</script>

<!-- 调用方：传 class / style / 事件 / ref / slot -->
<template>
  <Counter label="n" class="outer" :style="{ color: 'red' }" @click="() => console.log('outer click')" ref="el"><b>child</b></Counter>
</template>
