<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
    title: string;
    children: Snippet;
    actions?: Snippet;
  }

  let { open, onclose, title, children, actions }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    onkeydown={handleKeydown}
    onclick={handleBackdrop}
  >
    <div class="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md shadow-2xl">
      <div class="flex items-center justify-between p-6 border-b border-zinc-800">
        <h2 class="text-lg font-semibold">{title}</h2>
        <button onclick={onclose} class="text-zinc-400 hover:text-zinc-200" aria-label="Close">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="p-6">
        {@render children()}
      </div>
      {#if actions}
        <div class="flex items-center justify-end gap-3 p-6 border-t border-zinc-800">
          {@render actions()}
        </div>
      {/if}
    </div>
  </div>
{/if}
