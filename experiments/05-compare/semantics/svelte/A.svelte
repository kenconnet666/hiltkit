<script>
  import { log, ownRef } from '../harness.js';
  let { ...rest } = $props();
</script>

<button {...rest} class="own" style="font-weight: bold" onclick={() => log.push('own')} {@attach ownRef}>x</button>
