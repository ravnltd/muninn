<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    columns: string[];
    children: Snippet;
    empty?: string;
  }

  let { columns, children, empty = 'No data' }: Props = $props();
</script>

<div class="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-zinc-800">
          {#each columns as col}
            <th class="text-left text-zinc-400 font-medium px-6 py-3">{col}</th>
          {/each}
        </tr>
      </thead>
      <tbody class="divide-y divide-zinc-800">
        {@render children()}
      </tbody>
    </table>
  </div>
</div>
