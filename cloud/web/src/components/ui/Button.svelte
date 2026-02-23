<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit';
    href?: string;
    onclick?: () => void;
    children: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    type = 'button',
    href,
    onclick,
    children
  }: Props = $props();

  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed';

  const variants: Record<string, string> = {
    primary: 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 focus:ring-emerald-500',
    secondary: 'border border-zinc-700 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100 focus:ring-zinc-500',
    danger: 'bg-red-600 hover:bg-red-500 text-white focus:ring-red-500',
    ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 focus:ring-zinc-500'
  };

  const sizes: Record<string, string> = {
    sm: 'text-sm px-3 py-1.5',
    md: 'text-sm px-4 py-2.5',
    lg: 'text-base px-6 py-3'
  };

  const classes = $derived(`${base} ${variants[variant]} ${sizes[size]}`);
</script>

{#if href}
  <a {href} class={classes}>
    {#if loading}
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    {/if}
    {@render children()}
  </a>
{:else}
  <button {type} disabled={disabled || loading} class={classes} {onclick}>
    {#if loading}
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    {/if}
    {@render children()}
  </button>
{/if}
