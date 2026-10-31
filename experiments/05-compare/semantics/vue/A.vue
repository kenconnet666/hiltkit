<script setup>
// 默认透传：单根元素，不写 v-bind="$attrs"
import { log, ownRef } from '../harness.js';
const own = () => log.push('own');
</script>

<template>
  <button class="own" :style="{ fontWeight: 'bold' }" @click="own" :ref="ownRef">x</button>
</template>
