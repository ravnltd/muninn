<section class="py-24 px-6 border-t border-zinc-800/50">
  <div class="max-w-6xl mx-auto">
    <h2 class="text-2xl sm:text-3xl font-bold text-center mb-4">Everything your AI needs to remember</h2>
    <p class="text-zinc-400 text-center mb-16 max-w-xl mx-auto">A complete memory layer purpose-built for AI-assisted development.</p>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each features as f}
        <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <svg class="w-5 h-5 text-emerald-400 mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d={f.icon} />
          </svg>
          <h3 class="font-semibold mb-1.5">{f.title}</h3>
          <p class="text-sm text-zinc-400 leading-relaxed">{f.description}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<script lang="ts">
  const features = [
    {
      title: 'Project memory',
      description: 'Full-text and semantic search across your project\'s accumulated knowledge. Query what matters, when it matters.',
      icon: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125'
    },
    {
      title: 'Decision tracking',
      description: 'Record architectural decisions with reasoning. Your AI will never contradict a past choice or repeat a resolved debate.',
      icon: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z'
    },
    {
      title: 'File knowledge',
      description: 'Track purpose, fragility, and relationships for every file. Your AI knows what is safe to change and what is not.',
      icon: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z'
    },
    {
      title: 'Pattern recognition',
      description: 'Learnings and conventions are saved automatically. Your AI applies your team\'s preferred patterns from day one.',
      icon: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z'
    },
    {
      title: 'Session continuity',
      description: 'Pick up exactly where you left off. Session goals, outcomes, and next steps carry forward automatically.',
      icon: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182'
    },
    {
      title: 'Multi-machine sync',
      description: 'One hosted database for all your machines. Same memory on your laptop, desktop, and CI — no local setup required.',
      icon: 'M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z'
    }
  ];
</script>
