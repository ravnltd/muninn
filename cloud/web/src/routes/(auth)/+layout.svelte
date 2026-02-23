<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="min-h-screen flex items-center justify-center p-4">
  <div class="w-full max-w-sm">
    <div class="text-center mb-8">
      <a href="/" class="inline-block text-2xl font-semibold tracking-tight">Muninn</a>
    </div>
    {@render children()}
  </div>
</div>
