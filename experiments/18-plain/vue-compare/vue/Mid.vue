<script setup>
import Base from './Base.vue';
defineProps({ size: { type: String, default: 'md' } });
</script>
<template><Base :class="'btn btn-' + size"><slot /></Base></template>
