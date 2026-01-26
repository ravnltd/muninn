<script lang="ts">
  import {
    getFiles, getDecisions, getLearnings, getIssues,
    createIssue, createDecision, createLearning, resolveIssue,
    type FileInfo, type DecisionInfo, type LearningInfo, type IssueInfo,
    type CreateIssueInput, type CreateDecisionInput, type CreateLearningInput
  } from "../lib/api";

  interface Props {
    projectId: number;
    routeParams?: URLSearchParams;
  }

  let props: Props = $props();
  // Derived to track prop changes reactively
  let projectId = $derived(props.projectId);

  // Loading and error state
  let isLoading = $state(false);
  let loadError = $state<string | null>(null);

  // Modal state
  let showCreateModal = $state(false);
  let showResolveModal = $state(false);
  let isSubmitting = $state(false);
  let submitError = $state<string | null>(null);

  // Form data
  let issueForm = $state<CreateIssueInput>({ title: "", severity: 5, type: "bug" });
  let decisionForm = $state<CreateDecisionInput>({ title: "", decision: "" });
  let learningForm = $state<CreateLearningInput>({ title: "", content: "", category: "pattern" });
  let resolveResolution = $state("");

  type TabType = "files" | "decisions" | "learnings" | "issues";

  let activeTab = $state<TabType>("files");
  let typeFilter = $state<string | null>(null);
  let searchQuery = $state("");

  // Initialize from route params on mount
  $effect(() => {
    if (props.routeParams) {
      const tab = props.routeParams.get("tab");
      if (tab === "files" || tab === "decisions" || tab === "learnings" || tab === "issues") {
        activeTab = tab;
      }
      typeFilter = props.routeParams.get("type") ?? null;
    }
  });
  let searchInput = $state(""); // Raw input value for debouncing

  // Debounce search input
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchInput = value;
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = value;
    }, 300);
  }

  let files = $state<FileInfo[]>([]);
  let decisions = $state<DecisionInfo[]>([]);
  let learnings = $state<LearningInfo[]>([]);
  let issues = $state<IssueInfo[]>([]);
  let selectedItem = $state<any>(null);

  // Load data when projectId changes
  $effect(() => {
    if (projectId && typeof projectId === 'number') {
      isLoading = true;
      loadError = null;
      Promise.all([
        getFiles(projectId),
        getDecisions(projectId),
        getLearnings(projectId),
        getIssues(projectId)
      ])
        .then(([f, d, l, i]) => {
          files = f;
          decisions = d;
          learnings = l;
          issues = i;
        })
        .catch((e) => {
          loadError = e instanceof Error ? e.message : "Failed to load memory data";
        })
        .finally(() => {
          isLoading = false;
        });
    }
  });

  function filterItems<T extends { title?: string; path?: string; content?: string; type?: string }>(items: T[], applyTypeFilter = false): T[] {
    let filtered = items;

    // Apply type filter (for issues when type=tech-debt)
    if (applyTypeFilter && typeFilter) {
      filtered = filtered.filter((item) => (item as any).type === typeFilter);
    }

    // Apply search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        const text = `${(item as any).title ?? ""} ${(item as any).path ?? ""} ${(item as any).content ?? ""} ${(item as any).purpose ?? ""}`.toLowerCase();
        return text.includes(q);
      });
    }

    return filtered;
  }

  function temperatureBadge(temp: string | null): string {
    if (!temp) return "cold";
    return temp;
  }

  // Refresh data after mutations
  function refreshData() {
    if (!projectId || typeof projectId !== 'number') return;
    Promise.all([
      getFiles(projectId),
      getDecisions(projectId),
      getLearnings(projectId),
      getIssues(projectId)
    ])
      .then(([f, d, l, i]) => {
        files = f;
        decisions = d;
        learnings = l;
        issues = i;
      })
      .catch(() => {});
  }

  // Form submission handlers
  async function handleCreateIssue() {
    if (!issueForm.title.trim()) return;
    isSubmitting = true;
    submitError = null;
    try {
      await createIssue(projectId, issueForm);
      showCreateModal = false;
      issueForm = { title: "", severity: 5, type: "bug" };
      refreshData();
    } catch (e) {
      submitError = e instanceof Error ? e.message : "Failed to create issue";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleCreateDecision() {
    if (!decisionForm.title.trim() || !decisionForm.decision.trim()) return;
    isSubmitting = true;
    submitError = null;
    try {
      await createDecision(projectId, decisionForm);
      showCreateModal = false;
      decisionForm = { title: "", decision: "" };
      refreshData();
    } catch (e) {
      submitError = e instanceof Error ? e.message : "Failed to create decision";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleCreateLearning() {
    if (!learningForm.title.trim() || !learningForm.content.trim()) return;
    isSubmitting = true;
    submitError = null;
    try {
      await createLearning(projectId, learningForm);
      showCreateModal = false;
      learningForm = { title: "", content: "", category: "pattern" };
      refreshData();
    } catch (e) {
      submitError = e instanceof Error ? e.message : "Failed to create learning";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleResolveIssue() {
    if (!selectedItem || !resolveResolution.trim()) return;
    isSubmitting = true;
    submitError = null;
    try {
      await resolveIssue(projectId, selectedItem.id, resolveResolution);
      showResolveModal = false;
      resolveResolution = "";
      selectedItem = null;
      refreshData();
    } catch (e) {
      submitError = e instanceof Error ? e.message : "Failed to resolve issue";
    } finally {
      isSubmitting = false;
    }
  }

  function openCreateModal() {
    submitError = null;
    showCreateModal = true;
  }

  function closeCreateModal() {
    showCreateModal = false;
    submitError = null;
  }

  function openResolveModal() {
    resolveResolution = "";
    submitError = null;
    showResolveModal = true;
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
    {#if activeTab !== "files"}
      <button class="btn btn-primary" onclick={openCreateModal}>
        + Add {activeTab === "decisions" ? "Decision" : activeTab === "learnings" ? "Learning" : "Issue"}
      </button>
    {/if}
    <input
      class="search-input"
      type="text"
      placeholder="Search memories..."
      value={searchInput}
      oninput={handleSearchInput}
    />
  </div>

  {#if loadError}
    <div class="error-banner">
      <span>Failed to load data: {loadError}</span>
      <button class="btn" onclick={refreshData}>Retry</button>
    </div>
  {/if}

  {#if isLoading}
    <div class="loading-banner">Loading memory data...</div>
  {/if}

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
        {#each filterItems(issues as any, true) as issue (issue.id)}
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

        <!-- Resolve button for open issues -->
        {#if selectedItem.type === 'issue' && selectedItem.status === 'open'}
          <div class="detail-actions">
            <button class="btn btn-success" onclick={openResolveModal}>
              Resolve Issue
            </button>
          </div>
        {/if}
      {:else}
        <div class="empty">Select an item to view details</div>
      {/if}
    </div>
  </div>

  <!-- Create Modal -->
  {#if showCreateModal}
    <div class="modal-overlay" onclick={closeCreateModal}>
      <div class="modal card" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Add {activeTab === "decisions" ? "Decision" : activeTab === "learnings" ? "Learning" : "Issue"}</h3>
          <button class="btn" onclick={closeCreateModal}>×</button>
        </div>

        {#if submitError}
          <div class="error-message">{submitError}</div>
        {/if}

        {#if activeTab === "issues"}
          <form onsubmit={(e) => { e.preventDefault(); handleCreateIssue(); }}>
            <div class="form-group">
              <label for="issue-title">Title *</label>
              <input id="issue-title" type="text" bind:value={issueForm.title} required />
            </div>
            <div class="form-group">
              <label for="issue-desc">Description</label>
              <textarea id="issue-desc" bind:value={issueForm.description} rows="3"></textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="issue-type">Type</label>
                <select id="issue-type" bind:value={issueForm.type}>
                  <option value="bug">Bug</option>
                  <option value="tech-debt">Tech Debt</option>
                  <option value="enhancement">Enhancement</option>
                  <option value="question">Question</option>
                  <option value="potential">Potential</option>
                </select>
              </div>
              <div class="form-group">
                <label for="issue-severity">Severity (1-10)</label>
                <input id="issue-severity" type="number" min="1" max="10" bind:value={issueForm.severity} />
              </div>
            </div>
            <div class="form-group">
              <label for="issue-workaround">Workaround</label>
              <textarea id="issue-workaround" bind:value={issueForm.workaround} rows="2"></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn" onclick={closeCreateModal}>Cancel</button>
              <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Issue"}
              </button>
            </div>
          </form>

        {:else if activeTab === "decisions"}
          <form onsubmit={(e) => { e.preventDefault(); handleCreateDecision(); }}>
            <div class="form-group">
              <label for="decision-title">Title *</label>
              <input id="decision-title" type="text" bind:value={decisionForm.title} required />
            </div>
            <div class="form-group">
              <label for="decision-text">Decision *</label>
              <textarea id="decision-text" bind:value={decisionForm.decision} rows="3" required></textarea>
            </div>
            <div class="form-group">
              <label for="decision-reasoning">Reasoning</label>
              <textarea id="decision-reasoning" bind:value={decisionForm.reasoning} rows="3"></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn" onclick={closeCreateModal}>Cancel</button>
              <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Decision"}
              </button>
            </div>
          </form>

        {:else if activeTab === "learnings"}
          <form onsubmit={(e) => { e.preventDefault(); handleCreateLearning(); }}>
            <div class="form-group">
              <label for="learning-title">Title *</label>
              <input id="learning-title" type="text" bind:value={learningForm.title} required />
            </div>
            <div class="form-group">
              <label for="learning-content">Content *</label>
              <textarea id="learning-content" bind:value={learningForm.content} rows="4" required></textarea>
            </div>
            <div class="form-group">
              <label for="learning-category">Category</label>
              <select id="learning-category" bind:value={learningForm.category}>
                <option value="pattern">Pattern</option>
                <option value="gotcha">Gotcha</option>
                <option value="preference">Preference</option>
                <option value="convention">Convention</option>
                <option value="architecture">Architecture</option>
              </select>
            </div>
            <div class="form-group">
              <label for="learning-context">Context</label>
              <textarea id="learning-context" bind:value={learningForm.context} rows="2"></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn" onclick={closeCreateModal}>Cancel</button>
              <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Learning"}
              </button>
            </div>
          </form>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Resolve Modal -->
  {#if showResolveModal && selectedItem}
    <div class="modal-overlay" onclick={() => showResolveModal = false}>
      <div class="modal card" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Resolve Issue</h3>
          <button class="btn" onclick={() => showResolveModal = false}>×</button>
        </div>

        {#if submitError}
          <div class="error-message">{submitError}</div>
        {/if}

        <p class="modal-context">Resolving: <strong>{selectedItem.title}</strong></p>

        <form onsubmit={(e) => { e.preventDefault(); handleResolveIssue(); }}>
          <div class="form-group">
            <label for="resolution">Resolution *</label>
            <textarea id="resolution" bind:value={resolveResolution} rows="4" required placeholder="How was this issue resolved?"></textarea>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onclick={() => showResolveModal = false}>Cancel</button>
            <button type="submit" class="btn btn-success" disabled={isSubmitting}>
              {isSubmitting ? "Resolving..." : "Mark Resolved"}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
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

  /* Button styles */
  .btn-primary {
    background: var(--accent-1);
    color: var(--bg-deep);
    border: none;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-success {
    background: #10b981;
    color: white;
    border: none;
  }

  .btn-success:hover {
    filter: brightness(1.1);
  }

  .btn-success:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Detail actions */
  .detail-actions {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-subtle);
  }

  /* Modal styles */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    width: 100%;
    max-width: 500px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .modal-header h3 {
    margin: 0;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-subtle);
  }

  .modal-context {
    color: var(--text-secondary);
    margin-bottom: 1rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-elevated);
    border-radius: var(--radius-sm);
  }

  /* Form styles */
  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-bottom: 0.375rem;
  }

  .form-group input,
  .form-group textarea,
  .form-group select {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .form-group textarea {
    resize: vertical;
  }

  .form-group input:focus,
  .form-group textarea:focus,
  .form-group select:focus {
    outline: none;
    border-color: var(--accent-1);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .error-message {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--danger);
    color: var(--danger);
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-md);
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    color: var(--danger);
    margin-bottom: 1rem;
  }

  .loading-banner {
    padding: 0.75rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-muted);
    margin-bottom: 1rem;
    text-align: center;
  }
</style>
