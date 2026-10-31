<script>
  // 小组件：状态、派生、动态属性、透传 rest、children
  let { label, children, ...rest } = $props();
  let count = $state(0);
  let doubled = $derived(count * 2);
</script>

<button {...rest} class={['btn', doubled > 4 && 'big']} data-doubled={doubled} onclick={() => count++}>
  {label}: {count} / {doubled} {@render children?.()}
</button>
