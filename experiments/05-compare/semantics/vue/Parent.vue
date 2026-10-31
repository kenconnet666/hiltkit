<script setup>
import { log, parentRef } from '../harness.js';
import A from './A.vue';
import B from './B.vue';
import C from './C.vue';
const parent = () => log.push('parent');
</script>

<template>
  <A class="parent" :style="{ color: 'red' }" @click="parent" :ref="parentRef" />
  <B class="parent" :style="{ color: 'red' }" @click="parent" :ref="parentRef" />
  <C class="parent" :style="{ color: 'red' }" @click="parent" :ref="parentRef" />
</template>
