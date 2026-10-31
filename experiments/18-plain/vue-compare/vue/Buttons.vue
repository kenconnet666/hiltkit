<script setup>
import { ref } from 'vue';
import ButtonRow from './ButtonRow.vue';
const ids = window.ids;
const title = ref('a');
window.setAll = (next) => (title.value = next);
</script>
<template><div><ButtonRow v-for="item in ids" :key="item.i" :index="item.i" :title="title" /></div></template>
