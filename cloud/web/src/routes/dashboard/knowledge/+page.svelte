<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { formatDate, formatDateTime } from '$lib/utils';
  import Header from '../../../components/dashboard/Header.svelte';
  import Card from '../../../components/ui/Card.svelte';
  import Badge from '../../../components/ui/Badge.svelte';
  import Spinner from '../../../components/ui/Spinner.svelte';
  import type {
    Project,
    FileInfo,
    DecisionInfo,
    LearningInfo,
    IssueInfo,
    HealthScore,
    KnowledgeMemory,
    ArchivedItem
  } from '$lib/types';

  type Tab = 'files' | 'decisions' | 'learnings' | 'issues' | 'archived';
  type SelectedItem = FileInfo | DecisionInfo | LearningInfo | IssueInfo;

  let projects = $state<Project[]>([]);
  let selectedProjectId = $state<number | null>(null);
  let memory = $state<KnowledgeMemory | null>(null);
  let healthScore = $state<HealthScore | null>(null);
  let activeTab = $state<Tab>('files');
  let searchQuery = $state('');
  let debouncedQuery = $state('');
  let selectedItem = $state<SelectedItem | null>(null);
  let archivedItems = $state<ArchivedItem[]>([]);
  let loading = $state(true);
  let loadingMemory = $state(false);
  let restoringId = $state<number | null>(null);

  // Debounce search input (300ms)
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const query = searchQuery;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedQuery = query;
    }, 300);
    return () => clearTimeout(debounceTimer);
  });

  // Tab counts
  const fileCt = $derived(memory?.files.length ?? 0);
  const decisionCt = $derived(memory?.decisions.length ?? 0);
  const learningCt = $derived(memory?.learnings.length ?? 0);
  const issueCt = $derived(memory?.issues.length ?? 0);
  const archivedCt = $derived(archivedItems.length);

  // Filtered items per tab
  const filteredFiles = $derived(filterItems(memory?.files ?? [], debouncedQuery, fileSearchText));
  const filteredDecisions = $derived(filterItems(memory?.decisions ?? [], debouncedQuery, decisionSearchText));
  const filteredLearnings = $derived(filterItems(memory?.learnings ?? [], debouncedQuery, learningSearchText));
  const filteredIssues = $derived(filterItems(memory?.issues ?? [], debouncedQuery, issueSearchText));

  function filterItems<T>(items: T[], query: string, textFn: (item: T) => string): T[] {
    if (!query.trim()) return items;
    const lower = query.toLowerCase();
    return items.filter(item => textFn(item).toLowerCase().includes(lower));
  }

  function fileSearchText(f: FileInfo): string {
    return `${f.path} ${f.purpose ?? ''} ${f.type ?? ''}`;
  }

  function decisionSearchText(d: DecisionInfo): string {
    return `${d.title} ${d.decision} ${d.reasoning ?? ''}`;
  }

  function learningSearchText(l: LearningInfo): string {
    return `${l.title} ${l.content} ${l.category} ${l.context ?? ''}`;
  }

  function issueSearchText(i: IssueInfo): string {
    return `${i.title} ${i.description ?? ''} ${i.type ?? ''} ${i.resolution ?? ''}`;
  }

  onMount(async () => {
    try {
      const res = await api.getProjects();
      projects = res.projects;
      if (projects.length > 0) {
        selectedProjectId = projects[0].id;
      }
    } catch { /* handled by api client */ }
    loading = false;
  });

  // Load memory + health score when project changes
  $effect(() => {
    const projectId = selectedProjectId;
    if (projectId === null) return;

    loadingMemory = true;
    selectedItem = null;
    searchQuery = '';

    Promise.all([
      api.getProjectMemory(projectId),
      api.getHealthScore(projectId),
      api.getArchivedKnowledge(projectId).then(r => r.archived).catch(() => [])
    ]).then(([mem, hs, arch]) => {
      memory = mem;
      healthScore = hs;
      archivedItems = arch;
    }).catch(() => {
      memory = null;
      healthScore = null;
      archivedItems = [];
    }).finally(() => {
      loadingMemory = false;
    });
  });

  function switchTab(tab: Tab) {
    activeTab = tab;
    selectedItem = null;
  }

  function selectFile(f: FileInfo) { selectedItem = f; }
  function selectDecision(d: DecisionInfo) { selectedItem = d; }
  function selectLearning(l: LearningInfo) { selectedItem = l; }
  function selectIssue(i: IssueInfo) { selectedItem = i; }

  function isSelectedFile(item: SelectedItem | null): item is FileInfo {
    return item !== null && 'path' in item && 'fragility' in item && !('severity' in item);
  }
  function isSelectedDecision(item: SelectedItem | null): item is DecisionInfo {
    return item !== null && 'decision' in item && 'reasoning' in item;
  }
  function isSelectedLearning(item: SelectedItem | null): item is LearningInfo {
    return item !== null && 'confidence' in item && 'category' in item;
  }
  function isSelectedIssue(item: SelectedItem | null): item is IssueInfo {
    return item !== null && 'severity' in item && 'status' in item && !('confidence' in item);
  }

  function outcomeVariant(outcome: string | null): 'success' | 'danger' | 'warning' | 'default' {
    if (outcome === 'succeeded') return 'success';
    if (outcome === 'failed') return 'danger';
    if (outcome === 'revised') return 'warning';
    return 'default';
  }

  function severityVariant(severity: number): 'danger' | 'warning' | 'default' {
    if (severity >= 8) return 'danger';
    if (severity >= 5) return 'warning';
    return 'default';
  }

  function fragilityColor(fragility: number): string {
    if (fragility >= 7) return 'text-red-400';
    if (fragility >= 4) return 'text-amber-400';
    return 'text-zinc-400';
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

  function parseFragilitySignals(raw: string | null): Array<{ name: string; value: number }> {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed).map(([name, value]) => ({
          name,
          value: typeof value === 'number' ? value : 0
        }));
      }
    } catch { /* ignore parse errors */ }
    return [];
  }

  function fileName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? path;
  }

  function sourceLabel(table: string): string {
    if (table === 'learnings') return 'Learning';
    if (table === 'decisions') return 'Decision';
    if (table === 'issues') return 'Issue';
    return table;
  }

  function sourceVariant(table: string): 'default' | 'warning' | 'success' {
    if (table === 'learnings') return 'success';
    if (table === 'decisions') return 'warning';
    return 'default';
  }

  async function restoreArchived(item: ArchivedItem) {
    if (!selectedProjectId) return;
    restoringId = item.id;
    try {
      await api.restoreArchivedItem(selectedProjectId, item.id);
      archivedItems = archivedItems.filter(a => a.id !== item.id);
    } catch { /* ignore */ }
    restoringId = null;
  }

  function fileDir(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
  }
</script>

<div class="max-w-7xl space-y-6">
  <Header title="Knowledge Explorer" description="Browse your project memory." />

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <Spinner size="lg" />
    </div>
  {:else if projects.length === 0}
    <Card>
      <div class="text-center py-12">
        <svg class="w-12 h-12 mx-auto text-zinc-600 mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
        <p class="text-zinc-400 text-sm">No projects found. Connect Muninn to a project to see its knowledge here.</p>
      </div>
    </Card>
  {:else}
    <!-- Project selector + Health score row -->
    <div class="flex flex-col sm:flex-row gap-4 items-start">
      <div class="flex-1">
        <label for="project-select" class="block text-sm font-medium text-zinc-300 mb-1.5">Project</label>
        <select
          id="project-select"
          bind:value={selectedProjectId}
          class="w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        >
          {#each projects as project}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </div>

      {#if healthScore}
        <Card>
          <div class="flex items-center gap-4">
            <div class="relative w-16 h-16">
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
        </Card>
      {/if}
    </div>

    {#if loadingMemory}
      <div class="flex items-center justify-center py-16">
        <Spinner />
      </div>
    {:else if memory}
      <!-- Tab bar -->
      <div class="border-b border-zinc-800">
        <div class="flex gap-1" role="tablist">
          {#each [
            { key: 'files' as Tab, label: 'Files', count: fileCt },
            { key: 'decisions' as Tab, label: 'Decisions', count: decisionCt },
            { key: 'learnings' as Tab, label: 'Learnings', count: learningCt },
            { key: 'issues' as Tab, label: 'Issues', count: issueCt },
            { key: 'archived' as Tab, label: 'Archived', count: archivedCt }
          ] as tab}
            <button
              role="tab"
              aria-selected={activeTab === tab.key}
              onclick={() => switchTab(tab.key)}
              class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors {activeTab === tab.key
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'}"
            >
              {tab.label}
              <span class="ml-1.5 text-xs px-1.5 py-0.5 rounded-full {activeTab === tab.key
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-zinc-800 text-zinc-500'}">{tab.count}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Search -->
      <div>
        <input
          type="text"
          placeholder="Search {activeTab}..."
          bind:value={searchQuery}
          class="w-full max-w-md px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
      </div>

      <!-- List + Detail grid -->
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[500px]">
        <!-- List panel (2 cols) -->
        <div class="lg:col-span-2 overflow-y-auto max-h-[600px] space-y-1 pr-1">
          {#if activeTab === 'files'}
            {#each filteredFiles as file (file.id)}
              <button
                onclick={() => selectFile(file)}
                class="w-full text-left px-3 py-2.5 rounded-lg transition-colors {selectedItem === file
                  ? 'bg-zinc-800 border border-zinc-700'
                  : 'hover:bg-zinc-800/50 border border-transparent'}"
              >
                <div class="flex items-center gap-2">
                  <span class="text-sm text-zinc-200 truncate flex-1" title={file.path}>{fileName(file.path)}</span>
                  {#if file.fragility >= 7}
                    <Badge variant="danger">{file.fragility}</Badge>
                  {:else if file.fragility >= 4}
                    <Badge variant="warning">{file.fragility}</Badge>
                  {/if}
                </div>
                <p class="text-xs text-zinc-500 truncate mt-0.5">{fileDir(file.path)}</p>
              </button>
            {:else}
              <div class="text-center py-8 text-sm text-zinc-500">
                {debouncedQuery ? 'No files match your search.' : 'No files tracked yet.'}
              </div>
            {/each}

          {:else if activeTab === 'decisions'}
            {#each filteredDecisions as decision (decision.id)}
              <button
                onclick={() => selectDecision(decision)}
                class="w-full text-left px-3 py-2.5 rounded-lg transition-colors {selectedItem === decision
                  ? 'bg-zinc-800 border border-zinc-700'
                  : 'hover:bg-zinc-800/50 border border-transparent'}"
              >
                <div class="flex items-center gap-2">
                  <span class="text-sm text-zinc-200 truncate flex-1">{decision.title}</span>
                  {#if decision.outcome}
                    <Badge variant={outcomeVariant(decision.outcome)}>{decision.outcome}</Badge>
                  {/if}
                </div>
                <p class="text-xs text-zinc-500 mt-0.5">{formatDate(decision.created_at)}</p>
              </button>
            {:else}
              <div class="text-center py-8 text-sm text-zinc-500">
                {debouncedQuery ? 'No decisions match your search.' : 'No decisions recorded yet.'}
              </div>
            {/each}

          {:else if activeTab === 'learnings'}
            {#each filteredLearnings as learning (learning.id)}
              <button
                onclick={() => selectLearning(learning)}
                class="w-full text-left px-3 py-2.5 rounded-lg transition-colors {selectedItem === learning
                  ? 'bg-zinc-800 border border-zinc-700'
                  : 'hover:bg-zinc-800/50 border border-transparent'}"
              >
                <div class="flex items-center gap-2">
                  <span class="text-sm text-zinc-200 truncate flex-1">{learning.title}</span>
                  <span class="text-xs text-zinc-500 shrink-0">{learning.category}</span>
                </div>
                <div class="flex items-center gap-2 mt-1">
                  <div class="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden max-w-[80px]">
                    <div
                      class="h-full rounded-full {learning.confidence >= 7 ? 'bg-emerald-400' : learning.confidence >= 4 ? 'bg-amber-400' : 'bg-red-400'}"
                      style="width: {learning.confidence * 10}%"
                    ></div>
                  </div>
                  <span class="text-xs text-zinc-500">{learning.confidence}/10</span>
                </div>
              </button>
            {:else}
              <div class="text-center py-8 text-sm text-zinc-500">
                {debouncedQuery ? 'No learnings match your search.' : 'No learnings recorded yet.'}
              </div>
            {/each}

          {:else if activeTab === 'issues'}
            {#each filteredIssues as issue (issue.id)}
              <button
                onclick={() => selectIssue(issue)}
                class="w-full text-left px-3 py-2.5 rounded-lg transition-colors {selectedItem === issue
                  ? 'bg-zinc-800 border border-zinc-700'
                  : 'hover:bg-zinc-800/50 border border-transparent'}"
              >
                <div class="flex items-center gap-2">
                  <span class="text-sm text-zinc-200 truncate flex-1">{issue.title}</span>
                  <Badge variant={severityVariant(issue.severity)}>{issue.severity}</Badge>
                </div>
                <div class="flex items-center gap-2 mt-0.5">
                  {#if issue.type}
                    <span class="text-xs text-zinc-500">{issue.type}</span>
                  {/if}
                  <span class="text-xs {issue.status === 'open' ? 'text-amber-400' : 'text-zinc-500'}">{issue.status}</span>
                </div>
              </button>
            {:else}
              <div class="text-center py-8 text-sm text-zinc-500">
                {debouncedQuery ? 'No issues match your search.' : 'No issues tracked yet.'}
              </div>
            {/each}

          {:else if activeTab === 'archived'}
            {#each archivedItems as item (item.id)}
              <div class="px-3 py-2.5 rounded-lg border border-transparent hover:bg-zinc-800/50">
                <div class="flex items-center gap-2">
                  <Badge variant={sourceVariant(item.source_table)}>{sourceLabel(item.source_table)}</Badge>
                  <span class="text-sm text-zinc-200 truncate flex-1">{item.title}</span>
                </div>
                {#if item.reason}
                  <p class="text-xs text-zinc-500 mt-0.5 truncate">{item.reason}</p>
                {/if}
                <div class="flex items-center justify-between mt-1">
                  <span class="text-xs text-zinc-600">{formatDate(item.archived_at)}</span>
                  <button
                    onclick={() => restoreArchived(item)}
                    disabled={restoringId === item.id}
                    class="text-xs text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
                  >
                    {restoringId === item.id ? 'Restoring...' : 'Restore'}
                  </button>
                </div>
              </div>
            {:else}
              <div class="text-center py-8 text-sm text-zinc-500">
                No archived items.
              </div>
            {/each}
          {/if}
        </div>

        <!-- Detail panel (3 cols) -->
        <div class="lg:col-span-3">
          {#if selectedItem === null}
            <div class="flex items-center justify-center h-full">
              <div class="text-center">
                <svg class="w-10 h-10 mx-auto text-zinc-700 mb-3" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <p class="text-sm text-zinc-500">Select an item to view details</p>
              </div>
            </div>

          {:else if isSelectedFile(selectedItem)}
            <Card>
              <div class="space-y-4">
                <div>
                  <h3 class="text-lg font-semibold text-white break-all">{selectedItem.path}</h3>
                  {#if selectedItem.type}
                    <span class="inline-block mt-1 text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{selectedItem.type}</span>
                  {/if}
                </div>

                {#if selectedItem.purpose}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Purpose</p>
                    <p class="text-sm text-zinc-300">{selectedItem.purpose}</p>
                  </div>
                {/if}

                <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Fragility</p>
                    <p class="text-lg font-bold {fragilityColor(selectedItem.fragility)}">{selectedItem.fragility}<span class="text-xs font-normal text-zinc-500">/10</span></p>
                  </div>
                  {#if selectedItem.temperature}
                    <div>
                      <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Temperature</p>
                      <p class="text-sm text-zinc-300 capitalize">{selectedItem.temperature}</p>
                    </div>
                  {/if}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Changes</p>
                    <p class="text-sm text-zinc-300">{selectedItem.change_count}</p>
                  </div>
                </div>

                {#if selectedItem.fragility_signals}
                  {@const signals = parseFragilitySignals(selectedItem.fragility_signals)}
                  {#if signals.length > 0}
                    <div>
                      <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Fragility Signals</p>
                      <div class="space-y-1.5">
                        {#each signals as signal}
                          <div class="flex items-center gap-2">
                            <span class="text-xs text-zinc-400 w-24 truncate capitalize" title={signal.name}>{signal.name.replace(/_/g, ' ')}</span>
                            <div class="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                class="h-full rounded-full {signal.value >= 0.7 ? 'bg-red-400' : signal.value >= 0.4 ? 'bg-amber-400' : 'bg-emerald-400'}"
                                style="width: {Math.round(signal.value * 100)}%"
                              ></div>
                            </div>
                            <span class="text-xs text-zinc-500 w-10 text-right">{(signal.value * 10).toFixed(1)}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                {/if}

                <div class="pt-2 border-t border-zinc-800 text-xs text-zinc-500 flex gap-4">
                  <span>Created {formatDate(selectedItem.created_at)}</span>
                  <span>Updated {formatDate(selectedItem.updated_at)}</span>
                  {#if selectedItem.archived_at}
                    <span class="text-amber-400">Archived {formatDate(selectedItem.archived_at)}</span>
                  {/if}
                </div>
              </div>
            </Card>

          {:else if isSelectedDecision(selectedItem)}
            <Card>
              <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <h3 class="text-lg font-semibold text-white">{selectedItem.title}</h3>
                  {#if selectedItem.outcome}
                    <Badge variant={outcomeVariant(selectedItem.outcome)}>{selectedItem.outcome}</Badge>
                  {/if}
                </div>

                <div>
                  <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Decision</p>
                  <p class="text-sm text-zinc-300 whitespace-pre-wrap">{selectedItem.decision}</p>
                </div>

                {#if selectedItem.reasoning}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Reasoning</p>
                    <p class="text-sm text-zinc-300 whitespace-pre-wrap">{selectedItem.reasoning}</p>
                  </div>
                {/if}

                <div class="flex items-center gap-4">
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Status</p>
                    <span class="text-sm text-zinc-300 capitalize">{selectedItem.status}</span>
                  </div>
                  {#if selectedItem.temperature}
                    <div>
                      <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Temperature</p>
                      <span class="text-sm text-zinc-300 capitalize">{selectedItem.temperature}</span>
                    </div>
                  {/if}
                </div>

                <div class="pt-2 border-t border-zinc-800 text-xs text-zinc-500 flex gap-4">
                  <span>Created {formatDate(selectedItem.created_at)}</span>
                  <span>Updated {formatDate(selectedItem.updated_at)}</span>
                </div>
              </div>
            </Card>

          {:else if isSelectedLearning(selectedItem)}
            <Card>
              <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <h3 class="text-lg font-semibold text-white">{selectedItem.title}</h3>
                  <span class="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">{selectedItem.category}</span>
                </div>

                <div>
                  <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Content</p>
                  <p class="text-sm text-zinc-300 whitespace-pre-wrap">{selectedItem.content}</p>
                </div>

                {#if selectedItem.context}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Context</p>
                    <p class="text-sm text-zinc-300 whitespace-pre-wrap">{selectedItem.context}</p>
                  </div>
                {/if}

                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">Confidence</p>
                    <div class="flex items-center gap-3">
                      <div class="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          class="h-full rounded-full transition-all {selectedItem.confidence >= 7 ? 'bg-emerald-400' : selectedItem.confidence >= 4 ? 'bg-amber-400' : 'bg-red-400'}"
                          style="width: {selectedItem.confidence * 10}%"
                        ></div>
                      </div>
                      <span class="text-sm font-medium {selectedItem.confidence >= 7 ? 'text-emerald-400' : selectedItem.confidence >= 4 ? 'text-amber-400' : 'text-red-400'}">{selectedItem.confidence}/10</span>
                    </div>
                  </div>
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Reinforcements</p>
                    <p class="text-sm text-zinc-300">{selectedItem.auto_reinforcement_count}</p>
                  </div>
                </div>

                {#if selectedItem.temperature}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Temperature</p>
                    <span class="text-sm text-zinc-300 capitalize">{selectedItem.temperature}</span>
                  </div>
                {/if}

                <div class="pt-2 border-t border-zinc-800 text-xs text-zinc-500 flex gap-4">
                  <span>Created {formatDate(selectedItem.created_at)}</span>
                  <span>Updated {formatDate(selectedItem.updated_at)}</span>
                </div>
              </div>
            </Card>

          {:else if isSelectedIssue(selectedItem)}
            <Card>
              <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <h3 class="text-lg font-semibold text-white">{selectedItem.title}</h3>
                  <div class="flex items-center gap-2 shrink-0">
                    <Badge variant={severityVariant(selectedItem.severity)}>sev {selectedItem.severity}</Badge>
                    <Badge variant={selectedItem.status === 'open' ? 'warning' : 'success'}>{selectedItem.status}</Badge>
                  </div>
                </div>

                {#if selectedItem.description}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Description</p>
                    <p class="text-sm text-zinc-300 whitespace-pre-wrap">{selectedItem.description}</p>
                  </div>
                {/if}

                {#if selectedItem.type}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Type</p>
                    <span class="text-sm text-zinc-300 capitalize">{selectedItem.type}</span>
                  </div>
                {/if}

                {#if selectedItem.resolution}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Resolution</p>
                    <p class="text-sm text-zinc-300 whitespace-pre-wrap">{selectedItem.resolution}</p>
                  </div>
                {/if}

                {#if selectedItem.workaround}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Workaround</p>
                    <p class="text-sm text-zinc-300 whitespace-pre-wrap">{selectedItem.workaround}</p>
                  </div>
                {/if}

                <div class="pt-2 border-t border-zinc-800 text-xs text-zinc-500 flex gap-4">
                  <span>Created {formatDate(selectedItem.created_at)}</span>
                  <span>Updated {formatDate(selectedItem.updated_at)}</span>
                </div>
              </div>
            </Card>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
