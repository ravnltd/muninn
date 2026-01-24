<script lang="ts">
  import { getSessions, type SessionInfo } from "../lib/api";

  let { projectId }: { projectId: number } = $props();
  let sessions = $state<SessionInfo[]>([]);
  let expandedSession = $state<number | null>(null);

  $effect(() => {
    if (projectId) {
      getSessions(projectId).then((s) => sessions = s).catch(() => {});
    }
  });

  function successColor(success: number | null): string {
    if (success === 2) return "var(--accent-4)";
    if (success === 1) return "var(--warning)";
    if (success === 0) return "var(--danger)";
    return "var(--accent-1)";
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function getFilesTouched(session: SessionInfo): string[] {
    if (!session.files_touched) return [];
    try { return JSON.parse(session.files_touched); } catch { return []; }
  }
</script>

<div class="timeline-page">
  <h2>Session Timeline</h2>

  {#if sessions.length === 0}
    <div class="empty card">No sessions recorded yet.</div>
  {:else}
    <div class="timeline">
      {#each sessions as session, i (session.id)}
        <div class="timeline-item" onclick={() => expandedSession = expandedSession === session.id ? null : session.id}>
          <!-- Connector -->
          <div class="connector">
            <div class="dot" style="background: {successColor(session.success)}; box-shadow: 0 0 8px {successColor(session.success)}40"></div>
            {#if i < sessions.length - 1}
              <div class="line"></div>
            {/if}
          </div>

          <!-- Content -->
          <div class="timeline-content card" class:expanded={expandedSession === session.id}>
            <div class="session-header">
              <span class="session-number mono">#{session.session_number ?? session.id}</span>
              <span class="session-date">{formatDate(session.started_at)}</span>
              {#if session.ended_at}
                <span class="badge badge-{session.success === 2 ? 'hot' : session.success === 1 ? 'warm' : 'cold'}"
                  style="background: {successColor(session.success)}20; color: {successColor(session.success)}">
                  {session.success === 2 ? "success" : session.success === 1 ? "partial" : session.success === 0 ? "failed" : "active"}
                </span>
              {:else}
                <span class="badge badge-cold">active</span>
              {/if}
            </div>

            <div class="session-goal">
              {session.goal ?? "No goal set"}
            </div>

            {#if expandedSession === session.id}
              <div class="session-details">
                {#if session.outcome}
                  <div class="detail-row">
                    <span class="detail-label">Outcome</span>
                    <span>{session.outcome}</span>
                  </div>
                {/if}

                {#if getFilesTouched(session).length > 0}
                  <div class="detail-row">
                    <span class="detail-label">Files Touched</span>
                    <div class="file-list">
                      {#each getFilesTouched(session) as file}
                        <span class="mono file-tag">{file}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .timeline-page {
    max-width: 900px;
    margin: 0 auto;
  }

  .timeline-page h2 {
    margin-bottom: 1.5rem;
  }

  .timeline {
    display: flex;
    flex-direction: column;
  }

  .timeline-item {
    display: flex;
    gap: 1.25rem;
    cursor: pointer;
  }

  .connector {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 20px;
    flex-shrink: 0;
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    margin-top: 1.25rem;
    flex-shrink: 0;
  }

  .line {
    width: 2px;
    flex: 1;
    background: var(--border);
    margin-top: 0.25rem;
  }

  .timeline-content {
    flex: 1;
    margin-bottom: 0.75rem;
    transition: all var(--transition-normal);
  }

  .timeline-content.expanded {
    border-color: var(--accent-1);
  }

  .session-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .session-number {
    color: var(--accent-1);
    font-weight: 600;
  }

  .session-date {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .session-goal {
    color: var(--text-secondary);
    font-size: 0.9375rem;
  }

  .session-details {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .detail-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .detail-label {
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .file-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .file-tag {
    background: var(--bg-deep);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 3rem;
  }
</style>
