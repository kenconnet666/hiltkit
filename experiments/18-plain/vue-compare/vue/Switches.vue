<script setup>
import SwitchRow from './SwitchRow.vue';
const ids = window.ids;
</script>
<template><div><SwitchRow v-for="item in ids" :key="item.i" /></div></template>
