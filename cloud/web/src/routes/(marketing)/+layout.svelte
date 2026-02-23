<script lang="ts">
  import type { Snippet } from 'svelte';
  import Nav from '../../components/marketing/Nav.svelte';
  import Footer from '../../components/marketing/Footer.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<Nav />
<main>
  {@render children()}
</main>
<Footer />
