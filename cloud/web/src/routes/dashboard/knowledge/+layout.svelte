<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/stores';

  let { children }: { children: Snippet } = $props();

  const tabs = [
    { href: '/dashboard/knowledge', label: 'Browser' },
    { href: '/dashboard/knowledge/graph', label: 'Graph' },
    { href: '/dashboard/knowledge/timeline', label: 'Timeline' },
    { href: '/dashboard/knowledge/reports', label: 'Reports' },
  ];
</script>

<div class="space-y-6">
  <!-- Sub-navigation tabs -->
  <nav class="flex gap-1 border-b border-zinc-800 pb-px">
    {#each tabs as tab}
      {@const active = $page.url.pathname === tab.href}
      <a
        href={tab.href}
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {active
          ? 'border-emerald-400 text-emerald-400'
          : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'}"
      >
        {tab.label}
      </a>
    {/each}
  </nav>

  {@render children()}
</div>
