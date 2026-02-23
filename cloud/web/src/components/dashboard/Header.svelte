<script lang="ts">
  interface Props {
    title: string;
    description?: string;
  }

  let { title, description }: Props = $props();
</script>

<div class="mb-8">
  <h1 class="text-2xl font-bold tracking-tight">{title}</h1>
  {#if description}
    <p class="mt-1 text-zinc-400">{description}</p>
  {/if}
</div>
