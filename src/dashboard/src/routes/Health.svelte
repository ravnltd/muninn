<script lang="ts">
  import { getHealth, type HealthData } from "../lib/api";

  let { projectId }: { projectId: number } = $props();
  let health = $state<HealthData | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    if (projectId) {
      getHealth(projectId)
        .then((h) => { health = h; error = null; })
        .catch((e) => { error = e.message; });
    }
  });

  function fragilityColor(score: number): string {
    if (score >= 8) return "var(--danger)";
    if (score >= 6) return "var(--warning)";
    if (score >= 4) return "var(--accent-1)";
    return "var(--accent-4)";
  }
</script>

<div class="health-page">
  {#if error}
    <div class="card error-card">
      <p>Failed to load health data: {error}</p>
    </div>
  {:else if health}
    <div class="page-header">
      <h1>{health.project.name}</h1>
      <span class="badge badge-{health.project.mode}">{health.project.mode}</span>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-4 stats-grid">
      <div class="card stat-card">
        <div class="stat-value">{health.fileCount}</div>
        <div class="stat-label">Files</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value" style="color: {health.openIssues > 0 ? 'var(--warning)' : 'var(--accent-4)'}">{health.openIssues}</div>
        <div class="stat-label">Open Issues</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{health.activeDecisions}</div>
        <div class="stat-label">Decisions</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value" style="color: {health.techDebtScore > 50 ? 'var(--danger)' : 'var(--accent-4)'}">{health.techDebtScore}</div>
        <div class="stat-label">Debt Score</div>
      </div>
    </div>

    <!-- Fragile Files -->
    {#if health.fragileFiles.length > 0}
      <div class="card section">
        <h3>Fragile Files</h3>
        <div class="fragile-grid">
          {#each health.fragileFiles as file}
            <div class="fragile-item">
              <div class="fragile-bar" style="width: {file.fragility * 10}%; background: {fragilityColor(file.fragility)}"></div>
              <div class="fragile-info">
                <span class="mono">{file.path}</span>
                <span class="fragile-score">{file.fragility}/10</span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Recent Sessions -->
    {#if health.recentSessions.length > 0}
      <div class="card section">
        <h3>Recent Sessions</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Goal</th>
              <th>Outcome</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {#each health.recentSessions as session}
              <tr>
                <td class="mono">{session.session_number ?? session.id}</td>
                <td>{session.goal ?? "—"}</td>
                <td class="text-muted">{session.outcome ?? "—"}</td>
                <td>
                  {#if session.success === 2}
                    <span class="badge badge-hot" style="background: rgba(16, 185, 129, 0.2); color: #10b981">success</span>
                  {:else if session.success === 1}
                    <span class="badge badge-warm">partial</span>
                  {:else if session.success === 0}
                    <span class="badge badge-hot">failed</span>
                  {:else}
                    <span class="badge badge-cold">active</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else}
    <div class="loading">Loading...</div>
  {/if}
</div>

<style>
  .health-page {
    max-width: 1200px;
    margin: 0 auto;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .stats-grid {
    margin-bottom: 1.5rem;
  }

  .stat-card {
    text-align: center;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--accent-1);
    font-family: var(--font-mono);
  }

  .stat-label {
    color: var(--text-muted);
    font-size: 0.8125rem;
    margin-top: 0.25rem;
  }

  .section {
    margin-bottom: 1.5rem;
  }

  .section h3 {
    margin-bottom: 1rem;
    color: var(--text-secondary);
  }

  .fragile-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .fragile-item {
    position: relative;
    padding: 0.5rem 0.75rem;
    background: var(--bg-deep);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .fragile-bar {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    opacity: 0.15;
  }

  .fragile-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
  }

  .fragile-score {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
  }

  .text-muted {
    color: var(--text-muted);
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: var(--text-muted);
  }

  .error-card {
    border-color: var(--danger);
    color: var(--danger);
  }
</style>
