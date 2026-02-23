<script lang="ts">
  import CodeBlock from '../../../components/ui/CodeBlock.svelte';
</script>

<svelte:head>
  <title>Getting Started — Muninn Cloud</title>
</svelte:head>

<section class="pt-36 pb-12 px-6">
  <div class="max-w-3xl mx-auto">
    <h1 class="text-4xl sm:text-5xl font-bold tracking-tight">Getting Started</h1>
    <p class="mt-4 text-lg text-zinc-400">Set up Muninn Cloud in under 2 minutes.</p>
  </div>
</section>

<section class="pb-24 px-6">
  <div class="max-w-3xl mx-auto space-y-12">
    <!-- Step 1 -->
    <div>
      <div class="flex items-center gap-3 mb-4">
        <span class="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-sm font-semibold text-emerald-400">1</span>
        <h2 class="text-xl font-semibold">Create an account</h2>
      </div>
      <p class="text-zinc-400 mb-4 ml-11">Sign up for free at <a href="/signup" class="text-emerald-400 hover:underline">muninn.pro/signup</a>. You'll get an API key immediately.</p>
    </div>

    <!-- Step 2 -->
    <div>
      <div class="flex items-center gap-3 mb-4">
        <span class="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-sm font-semibold text-emerald-400">2</span>
        <h2 class="text-xl font-semibold">Install Claude Code</h2>
      </div>
      <p class="text-zinc-400 mb-4 ml-11">If you haven't already, install Claude Code:</p>
      <div class="ml-11">
        <CodeBlock code="curl -fsSL https://claude.ai/install.sh | bash" />
      </div>
    </div>

    <!-- Step 3 -->
    <div>
      <div class="flex items-center gap-3 mb-4">
        <span class="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-sm font-semibold text-emerald-400">3</span>
        <h2 class="text-xl font-semibold">Connect Muninn</h2>
      </div>
      <p class="text-zinc-400 mb-4 ml-11">Add the Muninn MCP server to Claude Code. Replace <code class="text-emerald-400 bg-zinc-800 px-1.5 py-0.5 rounded text-sm">YOUR_API_KEY</code> with the key from step 1:</p>
      <div class="ml-11">
        <CodeBlock code="claude mcp add --scope user muninn \\\n  -- npx -y muninn-mcp@latest \\\n  --cloud YOUR_API_KEY" />
      </div>
    </div>

    <!-- Step 4 -->
    <div>
      <div class="flex items-center gap-3 mb-4">
        <span class="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-sm font-semibold text-emerald-400">4</span>
        <h2 class="text-xl font-semibold">Start coding</h2>
      </div>
      <p class="text-zinc-400 mb-4 ml-11">That's it. Open Claude Code in any project and Muninn will automatically:</p>
      <ul class="ml-11 space-y-2 text-zinc-400">
        <li class="flex items-start gap-3">
          <svg class="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
          Remember architectural decisions and their reasoning
        </li>
        <li class="flex items-start gap-3">
          <svg class="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
          Track file knowledge, fragility scores, and relationships
        </li>
        <li class="flex items-start gap-3">
          <svg class="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
          Learn patterns and conventions from your workflow
        </li>
        <li class="flex items-start gap-3">
          <svg class="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
          Sync across all your machines instantly
        </li>
      </ul>
    </div>

    <!-- Multi-machine -->
    <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <h3 class="font-semibold mb-2">Multi-machine setup</h3>
      <p class="text-sm text-zinc-400 mb-4">Run the same <code class="text-emerald-400 bg-zinc-800 px-1.5 py-0.5 rounded">claude mcp add</code> command on every machine. Your API key connects to the same cloud database — no additional configuration needed.</p>
    </div>

    <!-- Self-hosted -->
    <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <h3 class="font-semibold mb-2">Prefer self-hosting?</h3>
      <p class="text-sm text-zinc-400">Muninn is fully open source. Check out the <a href="https://github.com/ravnltd/muninn" class="text-emerald-400 hover:underline">GitHub repo</a> for self-hosted installation with Docker or local SQLite.</p>
    </div>
  </div>
</section>
