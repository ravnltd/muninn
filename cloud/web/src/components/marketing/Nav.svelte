<script lang="ts">
  import { page } from '$app/stores';
  import Button from '../ui/Button.svelte';

  let mobileOpen = $state(false);

  const links = [
    { href: '/pricing', label: 'Pricing' },
    { href: '/docs', label: 'Docs' }
  ];
</script>

<nav class="fixed top-0 w-full z-50 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-md">
  <div class="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
    <div class="flex items-center gap-8">
      <a href="/" class="text-lg font-semibold tracking-tight">Muninn</a>
      <div class="hidden sm:flex items-center gap-6">
        {#each links as link}
          <a
            href={link.href}
            class="text-sm transition-colors {$page.url.pathname === link.href ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}"
          >
            {link.label}
          </a>
        {/each}
      </div>
    </div>
    <div class="hidden sm:flex items-center gap-4">
      <a href="/login" class="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Log in</a>
      <Button size="sm" href="/signup">Sign up</Button>
    </div>
    <button class="sm:hidden text-zinc-400" onclick={() => mobileOpen = !mobileOpen}>
      <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        {#if mobileOpen}
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        {:else}
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        {/if}
      </svg>
    </button>
  </div>
  {#if mobileOpen}
    <div class="sm:hidden border-t border-zinc-800 bg-zinc-950 px-6 py-4 space-y-3">
      {#each links as link}
        <a href={link.href} class="block text-sm text-zinc-400 hover:text-zinc-200" onclick={() => mobileOpen = false}>{link.label}</a>
      {/each}
      <div class="pt-3 border-t border-zinc-800 flex flex-col gap-2">
        <a href="/login" class="text-sm text-zinc-400">Log in</a>
        <a href="/signup" class="text-sm text-emerald-400">Sign up</a>
      </div>
    </div>
  {/if}
</nav>
