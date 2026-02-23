<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { getAuth } from '$lib/auth.svelte';
  import Button from '../../../components/ui/Button.svelte';
  import Input from '../../../components/ui/Input.svelte';
  import CodeBlock from '../../../components/ui/CodeBlock.svelte';
  import type { SignupResponse } from '$lib/types';

  const auth = getAuth();

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');
  let result = $state<SignupResponse | null>(null);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';

    try {
      const res = await api.signup(email, password, name || undefined);
      auth.setTenant(res.tenant);
      result = res;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Signup failed. Please try again.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Sign up — Muninn</title>
</svelte:head>

<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
  {#if result}
    <h1 class="text-xl font-semibold text-center mb-2">You're in</h1>
    <p class="text-sm text-zinc-400 text-center mb-6">Connect Muninn to Claude Code with this command:</p>

    <CodeBlock code={result.setup.command} />

    <p class="text-xs text-zinc-500 mt-3 mb-6">{result.setup.note}</p>

    <Button onclick={() => goto('/dashboard')}>Go to Dashboard</Button>
  {:else}
    <h1 class="text-xl font-semibold text-center mb-6">Create your account</h1>

    {#if error}
      <div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm mb-4">
        {error}
      </div>
    {/if}

    <form onsubmit={handleSubmit} class="space-y-4">
      <Input
        type="text"
        id="name"
        label="Name"
        placeholder="Your name (optional)"
        bind:value={name}
      />
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
        placeholder="Min 8 characters"
        bind:value={password}
        required
      />
      <Button type="submit" {loading} disabled={loading}>
        {loading ? 'Creating account...' : 'Create account'}
      </Button>
    </form>

    <p class="text-center text-sm text-zinc-500 mt-4">
      Already have an account? <a href="/login" class="text-emerald-400 hover:underline">Sign in</a>
    </p>
  {/if}
</div>
