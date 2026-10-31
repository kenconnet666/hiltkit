<script setup>
// 同一份 SFC 编译两次：vapor36 构建带 vapor:true，vdom35 构建走虚拟 DOM
import { removeById, rows, select, selected } from './state.js';
</script>

<template>
  <table>
    <tbody>
      <tr v-for="row in rows" :key="row.id" :class="{ danger: selected === row.id }">
        <td>{{ row.id }}</td>
        <td><a @click="select(row.id)">{{ row.label.value }}</a></td>
        <td><a class="remove" @click="removeById(row.id)">x</a></td>
      </tr>
    </tbody>
  </table>
</template>
