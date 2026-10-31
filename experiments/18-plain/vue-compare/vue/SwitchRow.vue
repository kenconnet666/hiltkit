<script setup>
import { ref } from 'vue';
import Switch from './Switch.vue';
const on = ref(false);
(window.setters ??= []).push(() => (on.value = !on.value));
</script>
<template><Switch label="x" v-model:checked="on" /></template>
