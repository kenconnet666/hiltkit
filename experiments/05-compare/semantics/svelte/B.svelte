<script>
  import { log, ownRef } from '../harness.js';
  let { ...rest } = $props();
</script>

<button class="own" style="font-weight: bold" onclick={() => log.push('own')} {@attach ownRef} {...rest}>x</button>
