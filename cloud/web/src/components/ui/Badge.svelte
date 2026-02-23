<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'success' | 'warning' | 'danger';
    children: Snippet;
  }

  let { variant = 'default', children }: Props = $props();

  const variants: Record<string, string> = {
    default: 'bg-zinc-800 text-zinc-300',
    success: 'bg-emerald-500/10 text-emerald-400',
    warning: 'bg-amber-500/10 text-amber-400',
    danger: 'bg-red-500/10 text-red-400'
  };
</script>

<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {variants[variant]}">
  {@render children()}
</span>
