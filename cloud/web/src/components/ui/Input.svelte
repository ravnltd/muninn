<script lang="ts">
  interface Props {
    type?: string;
    id?: string;
    name?: string;
    value?: string;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    label?: string;
    error?: string;
    oninput?: (e: Event) => void;
  }

  let {
    type = 'text',
    id,
    name,
    value = $bindable(''),
    placeholder,
    required = false,
    disabled = false,
    label,
    error,
    oninput
  }: Props = $props();
</script>

<div>
  {#if label}
    <label for={id} class="block text-sm font-medium text-zinc-300 mb-1.5">{label}</label>
  {/if}
  <input
    {type}
    {id}
    {name}
    bind:value
    {placeholder}
    {required}
    {disabled}
    {oninput}
    class="w-full px-3 py-2 bg-zinc-800 border rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent {error ? 'border-red-500' : 'border-zinc-700'}"
  />
  {#if error}
    <p class="mt-1 text-sm text-red-400">{error}</p>
  {/if}
</div>
