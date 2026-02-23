<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { getAuth } from '$lib/auth.svelte';
  import { formatNumber } from '$lib/utils';
  import Header from '../../components/dashboard/Header.svelte';
  import StatCard from '../../components/dashboard/StatCard.svelte';
  import UsageBar from '../../components/dashboard/UsageBar.svelte';
  import Card from '../../components/ui/Card.svelte';
  import Badge from '../../components/ui/Badge.svelte';
  import CodeBlock from '../../components/ui/CodeBlock.svelte';
  import type { UsageInfo, Project, HealthScore, HealthScoreHistoryPoint, ProjectBriefing } from '$lib/types';

  const auth = getAuth();
  let usage = $state<UsageInfo | null>(null);
  let projects = $state<Project[]>([]);
  let healthScore = $state<HealthScore | null>(null);
  let healthHistory = $state<HealthScoreHistoryPoint[]>([]);
  let briefing = $state<ProjectBriefing | null>(null);
  let briefingExpanded = $state(false);
  let refreshingBriefing = $state(false);

  function healthRingColor(score: number): string {
    if (score >= 80) return 'stroke-emerald-400';
    if (score >= 60) return 'stroke-amber-400';
    return 'stroke-red-400';
  }

  function healthColor(score: number): string {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-amber-400';
    return 'text-red-400';
  }

  function sparklinePath(points: HealthScoreHistoryPoint[]): string {
    if (points.length < 2) return '';
    const reversed = [...points].reverse();
    const maxScore = 100;
    const w = 120;
    const h = 32;
    const stepX = w / (reversed.length - 1);
    return reversed.map((p, i) => {
      const x = i * stepX;
      const y = h - (p.score / maxScore) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  async function loadProjectData(projectId: number) {
    const [hs, hist, br] = await Promise.all([
      api.getHealthScore(projectId).catch(() => null),
      api.getHealthHistory(projectId).then(r => r.history).catch(() => []),
      api.getProjectBriefing(projectId).catch(() => null),
    ]);
    healthScore = hs;
    healthHistory = hist;
    briefing = br;
  }

  async function refreshBriefing() {
    if (!projects.length) return;
    refreshingBriefing = true;
    try {
      briefing = await api.getProjectBriefing(projects[0].id, true);
    } catch { /* ignore */ }
    refreshingBriefing = false;
  }

  onMount(async () => {
    try {
      usage = await api.getUsage();
    } catch { /* handled by api client */ }
    try {
      const res = await api.getProjects();
      projects = res.projects;
      if (projects.length > 0) {
        await loadProjectData(projects[0].id);
      }
    } catch { /* ignore */ }
  });

  const setupCommand = $derived(
    `claude mcp add --scope user muninn \\\n  -- npx -y muninn-mcp@latest \\\n  --cloud YOUR_API_KEY`
  );
</script>

<div class="max-w-4xl space-y-8">
  <Header title="Overview" description="Welcome back." />

  <div class="grid sm:grid-cols-3 gap-4">
    <StatCard
      label="Plan"
      value={auth.tenant?.plan === 'pro' ? 'Pro' : 'Free'}
      subtitle={auth.tenant?.plan === 'free' ? 'Upgrade for more' : 'Active subscription'}
    />
    <StatCard
      label="Tool calls this month"
      value={usage ? formatNumber(usage.toolCallCount) : '...'}
      subtitle={usage ? `of ${formatNumber(usage.limit)}` : ''}
    />
    <StatCard
      label="Period"
      value={usage?.month ?? '...'}
    />
  </div>

  {#if usage}
    <Card>
      <UsageBar used={usage.toolCallCount} limit={usage.limit} />
    </Card>
  {/if}

  <!-- Health Score Widget -->
  {#if healthScore}
    <Card>
      <div class="flex items-start justify-between gap-6">
        <div class="flex items-center gap-4">
          <div class="relative w-16 h-16 shrink-0">
            <svg class="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke-width="2.5" class="stroke-zinc-800" />
              <circle
                cx="18" cy="18" r="15.9" fill="none" stroke-width="2.5"
                stroke-linecap="round"
                class={healthRingColor(healthScore.overall)}
                stroke-dasharray="{healthScore.overall}, 100"
              />
            </svg>
            <span class="absolute inset-0 flex items-center justify-center text-sm font-bold {healthColor(healthScore.overall)}">
              {healthScore.overall}
            </span>
          </div>
          <div>
            <p class="text-sm font-medium text-zinc-200">Health Score</p>
            <div class="mt-1 space-y-0.5">
              {#each healthScore.components.slice(0, 3) as comp}
                <div class="flex items-center gap-2 text-xs">
                  <span class="text-zinc-500 w-20 truncate" title={comp.name}>{comp.name}</span>
                  <div class="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full {comp.score >= 80 ? 'bg-emerald-400' : comp.score >= 60 ? 'bg-amber-400' : 'bg-red-400'}"
                      style="width: {comp.score}%"
                    ></div>
                  </div>
                  <span class="text-zinc-400 w-6 text-right">{comp.score}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>

        {#if healthHistory.length >= 2}
          <div class="shrink-0">
            <p class="text-xs text-zinc-500 mb-1">Trend</p>
            <svg width="120" height="32" class="overflow-visible">
              <polyline
                points={sparklinePath(healthHistory).replace(/[ML]/g, (m) => m === 'M' ? '' : ' ').trim()}
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class={healthColor(healthScore.overall)}
              />
            </svg>
          </div>
        {/if}
      </div>
    </Card>
  {/if}

  <!-- Project Briefing -->
  {#if briefing}
    <Card>
      <div class="flex items-center justify-between mb-2">
        <button
          onclick={() => { briefingExpanded = !briefingExpanded; }}
          class="flex items-center gap-2 text-sm font-semibold text-zinc-200 hover:text-white transition-colors"
        >
          <svg
            class="w-4 h-4 transition-transform {briefingExpanded ? 'rotate-90' : ''}"
            fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          Project Briefing
        </button>
        <button
          onclick={refreshBriefing}
          disabled={refreshingBriefing}
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
        >
          {refreshingBriefing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {#if briefingExpanded}
        <div class="space-y-4 mt-3">
          {#each briefing.sections as section}
            <div>
              <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">{section.section}</p>
              <p class="text-sm text-zinc-300 whitespace-pre-wrap">{section.content}</p>
            </div>
          {/each}
        </div>
        <p class="text-xs text-zinc-600 mt-3">Generated {briefing.generatedAt}</p>
      {/if}
    </Card>
  {/if}

  <Card>
    <h3 class="font-semibold mb-1">Quick setup</h3>
    <p class="text-sm text-zinc-400 mb-4">Add Muninn to Claude Code on any machine:</p>
    <CodeBlock code={setupCommand} />
  </Card>

  <div class="grid sm:grid-cols-3 gap-4">
    <a href="/dashboard/api-keys" class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <p class="text-sm font-medium">API Keys</p>
      <p class="text-xs text-zinc-500 mt-1">Manage access tokens</p>
    </a>
    <a href="/dashboard/team" class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <p class="text-sm font-medium">Team</p>
      <p class="text-xs text-zinc-500 mt-1">Invite collaborators</p>
    </a>
    <a href="/dashboard/billing" class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <p class="text-sm font-medium">Billing</p>
      <p class="text-xs text-zinc-500 mt-1">Manage subscription</p>
    </a>
  </div>
</div>
