<script lang="ts">
  import { formatNumber, usagePercent } from '$lib/utils';

  interface Props {
    used: number;
    limit: number;
    label?: string;
  }

  let { used, limit, label = 'Tool calls' }: Props = $props();

  const percent = $derived(usagePercent(used, limit));
  const barColor = $derived(
    percent >= 90 ? 'bg-red-500' :
    percent >= 75 ? 'bg-amber-500' :
    'bg-emerald-500'
  );
</script>

<div>
  <div class="flex items-center justify-between mb-2">
    <span class="text-sm text-zinc-400">{label}</span>
    <span class="text-sm text-zinc-300">{formatNumber(used)} / {formatNumber(limit)}</span>
  </div>
  <div class="h-2 bg-zinc-800 rounded-full overflow-hidden">
    <div
      class="h-full rounded-full transition-all {barColor}"
      style="width: {percent}%"
    ></div>
  </div>
  {#if percent >= 90}
    <p class="mt-1 text-xs text-red-400">Approaching limit</p>
  {/if}
</div>
