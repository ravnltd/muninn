<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { formatDateTime, copyToClipboard } from '$lib/utils';
  import Header from '../../../components/dashboard/Header.svelte';
  import DataTable from '../../../components/dashboard/DataTable.svelte';
  import Button from '../../../components/ui/Button.svelte';
  import Input from '../../../components/ui/Input.svelte';
  import Card from '../../../components/ui/Card.svelte';
  import Modal from '../../../components/ui/Modal.svelte';
  import CodeBlock from '../../../components/ui/CodeBlock.svelte';
  import type { ApiKeyRecord, ApiKeyCreated } from '$lib/types';

  let keys = $state<ApiKeyRecord[]>([]);
  let newKeyName = $state('');
  let creating = $state(false);
  let createdKey = $state<ApiKeyCreated | null>(null);
  let revokeTarget = $state<ApiKeyRecord | null>(null);
  let error = $state('');

  onMount(loadKeys);

  async function loadKeys() {
    try {
      const res = await api.getKeys();
      keys = res.keys;
    } catch { /* handled by api client */ }
  }

  async function createKey() {
    creating = true;
    error = '';
    try {
      const key = await api.createKey(newKeyName || undefined);
      createdKey = key;
      newKeyName = '';
      await loadKeys();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to create key';
    } finally {
      creating = false;
    }
  }

  async function revokeKey() {
    if (!revokeTarget) return;
    try {
      await api.revokeKey(revokeTarget.id);
      revokeTarget = null;
      await loadKeys();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to revoke key';
    }
  }
</script>

<div class="max-w-4xl space-y-8">
  <Header title="API Keys" description="Create and manage API keys for accessing Muninn." />

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
      {error}
    </div>
  {/if}

  {#if createdKey}
    <Card>
      <h3 class="font-semibold mb-2">Key created</h3>
      <p class="text-sm text-zinc-400 mb-3">Copy this key now — you won't see it again.</p>
      <CodeBlock code={createdKey.key} />
      <div class="mt-3">
        <Button size="sm" variant="secondary" onclick={() => { createdKey = null; }}>Done</Button>
      </div>
    </Card>
  {/if}

  <Card>
    <h3 class="font-semibold mb-4">Create new key</h3>
    <form onsubmit={(e) => { e.preventDefault(); createKey(); }} class="flex gap-3">
      <div class="flex-1">
        <Input placeholder="Key name (optional)" bind:value={newKeyName} />
      </div>
      <Button type="submit" loading={creating} disabled={creating}>Create</Button>
    </form>
  </Card>

  <DataTable columns={['Name', 'Prefix', 'Created', '']}>
    {#each keys as key}
      <tr>
        <td class="px-6 py-3 text-zinc-300">{key.name ?? '—'}</td>
        <td class="px-6 py-3 font-mono text-sm text-zinc-400">{key.prefix}...</td>
        <td class="px-6 py-3 text-zinc-400">{formatDateTime(key.createdAt)}</td>
        <td class="px-6 py-3 text-right">
          <button
            onclick={() => { revokeTarget = key; }}
            class="text-sm text-red-400 hover:text-red-300"
          >
            Revoke
          </button>
        </td>
      </tr>
    {:else}
      <tr>
        <td colspan="4" class="px-6 py-8 text-center text-zinc-500">No API keys yet</td>
      </tr>
    {/each}
  </DataTable>
</div>

<Modal
  open={revokeTarget !== null}
  onclose={() => { revokeTarget = null; }}
  title="Revoke API key"
>
  <p class="text-sm text-zinc-400">
    Are you sure you want to revoke <span class="text-zinc-200 font-mono">{revokeTarget?.prefix}...</span>?
    Any applications using this key will lose access immediately.
  </p>

  {#snippet actions()}
    <Button variant="secondary" onclick={() => { revokeTarget = null; }}>Cancel</Button>
    <Button variant="danger" onclick={revokeKey}>Revoke</Button>
  {/snippet}
</Modal>
