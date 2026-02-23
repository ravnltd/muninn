<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getAuth } from '$lib/auth.svelte';
  import { api } from '$lib/api';
  import type { Snippet } from 'svelte';
  import Sidebar from '../../components/dashboard/Sidebar.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';

  let { children }: { children: Snippet } = $props();
  const auth = getAuth();

  onMount(async () => {
    if (!api.isAuthenticated()) {
      goto('/login');
      return;
    }
    await auth.initialize();
    if (!auth.isAuthenticated) {
      goto('/login');
    }
  });
</script>

{#if auth.loading}
  <div class="min-h-screen flex items-center justify-center">
    <Spinner size="lg" />
  </div>
{:else if auth.isAuthenticated}
  <div class="flex min-h-screen">
    <Sidebar />
    <main class="flex-1 p-8">
      {@render children()}
    </main>
  </div>
{/if}
