<script>
  import Counter from './Counter.svelte';
  let el = $state();
</script>

<!-- 调用方：传 class / style / 事件 / ref / children -->
<Counter label="n" class="outer" style="color: red" onclick={() => console.log('outer click')} bind:this={el}>
  <b>child</b>
</Counter>
