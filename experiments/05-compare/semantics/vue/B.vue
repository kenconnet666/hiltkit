<script setup>
// inheritAttrs:false，$attrs 在前
import { log, ownRef } from '../harness.js';
defineOptions({ inheritAttrs: false });
const own = () => log.push('own');
</script>

<template>
  <button v-bind="$attrs" class="own" :style="{ fontWeight: 'bold' }" @click="own" :ref="ownRef">x</button>
</template>
