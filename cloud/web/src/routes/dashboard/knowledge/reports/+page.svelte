<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { Project, HealthScore, RoiMetrics, RiskAlert } from '$lib/types';
  import Header from '../../../../components/dashboard/Header.svelte';
  import Card from '../../../../components/ui/Card.svelte';
  import StatCard from '../../../../components/dashboard/StatCard.svelte';
  import Badge from '../../../../components/ui/Badge.svelte';
  import Spinner from '../../../../components/ui/Spinner.svelte';

  let projects = $state<Project[]>([]);
  let selectedProjectId = $state<number | null>(null);
  let healthScore = $state<HealthScore | null>(null);
  let roi = $state<RoiMetrics | null>(null);
  let riskAlerts = $state<RiskAlert[]>([]);
  let memoryCounts = $state<{ files: number; decisions: number; learnings: number; issues: number } | null>(null);
  let loadingProjects = $state(true);
  let loadingReport = $state(false);
  let exporting = $state(false);

  const currentMonth = $derived(new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));

  onMount(async () => {
    try {
      const res = await api.getProjects();
      projects = res.projects;
      if (projects.length > 0) {
        selectedProjectId = projects[0].id;
      }
    } catch { /* handled by api client */ }
    loadingProjects = false;
  });

  $effect(() => {
    const projectId = selectedProjectId;
    if (projectId === null) return;

    loadingReport = true;

    Promise.all([
      api.getHealthScore(projectId).catch(() => null),
      api.getRoiMetrics(projectId).catch(() => null),
      api.getRiskAlerts(projectId).catch(() => ({ alerts: [] })),
      api.getProjectMemory(projectId).catch(() => null),
    ]).then(([hs, r, ra, mem]) => {
      healthScore = hs;
      roi = r;
      riskAlerts = ra?.alerts ?? [];
      memoryCounts = mem ? {
        files: mem.files.length,
        decisions: mem.decisions.length,
        learnings: mem.learnings.length,
        issues: mem.issues.length,
      } : null;
    }).finally(() => {
      loadingReport = false;
    });
  });

  async function handleExport() {
    if (!selectedProjectId) return;
    exporting = true;
    try {
      const data = await api.exportMemory(selectedProjectId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `muninn-export-${selectedProjectId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // handled silently
    }
    exporting = false;
  }

  function healthColor(score: number): string {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-amber-400';
    return 'text-red-400';
  }

  function healthRingColor(score: number): string {
    if (score >= 80) return 'stroke-emerald-400';
    if (score >= 60) return 'stroke-amber-400';
    return 'stroke-red-400';
  }

  function severityVariant(severity: string): 'danger' | 'warning' | 'default' {
    if (severity === 'critical') return 'danger';
    if (severity === 'warning') return 'warning';
    return 'default';
  }
</script>

<div class="max-w-5xl space-y-6">
  <Header title="Monthly Value Report" description="See what Muninn has done for your project this month." />

  {#if loadingProjects}
    <div class="flex items-center justify-center py-20">
      <Spinner size="lg" />
    </div>
  {:else if projects.length === 0}
    <Card>
      <div class="text-center py-12">
        <p class="text-zinc-400 text-sm">No projects found. Connect Muninn to see your monthly report.</p>
      </div>
    </Card>
  {:else}
    <!-- Project selector + Export -->
    <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-end justify-between">
      <div>
        <label for="report-project" class="block text-sm font-medium text-zinc-300 mb-1.5">Project</label>
        <select
          id="report-project"
          bind:value={selectedProjectId}
          class="w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        >
          {#each projects as project}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </div>

      <button
        onclick={handleExport}
        disabled={exporting || !selectedProjectId}
        class="px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exporting ? 'Exporting...' : 'Export Memory JSON'}
      </button>
    </div>

    {#if loadingReport}
      <div class="flex items-center justify-center py-16">
        <Spinner />
      </div>
    {:else}
      <!-- Report Title -->
      <div class="border-b border-zinc-800 pb-4">
        <h2 class="text-xl font-semibold text-white">{currentMonth} Report</h2>
        <p class="text-sm text-zinc-500 mt-1">Generated from your project's memory data</p>
      </div>

      <!-- Health Score + Knowledge Counts -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Health Score Card -->
        <Card>
          <div class="flex items-center gap-6">
            {#if healthScore}
              <div class="relative w-24 h-24 shrink-0">
                <svg class="w-24 h-24 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke-width="2" class="stroke-zinc-800" />
                  <circle
                    cx="18" cy="18" r="15.9" fill="none" stroke-width="2"
                    stroke-linecap="round"
                    class={healthRingColor(healthScore.overall)}
                    stroke-dasharray="{healthScore.overall}, 100"
                  />
                </svg>
                <span class="absolute inset-0 flex items-center justify-center text-2xl font-bold {healthColor(healthScore.overall)}">
                  {healthScore.overall}
                </span>
              </div>
              <div class="flex-1 space-y-2">
                <h3 class="text-sm font-medium text-zinc-200">Health Score</h3>
                {#each healthScore.components as comp}
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-zinc-500 w-28 truncate" title={comp.name}>{comp.name}</span>
                    <div class="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        class="h-full rounded-full {comp.score >= 80 ? 'bg-emerald-400' : comp.score >= 60 ? 'bg-amber-400' : 'bg-red-400'}"
                        style="width: {comp.score}%"
                      ></div>
                    </div>
                    <span class="text-xs text-zinc-400 w-8 text-right">{comp.score}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="text-center py-4 w-full">
                <p class="text-zinc-500 text-sm">No health score computed yet.</p>
              </div>
            {/if}
          </div>
        </Card>

        <!-- Knowledge Inventory -->
        <Card>
          <h3 class="text-sm font-medium text-zinc-200 mb-4">Knowledge Inventory</h3>
          {#if memoryCounts}
            <div class="grid grid-cols-2 gap-4">
              <div>
                <p class="text-2xl font-bold text-cyan-400">{memoryCounts.files}</p>
                <p class="text-xs text-zinc-500">Files Tracked</p>
              </div>
              <div>
                <p class="text-2xl font-bold text-violet-400">{memoryCounts.decisions}</p>
                <p class="text-xs text-zinc-500">Decisions</p>
              </div>
              <div>
                <p class="text-2xl font-bold text-emerald-400">{memoryCounts.learnings}</p>
                <p class="text-xs text-zinc-500">Learnings</p>
              </div>
              <div>
                <p class="text-2xl font-bold text-red-400">{memoryCounts.issues}</p>
                <p class="text-xs text-zinc-500">Issues</p>
              </div>
            </div>
          {:else}
            <p class="text-zinc-500 text-sm">No memory data available.</p>
          {/if}
        </Card>
      </div>

      <!-- ROI Metrics -->
      {#if roi}
        <div>
          <h3 class="text-sm font-medium text-zinc-300 mb-3">Context ROI — This Month</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Contradictions Prevented"
              value={String(roi.contradictionsPrevented)}
              subtitle="Caught before commit"
            />
            <StatCard
              label="Context Hit Rate"
              value="{Math.round(roi.contextHitRate * 100)}%"
              subtitle="Predictions used"
            />
            <StatCard
              label="Learnings Applied"
              value={String(roi.learningsApplied)}
              subtitle="Reused knowledge"
            />
            <StatCard
              label="Sessions with Context"
              value="{roi.sessionsWithContext}/{roi.totalSessions}"
              subtitle="Context-assisted"
            />
          </div>
        </div>
      {/if}

      <!-- Risk Alerts -->
      <div>
        <h3 class="text-sm font-medium text-zinc-300 mb-3">Active Risk Alerts</h3>
        {#if riskAlerts.length === 0}
          <Card>
            <div class="flex items-center gap-3 py-2">
              <svg class="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span class="text-sm text-zinc-400">No active risk alerts. Your project is looking healthy.</span>
            </div>
          </Card>
        {:else}
          <div class="space-y-2">
            {#each riskAlerts as alert (alert.id)}
              <Card>
                <div class="flex items-start gap-3">
                  <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-zinc-200">{alert.title}</p>
                    {#if alert.details}
                      <p class="text-xs text-zinc-500 mt-1 line-clamp-2">{alert.details}</p>
                    {/if}
                    {#if alert.source_file}
                      <p class="text-xs text-zinc-600 mt-1 font-mono">{alert.source_file}</p>
                    {/if}
                  </div>
                </div>
              </Card>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
