<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { formatDate } from '$lib/utils';
  import Header from '../../../components/dashboard/Header.svelte';
  import DataTable from '../../../components/dashboard/DataTable.svelte';
  import Card from '../../../components/ui/Card.svelte';
  import Button from '../../../components/ui/Button.svelte';
  import Input from '../../../components/ui/Input.svelte';
  import Badge from '../../../components/ui/Badge.svelte';
  import Modal from '../../../components/ui/Modal.svelte';
  import type { TeamMember, Invitation, Role } from '$lib/types';

  let members = $state<TeamMember[]>([]);
  let invitations = $state<Invitation[]>([]);
  let inviteEmail = $state('');
  let inviteRole = $state<Role>('member');
  let inviting = $state(false);
  let error = $state('');
  let removeTarget = $state<TeamMember | null>(null);

  onMount(loadAll);

  async function loadAll() {
    try {
      const [m, i] = await Promise.all([api.getMembers(), api.getInvitations()]);
      members = m.members;
      invitations = i.invitations;
    } catch { /* handled by api client */ }
  }

  async function invite() {
    inviting = true;
    error = '';
    try {
      await api.inviteMember(inviteEmail, inviteRole);
      inviteEmail = '';
      await loadAll();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to send invite';
    } finally {
      inviting = false;
    }
  }

  async function changeRole(userId: string, role: string) {
    try {
      await api.updateMemberRole(userId, role);
      await loadAll();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to update role';
    }
  }

  async function removeMember() {
    if (!removeTarget) return;
    try {
      await api.removeMember(removeTarget.id);
      removeTarget = null;
      await loadAll();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to remove member';
    }
  }

  async function revokeInvite(id: string) {
    try {
      await api.revokeInvitation(id);
      await loadAll();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Failed to revoke invitation';
    }
  }
</script>

<div class="max-w-4xl space-y-8">
  <Header title="Team" description="Manage your team members and invitations." />

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
      {error}
    </div>
  {/if}

  <Card>
    <h3 class="font-semibold mb-4">Invite a team member</h3>
    <form onsubmit={(e) => { e.preventDefault(); invite(); }} class="flex gap-3">
      <div class="flex-1">
        <Input type="email" placeholder="colleague@company.com" bind:value={inviteEmail} required />
      </div>
      <select
        bind:value={inviteRole}
        class="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
        <option value="viewer">Viewer</option>
      </select>
      <Button type="submit" loading={inviting} disabled={inviting}>Invite</Button>
    </form>
  </Card>

  <h3 class="font-semibold">Members</h3>
  <DataTable columns={['Email', 'Role', 'Last login', '']}>
    {#each members as member}
      <tr>
        <td class="px-6 py-3">
          <div>
            <span class="text-zinc-200">{member.email}</span>
            {#if member.name}
              <span class="text-zinc-500 ml-2">{member.name}</span>
            {/if}
          </div>
        </td>
        <td class="px-6 py-3">
          {#if member.role === 'owner'}
            <Badge variant="success">Owner</Badge>
          {:else}
            <select
              value={member.role}
              onchange={(e) => changeRole(member.id, (e.target as HTMLSelectElement).value)}
              class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          {/if}
        </td>
        <td class="px-6 py-3 text-zinc-400">
          {member.lastLoginAt ? formatDate(member.lastLoginAt) : 'Never'}
        </td>
        <td class="px-6 py-3 text-right">
          {#if member.role !== 'owner'}
            <button
              onclick={() => { removeTarget = member; }}
              class="text-sm text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          {/if}
        </td>
      </tr>
    {:else}
      <tr>
        <td colspan="4" class="px-6 py-8 text-center text-zinc-500">No team members yet</td>
      </tr>
    {/each}
  </DataTable>

  {#if invitations.length > 0}
    <h3 class="font-semibold">Pending invitations</h3>
    <DataTable columns={['Email', 'Role', 'Expires', '']}>
      {#each invitations.filter(i => !i.acceptedAt) as inv}
        <tr>
          <td class="px-6 py-3 text-zinc-300">{inv.email}</td>
          <td class="px-6 py-3"><Badge>{inv.role}</Badge></td>
          <td class="px-6 py-3 text-zinc-400">{formatDate(inv.expiresAt)}</td>
          <td class="px-6 py-3 text-right">
            <button onclick={() => revokeInvite(inv.id)} class="text-sm text-red-400 hover:text-red-300">Cancel</button>
          </td>
        </tr>
      {/each}
    </DataTable>
  {/if}
</div>

<Modal
  open={removeTarget !== null}
  onclose={() => { removeTarget = null; }}
  title="Remove team member"
>
  <p class="text-sm text-zinc-400">
    Are you sure you want to remove <span class="text-zinc-200">{removeTarget?.email}</span> from your team? They will lose access immediately.
  </p>

  {#snippet actions()}
    <Button variant="secondary" onclick={() => { removeTarget = null; }}>Cancel</Button>
    <Button variant="danger" onclick={removeMember}>Remove</Button>
  {/snippet}
</Modal>
