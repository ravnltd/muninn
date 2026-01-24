<script lang="ts">
  import { getFiles, getDecisions, getLearnings, getIssues, type FileInfo, type DecisionInfo, type LearningInfo, type IssueInfo } from "../lib/api";

  let { projectId }: { projectId: number } = $props();

  type TabType = "files" | "decisions" | "learnings" | "issues";
  let activeTab = $state<TabType>("files");
  let searchQuery = $state("");

  let files = $state<FileInfo[]>([]);
  let decisions = $state<DecisionInfo[]>([]);
  let learnings = $state<LearningInfo[]>([]);
  let issues = $state<IssueInfo[]>([]);
  let selectedItem = $state<any>(null);

  $effect(() => {
    if (projectId) {
      getFiles(projectId).then((f) => files = f).catch(() => {});
      getDecisions(projectId).then((d) => decisions = d).catch(() => {});
      getLearnings(projectId).then((l) => learnings = l).catch(() => {});
      getIssues(projectId).then((i) => issues = i).catch(() => {});
    }
  });

  function filterItems<T extends { title?: string; path?: string; content?: string }>(items: T[]): T[] {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((item) => {
      const text = `${(item as any).title ?? ""} ${(item as any).path ?? ""} ${(item as any).content ?? ""} ${(item as any).purpose ?? ""}`.toLowerCase();
      return text.includes(q);
    });
  }

  function temperatureBadge(temp: string | null): string {
    if (!temp) return "cold";
    return temp;
  }
</script>

<div class="memory-page">
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="tabs">
      <button class:active={activeTab === "files"} onclick={() => activeTab = "files"}>
        Files ({files.length})
      </button>
      <button class:active={activeTab === "decisions"} onclick={() => activeTab = "decisions"}>
        Decisions ({decisions.length})
      </button>
      <button class:active={activeTab === "learnings"} onclick={() => activeTab = "learnings"}>
        Learnings ({learnings.length})
      </button>
      <button class:active={activeTab === "issues"} onclick={() => activeTab = "issues"}>
        Issues ({issues.length})
      </button>
    </div>
    <input
      class="search-input"
      type="text"
      placeholder="Search memories..."
      bind:value={searchQuery}
    />
  </div>

  <div class="content-layout">
    <!-- List Panel -->
    <div class="list-panel">
      {#if activeTab === "files"}
        {#each filterItems(files as any) as file (file.id)}
          <div class="list-item" class:selected={selectedItem?.id === file.id && selectedItem?.type === 'file'} onclick={() => selectedItem = { ...file, type: 'file' }}>
            <div class="item-title mono">{file.path}</div>
            <div class="item-meta">
              <span class="badge badge-{temperatureBadge(file.temperature)}">{file.temperature ?? "cold"}</span>
              {#if file.fragility >= 7}
                <span class="badge badge-hot">fragile:{file.fragility}</span>
              {/if}
              {#if file.archived_at}
                <span class="badge badge-archived">archived</span>
              {/if}
            </div>
          </div>
        {/each}
      {:else if activeTab === "decisions"}
        {#each filterItems(decisions as any) as decision (decision.id)}
          <div class="list-item" class:selected={selectedItem?.id === decision.id && selectedItem?.type === 'decision'} onclick={() => selectedItem = { ...decision, type: 'decision' }}>
            <div class="item-title">{decision.title}</div>
            <div class="item-meta">
              <span class="badge badge-{temperatureBadge(decision.temperature)}">{decision.temperature ?? "cold"}</span>
              <span class="text-muted">{decision.status}</span>
            </div>
          </div>
        {/each}
      {:else if activeTab === "learnings"}
        {#each filterItems(learnings as any) as learning (learning.id)}
          <div class="list-item" class:selected={selectedItem?.id === learning.id && selectedItem?.type === 'learning'} onclick={() => selectedItem = { ...learning, type: 'learning' }}>
            <div class="item-title">{learning.title}</div>
            <div class="item-meta">
              <span class="badge badge-{temperatureBadge(learning.temperature)}">{learning.temperature ?? "cold"}</span>
              <span class="text-muted">{learning.category}</span>
            </div>
          </div>
        {/each}
      {:else if activeTab === "issues"}
        {#each filterItems(issues as any) as issue (issue.id)}
          <div class="list-item" class:selected={selectedItem?.id === issue.id && selectedItem?.type === 'issue'} onclick={() => selectedItem = { ...issue, type: 'issue' }}>
            <div class="item-title">{issue.title}</div>
            <div class="item-meta">
              <span class="badge" class:badge-hot={issue.severity >= 7} class:badge-warm={issue.severity >= 4 && issue.severity < 7} class:badge-cold={issue.severity < 4}>
                sev:{issue.severity}
              </span>
              <span class="text-muted">{issue.status}</span>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Detail Panel -->
    <div class="detail-panel card">
      {#if selectedItem}
        <h3>{selectedItem.title || selectedItem.path}</h3>
        <div class="detail-type">{selectedItem.type}</div>

        {#if selectedItem.purpose}
          <div class="detail-section">
            <h4>Purpose</h4>
            <p>{selectedItem.purpose}</p>
          </div>
        {/if}

        {#if selectedItem.decision}
          <div class="detail-section">
            <h4>Decision</h4>
            <p>{selectedItem.decision}</p>
          </div>
        {/if}

        {#if selectedItem.content}
          <div class="detail-section">
            <h4>Content</h4>
            <p>{selectedItem.content}</p>
          </div>
        {/if}

        {#if selectedItem.description}
          <div class="detail-section">
            <h4>Description</h4>
            <p>{selectedItem.description}</p>
          </div>
        {/if}

        <div class="detail-meta">
          {#if selectedItem.created_at}
            <span class="text-muted">Created: {new Date(selectedItem.created_at).toLocaleDateString()}</span>
          {/if}
        </div>
      {:else}
        <div class="empty">Select an item to view details</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .memory-page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .toolbar {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
    align-items: center;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
  }

  .tabs button {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    color: var(--text-secondary);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: 0.8125rem;
    transition: all var(--transition-fast);
  }

  .tabs button.active {
    background: var(--bg-elevated);
    color: var(--accent-1);
    border-color: var(--accent-1);
  }

  .toolbar .search-input {
    max-width: 300px;
    margin-left: auto;
  }

  .content-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    flex: 1;
    min-height: 0;
  }

  .list-panel {
    overflow-y: auto;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
  }

  .list-item {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .list-item:hover {
    background: var(--bg-elevated);
  }

  .list-item.selected {
    background: var(--bg-elevated);
    border-left: 3px solid var(--accent-1);
  }

  .item-title {
    font-size: 0.875rem;
    margin-bottom: 0.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .detail-panel {
    overflow-y: auto;
  }

  .detail-type {
    color: var(--text-muted);
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    margin: 0.5rem 0;
  }

  .detail-section {
    margin: 1rem 0;
  }

  .detail-section h4 {
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    margin-bottom: 0.375rem;
  }

  .detail-section p {
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .detail-meta {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-subtle);
  }

  .text-muted {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: var(--text-muted);
  }
</style>
