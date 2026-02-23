<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { getAuth } from '$lib/auth.svelte';
  import Button from '../../../components/ui/Button.svelte';
  import Input from '../../../components/ui/Input.svelte';

  const auth = getAuth();

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';

    try {
      const res = await api.login(email, password);
      auth.setTenant(res.tenant);
      goto('/dashboard');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Login failed. Please try again.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Log in — Muninn</title>
</svelte:head>

<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
  <h1 class="text-xl font-semibold text-center mb-6">Sign in to Muninn</h1>

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm mb-4">
      {error}
    </div>
  {/if}

  <form onsubmit={handleSubmit} class="space-y-4">
    <Input
      type="email"
      id="email"
      label="Email"
      placeholder="you@example.com"
      bind:value={email}
      required
    />
    <Input
      type="password"
      id="password"
      label="Password"
      placeholder="Your password"
      bind:value={password}
      required
    />
    <Button type="submit" {loading} disabled={loading}>
      {loading ? 'Signing in...' : 'Sign in'}
    </Button>
  </form>

  <p class="text-center text-sm text-zinc-500 mt-4">
    Don't have an account? <a href="/signup" class="text-emerald-400 hover:underline">Sign up</a>
  </p>
</div>
