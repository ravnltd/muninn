<script lang="ts">
  interface Props {
    label: string;
    value: string;
    subtitle?: string;
  }

  let { label, value, subtitle }: Props = $props();
</script>

<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
  <p class="text-sm text-zinc-400 mb-1">{label}</p>
  <p class="text-3xl font-bold tracking-tight">{value}</p>
  {#if subtitle}
    <p class="text-sm text-zinc-500 mt-1">{subtitle}</p>
  {/if}
</div>
