<script lang="ts">
  import Button from '../ui/Button.svelte';

  interface Props {
    showCta?: boolean;
  }

  let { showCta = true }: Props = $props();
</script>

<section class="py-24 px-6 border-t border-zinc-800/50">
  <div class="max-w-4xl mx-auto">
    <h2 class="text-2xl sm:text-3xl font-bold text-center mb-4">Simple pricing</h2>
    <p class="text-zinc-400 text-center mb-16 max-w-xl mx-auto">Start free. Upgrade when your usage grows.</p>
    <div class="grid md:grid-cols-2 gap-6">
      <!-- Free -->
      <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-8">
        <div class="text-sm font-medium text-zinc-400 mb-1">Free</div>
        <div class="flex items-baseline gap-1 mb-6">
          <span class="text-4xl font-bold">$0</span>
          <span class="text-zinc-500">/mo</span>
        </div>
        <ul class="space-y-3 mb-8">
          {#each freeFeatures as f}
            <li class="flex items-center gap-3 text-sm text-zinc-300">
              <svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
              {f}
            </li>
          {/each}
        </ul>
        {#if showCta}
          <Button variant="secondary" href="/signup">Get Started</Button>
        {/if}
      </div>
      <!-- Pro -->
      <div class="bg-zinc-900 border border-emerald-500/30 rounded-xl p-8 relative">
        <div class="absolute -top-3 left-8 bg-emerald-500 text-zinc-950 text-xs font-semibold px-3 py-1 rounded-full">Popular</div>
        <div class="text-sm font-medium text-emerald-400 mb-1">Pro</div>
        <div class="flex items-baseline gap-1 mb-6">
          <span class="text-4xl font-bold">$6.50</span>
          <span class="text-zinc-500">/mo</span>
        </div>
        <ul class="space-y-3 mb-8">
          {#each proFeatures as f}
            <li class="flex items-center gap-3 text-sm text-zinc-300">
              <svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
              {f}
            </li>
          {/each}
        </ul>
        {#if showCta}
          <Button href="/signup">Get Started</Button>
        {/if}
      </div>
    </div>
  </div>
</section>

<script module lang="ts">
  const freeFeatures = [
    '10,000 tool calls / month',
    '1 project',
    'Community support'
  ];

  const proFeatures = [
    '100,000 tool calls / month',
    'Unlimited projects',
    'Priority support',
    'Usage analytics',
    'Team collaboration',
    'BYOD (bring your own database)'
  ];
</script>
