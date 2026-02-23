<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <title>Muninn Cloud</title>
  <meta name="description" content="Hosted persistent memory for Claude Code. Your AI remembers decisions, patterns, and project context across every session." />
</svelte:head>

{@render children()}
