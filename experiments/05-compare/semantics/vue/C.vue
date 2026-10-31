<script setup>
// inheritAttrs:false，$attrs 在后
import { log, ownRef } from '../harness.js';
defineOptions({ inheritAttrs: false });
const own = () => log.push('own');
</script>

<template>
  <button class="own" :style="{ fontWeight: 'bold' }" @click="own" :ref="ownRef" v-bind="$attrs">x</button>
</template>
