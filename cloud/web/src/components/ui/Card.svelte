<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    padding?: boolean;
    children: Snippet;
  }

  let { padding = true, children }: Props = $props();
</script>

<div class="bg-zinc-900 border border-zinc-800 rounded-xl {padding ? 'p-6' : ''}">
  {@render children()}
</div>
