<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { Project, SessionInfo, RoiMetrics } from '$lib/types';
  import Header from '../../../../components/dashboard/Header.svelte';
  import StatCard from '../../../../components/dashboard/StatCard.svelte';
  import Card from '../../../../components/ui/Card.svelte';
  import Badge from '../../../../components/ui/Badge.svelte';
  import Spinner from '../../../../components/ui/Spinner.svelte';

  let projects = $state<Project[]>([]);
  let selectedProjectId = $state<number | null>(null);
  let sessions = $state<SessionInfo[]>([]);
  let roi = $state<RoiMetrics | null>(null);
  let loadingProjects = $state(true);
  let loadingData = $state(false);
  let expandedSession = $state<number | null>(null);

  const selectedProject = $derived(
    projects.find((p) => p.id === selectedProjectId) ?? null
  );

  onMount(async () => {
    try {
      const res = await api.getProjects();
      projects = res.projects;
      if (projects.length > 0) {
        selectedProjectId = projects[0].id;
      }
    } catch {
      /* handled by api client */
    } finally {
      loadingProjects = false;
    }
  });

  $effect(() => {
    if (selectedProjectId === null) return;
    const projectId = selectedProjectId;

    loadingData = true;
    sessions = [];
    roi = null;
    expandedSession = null;

    Promise.all([
      api.getProjectSessions(projectId, 100),
      api.getRoiMetrics(projectId)
    ])
      .then(([sessionsRes, roiRes]) => {
        if (selectedProjectId !== projectId) return;
        sessions = sessionsRes.sessions;
        roi = roiRes;
      })
      .catch(() => {
        /* handled by api client */
      })
      .finally(() => {
        if (selectedProjectId === projectId) {
          loadingData = false;
        }
      });
  });

  function successColor(success: number | null): string {
    if (success === 2) return '#34d399';
    if (success === 1) return '#fbbf24';
    if (success === 0) return '#f87171';
    return '#22d3ee';
  }

  function successLabel(session: SessionInfo): string {
    if (session.ended_at === null) return 'active';
    if (session.success === 2) return 'success';
    if (session.success === 1) return 'partial';
    if (session.success === 0) return 'failed';
    return 'active';
  }

  function successBadgeVariant(session: SessionInfo): 'success' | 'warning' | 'danger' | 'default' {
    if (session.ended_at === null) return 'default';
    if (session.success === 2) return 'success';
    if (session.success === 1) return 'warning';
    if (session.success === 0) return 'danger';
    return 'default';
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getFilesTouched(session: SessionInfo): string[] {
    if (!session.files_touched) return [];
    try {
      return JSON.parse(session.files_touched);
    } catch {
      return [];
    }
  }

  function toggleSession(id: number): void {
    expandedSession = expandedSession === id ? null : id;
  }

  function handleProjectChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    selectedProjectId = Number(target.value);
  }
</script>

<div class="max-w-[900px] mx-auto space-y-8">
  <Header title="Session Timeline" description="Track your coding sessions and their outcomes" />

  <!-- Project Selector -->
  {#if loadingProjects}
    <div class="flex items-center justify-center py-12">
      <Spinner size="lg" />
    </div>
  {:else if projects.length === 0}
    <Card>
      <div class="text-center py-12">
        <p class="text-zinc-400 text-lg mb-2">No projects found</p>
        <p class="text-zinc-500 text-sm">Connect Muninn to a project to see session history here.</p>
      </div>
    </Card>
  {:else}
    <div>
      <label for="project-select" class="block text-sm font-medium text-zinc-400 mb-2">Project</label>
      <select
        id="project-select"
        value={selectedProjectId}
        onchange={handleProjectChange}
        class="w-full max-w-xs bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
      >
        {#each projects as project (project.id)}
          <option value={project.id}>{project.name}</option>
        {/each}
      </select>
    </div>

    <!-- ROI Metrics -->
    {#if loadingData}
      <div class="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    {:else}
      {#if roi}
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Contradictions Prevented"
            value={String(roi.contradictionsPrevented)}
            subtitle="This month"
          />
          <StatCard
            label="Context Hit Rate"
            value={`${Math.round(roi.contextHitRate * 100)}%`}
            subtitle="Accuracy of context"
          />
          <StatCard
            label="Learnings Applied"
            value={String(roi.learningsApplied)}
            subtitle="Reused knowledge"
          />
          <StatCard
            label="Sessions with Context"
            value={`${roi.sessionsWithContext}/${roi.totalSessions}`}
            subtitle="Context-assisted"
          />
        </div>
      {/if}

      <!-- Session Timeline -->
      {#if sessions.length === 0}
        <Card>
          <div class="text-center py-12">
            <p class="text-zinc-400">No sessions recorded yet for this project.</p>
          </div>
        </Card>
      {:else}
        <div class="flex flex-col">
          {#each sessions as session, i (session.id)}
            <button
              type="button"
              class="flex gap-5 text-left w-full group"
              onclick={() => toggleSession(session.id)}
            >
              <!-- Connector -->
              <div class="flex flex-col items-center w-5 shrink-0">
                <div
                  class="w-3 h-3 rounded-full mt-5 shrink-0 timeline-dot"
                  style="background: {successColor(session.success)}; box-shadow: 0 0 8px {successColor(session.success)}40;"
                ></div>
                {#if i < sessions.length - 1}
                  <div class="w-0.5 flex-1 bg-zinc-800 mt-1"></div>
                {/if}
              </div>

              <!-- Session Card -->
              <div
                class="flex-1 mb-3 bg-zinc-900 border rounded-xl p-4 transition-colors {expandedSession === session.id ? 'border-emerald-500/40' : 'border-zinc-800 group-hover:border-zinc-700'}"
              >
                <div class="flex items-center gap-3 mb-2 flex-wrap">
                  <span class="font-semibold text-emerald-400 font-mono text-sm">
                    #{session.session_number ?? session.id}
                  </span>
                  <span class="text-zinc-500 text-xs">
                    {formatDate(session.started_at)}
                  </span>
                  <Badge variant={successBadgeVariant(session)}>
                    {successLabel(session)}
                  </Badge>
                </div>

                <p class="text-zinc-300 text-sm">
                  {session.goal ?? 'No goal set'}
                </p>

                {#if expandedSession === session.id}
                  <div class="mt-4 pt-4 border-t border-zinc-800 space-y-3">
                    {#if session.outcome}
                      <div>
                        <p class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Outcome</p>
                        <p class="text-sm text-zinc-300">{session.outcome}</p>
                      </div>
                    {/if}

                    {#if session.ended_at}
                      <div>
                        <p class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Ended</p>
                        <p class="text-sm text-zinc-400">{formatDate(session.ended_at)}</p>
                      </div>
                    {/if}

                    {#if getFilesTouched(session).length > 0}
                      <div>
                        <p class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Files Touched</p>
                        <div class="flex flex-wrap gap-1.5">
                          {#each getFilesTouched(session) as file}
                            <span class="bg-zinc-800 px-2 py-0.5 rounded text-xs font-mono text-zinc-400">
                              {file}
                            </span>
                          {/each}
                        </div>
                      </div>
                    {/if}

                    {#if !session.outcome && getFilesTouched(session).length === 0 && !session.ended_at}
                      <p class="text-sm text-zinc-500 italic">No additional details available.</p>
                    {/if}
                  </div>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .timeline-dot {
    transition: transform 150ms ease;
  }
  .group:hover .timeline-dot {
    transform: scale(1.3);
  }
</style>
