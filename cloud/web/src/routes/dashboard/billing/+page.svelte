<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api';
  import { getAuth } from '$lib/auth.svelte';
  import Header from '../../../components/dashboard/Header.svelte';
  import Card from '../../../components/ui/Card.svelte';
  import Button from '../../../components/ui/Button.svelte';
  import Badge from '../../../components/ui/Badge.svelte';

  const auth = getAuth();
  let loading = $state(false);
  let error = $state('');
  let success = $state(false);

  onMount(() => {
    const params = $page.url.searchParams;
    if (params.get('success') === 'true') {
      success = true;
      auth.initialize();
    }
  });

  async function upgrade() {
    loading = true;
    error = '';
    try {
      const { url } = await api.createCheckout();
      window.location.href = url;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to start checkout';
      loading = false;
    }
  }

  async function manage() {
    loading = true;
    error = '';
    try {
      const { url } = await api.openPortal();
      window.location.href = url;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to open billing portal';
      loading = false;
    }
  }
</script>

<div class="max-w-4xl space-y-8">
  <Header title="Billing" description="Manage your subscription and payment method." />

  {#if success}
    <div class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-3 rounded-lg text-sm">
      Subscription activated! Your plan has been upgraded.
    </div>
  {/if}

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
      {error}
    </div>
  {/if}

  <Card>
    <div class="flex items-start justify-between">
      <div>
        <h3 class="font-semibold mb-1">Current plan</h3>
        <div class="flex items-center gap-3">
          <span class="text-3xl font-bold">
            {auth.tenant?.plan === 'pro' ? '$6.50' : '$0'}
          </span>
          <span class="text-zinc-500">/month</span>
          <Badge variant={auth.tenant?.plan === 'pro' ? 'success' : 'default'}>
            {auth.tenant?.plan ?? 'free'}
          </Badge>
        </div>
      </div>
    </div>

    <div class="mt-6 pt-6 border-t border-zinc-800">
      {#if auth.tenant?.plan === 'free'}
        <div class="space-y-4">
          <div>
            <h4 class="text-sm font-medium mb-2">Upgrade to Pro</h4>
            <ul class="space-y-1.5 text-sm text-zinc-400">
              <li>100,000 tool calls / month (10x more)</li>
              <li>Unlimited projects</li>
              <li>Team collaboration, SSO, BYOD</li>
              <li>Priority support</li>
            </ul>
          </div>
          <Button onclick={upgrade} {loading} disabled={loading}>
            {loading ? 'Redirecting...' : 'Upgrade to Pro — $6.50/mo'}
          </Button>
        </div>
      {:else}
        <Button variant="secondary" onclick={manage} {loading} disabled={loading}>
          {loading ? 'Opening...' : 'Manage subscription'}
        </Button>
      {/if}
    </div>
  </Card>
</div>
