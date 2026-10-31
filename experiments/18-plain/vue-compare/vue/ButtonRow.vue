<script setup>
import Mid from './Mid.vue';
defineProps({ index: Number, title: String });
const noop = () => {};
</script>
<template><Mid :id="'b' + index" size="md" :title="title" @click="noop">保存</Mid></template>
