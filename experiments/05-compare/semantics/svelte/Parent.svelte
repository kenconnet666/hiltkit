<script>
  import { log, parentRef } from '../harness.js';
  import A from './A.svelte';
  import B from './B.svelte';
</script>

<!-- Svelte 没有把 ref 透传到内部元素的机制，用 {@attach} 作等价物：它以 Symbol 键进入 rest，再被 spread 带到元素上 -->
<A class="parent" style="color: red" onclick={() => log.push('parent')} {@attach parentRef} />
<B class="parent" style="color: red" onclick={() => log.push('parent')} {@attach parentRef} />
