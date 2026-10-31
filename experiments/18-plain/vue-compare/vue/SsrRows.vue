<script setup>
import { shallowRef } from 'vue';
const rows = shallowRef(globalThis.ssrData);
const selected = shallowRef(null);
const noop = () => {};
</script>
<template>
  <table><tbody>
    <tr v-for="row in rows" :key="row.id" :class="{ danger: selected === row.id }">
      <td>{{ row.id }}</td>
      <td><a @click="selected = row.id">{{ row.label }}</a></td>
      <td><a class="remove" @click="noop">x</a></td>
    </tr>
  </tbody></table>
</template>
