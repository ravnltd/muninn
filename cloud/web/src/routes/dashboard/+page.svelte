<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { getAuth } from '$lib/auth.svelte';
  import { formatNumber } from '$lib/utils';
  import Header from '../../components/dashboard/Header.svelte';
  import StatCard from '../../components/dashboard/StatCard.svelte';
  import UsageBar from '../../components/dashboard/UsageBar.svelte';
  import Card from '../../components/ui/Card.svelte';
  import Badge from '../../components/ui/Badge.svelte';
  import CodeBlock from '../../components/ui/CodeBlock.svelte';
  import type { UsageInfo } from '$lib/types';

  const auth = getAuth();
  let usage = $state<UsageInfo | null>(null);

  onMount(async () => {
    try {
      usage = await api.getUsage();
    } catch { /* handled by api client */ }
  });

  const setupCommand = $derived(
    `claude mcp add --scope user muninn \\\n  -- npx -y muninn-mcp@latest \\\n  --cloud YOUR_API_KEY`
  );
</script>

<div class="max-w-4xl space-y-8">
  <Header title="Overview" description="Welcome back." />

  <div class="grid sm:grid-cols-3 gap-4">
    <StatCard
      label="Plan"
      value={auth.tenant?.plan === 'pro' ? 'Pro' : 'Free'}
      subtitle={auth.tenant?.plan === 'free' ? 'Upgrade for more' : 'Active subscription'}
    />
    <StatCard
      label="Tool calls this month"
      value={usage ? formatNumber(usage.toolCallCount) : '...'}
      subtitle={usage ? `of ${formatNumber(usage.limit)}` : ''}
    />
    <StatCard
      label="Period"
      value={usage?.month ?? '...'}
    />
  </div>

  {#if usage}
    <Card>
      <UsageBar used={usage.toolCallCount} limit={usage.limit} />
    </Card>
  {/if}

  <Card>
    <h3 class="font-semibold mb-1">Quick setup</h3>
    <p class="text-sm text-zinc-400 mb-4">Add Muninn to Claude Code on any machine:</p>
    <CodeBlock code={setupCommand} />
  </Card>

  <div class="grid sm:grid-cols-3 gap-4">
    <a href="/dashboard/api-keys" class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <p class="text-sm font-medium">API Keys</p>
      <p class="text-xs text-zinc-500 mt-1">Manage access tokens</p>
    </a>
    <a href="/dashboard/team" class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <p class="text-sm font-medium">Team</p>
      <p class="text-xs text-zinc-500 mt-1">Invite collaborators</p>
    </a>
    <a href="/dashboard/billing" class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <p class="text-sm font-medium">Billing</p>
      <p class="text-xs text-zinc-500 mt-1">Manage subscription</p>
    </a>
  </div>
</div>
