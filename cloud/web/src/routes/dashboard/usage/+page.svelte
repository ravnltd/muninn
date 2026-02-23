<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { formatNumber } from '$lib/utils';
  import Header from '../../../components/dashboard/Header.svelte';
  import StatCard from '../../../components/dashboard/StatCard.svelte';
  import UsageBar from '../../../components/dashboard/UsageBar.svelte';
  import Card from '../../../components/ui/Card.svelte';
  import Badge from '../../../components/ui/Badge.svelte';
  import { getAuth } from '$lib/auth.svelte';
  import type { UsageInfo } from '$lib/types';

  const auth = getAuth();
  let usage = $state<UsageInfo | null>(null);

  onMount(async () => {
    try {
      usage = await api.getUsage();
    } catch { /* handled by api client */ }
  });

  const percent = $derived(
    usage ? Math.round((usage.toolCallCount / usage.limit) * 100) : 0
  );
</script>

<div class="max-w-4xl space-y-8">
  <Header title="Usage" description="Monitor your tool call usage for the current billing period." />

  {#if usage}
    <div class="grid sm:grid-cols-3 gap-4">
      <StatCard
        label="Tool calls used"
        value={formatNumber(usage.toolCallCount)}
      />
      <StatCard
        label="Limit"
        value={formatNumber(usage.limit)}
      />
      <StatCard
        label="Remaining"
        value={formatNumber(usage.limit - usage.toolCallCount)}
      />
    </div>

    <Card>
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold">Current period</h3>
          <Badge variant={auth.tenant?.plan === 'pro' ? 'success' : 'default'}>
            {auth.tenant?.plan ?? 'free'}
          </Badge>
        </div>
        <UsageBar used={usage.toolCallCount} limit={usage.limit} />
        <p class="text-sm text-zinc-500">
          Billing period: {usage.month}
        </p>
      </div>
    </Card>

    {#if auth.tenant?.plan === 'free' && percent >= 50}
      <Card>
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <div>
            <h3 class="font-semibold">Need more calls?</h3>
            <p class="text-sm text-zinc-400 mt-1">Upgrade to Pro for 100,000 tool calls/month, unlimited projects, and team features.</p>
            <a href="/dashboard/billing" class="text-sm text-emerald-400 hover:underline mt-2 inline-block">View plans</a>
          </div>
        </div>
      </Card>
    {/if}
  {:else}
    <Card>
      <p class="text-zinc-500 text-center py-8">Loading usage data...</p>
    </Card>
  {/if}
</div>
