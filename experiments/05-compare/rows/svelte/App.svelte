<script>
  import { getRows, getSelected, select, removeById } from './state.svelte.js';
</script>

<table>
  <tbody>
    {#each getRows() as row (row.id)}
      <tr class={getSelected() === row.id ? 'danger' : ''}>
        <td>{row.id}</td>
        <td><a onclick={() => select(row.id)}>{row.label}</a></td>
        <td><a class="remove" onclick={() => removeById(row.id)}>x</a></td>
      </tr>
    {/each}
  </tbody>
</table>
