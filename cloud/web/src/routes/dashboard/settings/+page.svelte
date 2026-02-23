<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { getAuth } from '$lib/auth.svelte';
  import Header from '../../../components/dashboard/Header.svelte';
  import Card from '../../../components/ui/Card.svelte';
  import Button from '../../../components/ui/Button.svelte';
  import Input from '../../../components/ui/Input.svelte';
  import Modal from '../../../components/ui/Modal.svelte';
  import CodeBlock from '../../../components/ui/CodeBlock.svelte';

  const auth = getAuth();

  // BYOD
  let dbUrl = $state('');
  let dbToken = $state('');
  let savingDb = $state(false);
  let dbMsg = $state('');

  // Export
  let exporting = $state(false);

  // Danger zone
  let deleteModal = $state(false);
  let deleteConfirm = $state('');
  let deleting = $state(false);
  let error = $state('');

  async function saveDatabase() {
    savingDb = true;
    dbMsg = '';
    try {
      await api.setDatabase(dbUrl, dbToken);
      dbMsg = 'Database configuration saved.';
      dbUrl = '';
      dbToken = '';
    } catch (err) {
      dbMsg = err instanceof ApiError ? err.message : 'Failed to save';
    } finally {
      savingDb = false;
    }
  }

  async function exportData() {
    exporting = true;
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `muninn-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Export failed';
    } finally {
      exporting = false;
    }
  }

  async function deleteAccount() {
    deleting = true;
    try {
      await api.deleteAccount();
      api.logout();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to delete account';
      deleting = false;
    }
  }
</script>

<div class="max-w-4xl space-y-8">
  <Header title="Settings" description="Manage your account and preferences." />

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
      {error}
    </div>
  {/if}

  <!-- Account info -->
  <Card>
    <h3 class="font-semibold mb-4">Account</h3>
    <div class="space-y-3 text-sm">
      <div class="flex items-center justify-between">
        <span class="text-zinc-400">Email</span>
        <span class="text-zinc-200">{auth.tenant?.email}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-zinc-400">Name</span>
        <span class="text-zinc-200">{auth.tenant?.name ?? '—'}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-zinc-400">Tenant ID</span>
        <span class="text-zinc-400 font-mono text-xs">{auth.tenant?.id}</span>
      </div>
    </div>
  </Card>

  <!-- BYOD -->
  <Card>
    <h3 class="font-semibold mb-1">Bring your own database</h3>
    <p class="text-sm text-zinc-400 mb-4">Connect your own Turso/LibSQL database for full data ownership.</p>

    {#if dbMsg}
      <div class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-2 rounded-lg text-sm mb-4">
        {dbMsg}
      </div>
    {/if}

    <form onsubmit={(e) => { e.preventDefault(); saveDatabase(); }} class="space-y-3">
      <Input label="Database URL" placeholder="libsql://your-db.turso.io" bind:value={dbUrl} />
      <Input type="password" label="Auth Token" placeholder="Your Turso auth token" bind:value={dbToken} />
      <Button type="submit" variant="secondary" loading={savingDb} disabled={savingDb || !dbUrl || !dbToken}>
        Save configuration
      </Button>
    </form>
  </Card>

  <!-- Data export -->
  <Card>
    <h3 class="font-semibold mb-1">Export data</h3>
    <p class="text-sm text-zinc-400 mb-4">Download all your data in JSON format.</p>
    <Button variant="secondary" onclick={exportData} loading={exporting} disabled={exporting}>
      {exporting ? 'Exporting...' : 'Export data'}
    </Button>
  </Card>

  <!-- Danger zone -->
  <div class="border border-red-500/20 rounded-xl p-6">
    <h3 class="font-semibold text-red-400 mb-1">Danger zone</h3>
    <p class="text-sm text-zinc-400 mb-4">Permanently delete your account and all associated data. This cannot be undone.</p>
    <Button variant="danger" onclick={() => { deleteModal = true; }}>Delete account</Button>
  </div>
</div>

<Modal
  open={deleteModal}
  onclose={() => { deleteModal = false; deleteConfirm = ''; }}
  title="Delete account"
>
  <div class="space-y-4">
    <p class="text-sm text-zinc-400">This will permanently delete your account, all API keys, team data, and usage history. This action cannot be undone.</p>
    <Input
      label="Type DELETE to confirm"
      placeholder="DELETE"
      bind:value={deleteConfirm}
    />
  </div>

  {#snippet actions()}
    <Button variant="secondary" onclick={() => { deleteModal = false; deleteConfirm = ''; }}>Cancel</Button>
    <Button variant="danger" onclick={deleteAccount} loading={deleting} disabled={deleteConfirm !== 'DELETE' || deleting}>
      Delete forever
    </Button>
  {/snippet}
</Modal>
