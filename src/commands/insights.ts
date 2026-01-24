/**
 * Active Inference Engine
 * Generates cross-session insights by analyzing patterns in the project data.
 * Detects correlations, anomalies, recommendations, and patterns.
 */

import type { Database } from "bun:sqlite";
import { outputJson, outputSuccess } from "../utils/format";
import type { InsightType, InsightStatus } from "../types";

// ============================================================================
// Types
// ============================================================================

interface Insight {
  type: InsightType;
  title: string;
  content: string;
  evidence: string[];
  confidence: number;
}

// ============================================================================
// Generate Insights
// ============================================================================

export function generateInsights(db: Database, projectId: number): Insight[] {
  const insights: Insight[] = [];

  detectCochangePatterns(db, projectId, insights);
  detectFragilityTrends(db, projectId, insights);
  detectDecisionPatterns(db, projectId, insights);
  detectWorkflowDeviations(db, projectId, insights);
  detectScopeCreep(db, projectId, insights);

  // Persist new insights
  for (const insight of insights) {
    try {
      db.run(`
        INSERT INTO insights (project_id, type, title, content, evidence, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, title) DO UPDATE SET
          content = excluded.content,
          evidence = excluded.evidence,
          confidence = excluded.confidence,
          generated_at = CURRENT_TIMESTAMP
      `, [projectId, insight.type, insight.title, insight.content,
          JSON.stringify(insight.evidence), insight.confidence]);
    } catch {
      // Table might not exist yet
    }
  }

  return insights;
}

// ============================================================================
// Insight Generators
// ============================================================================

/**
 * Detect files that always change together (cochange_count >= 5).
 * Suggests they might need to be merged or have a shared abstraction.
 */
function detectCochangePatterns(db: Database, projectId: number, results: Insight[]): void {
  try {
    const pairs = db.query<{
      file_a: string; file_b: string; cochange_count: number;
    }, [number]>(`
      SELECT file_a, file_b, cochange_count FROM file_correlations
      WHERE project_id = ? AND cochange_count >= 5
      ORDER BY cochange_count DESC
      LIMIT 5
    `).all(projectId);

    for (const pair of pairs) {
      results.push({
        type: 'correlation',
        title: `High co-change: ${basename(pair.file_a)} + ${basename(pair.file_b)}`,
        content: `${pair.file_a} and ${pair.file_b} have changed together ${pair.cochange_count} times. Consider extracting shared logic or merging.`,
        evidence: [`Co-changed ${pair.cochange_count} times`],
        confidence: Math.min(0.9, 0.5 + (pair.cochange_count * 0.05)),
      });
    }
  } catch {
    // Table might not exist
  }
}

/**
 * Detect files with high velocity (changing too frequently).
 * May indicate instability or poor abstraction.
 */
function detectFragilityTrends(db: Database, projectId: number, results: Insight[]): void {
  try {
    const hotFiles = db.query<{
      path: string; velocity_score: number; change_count: number; fragility: number;
    }, [number]>(`
      SELECT path, COALESCE(velocity_score, 0) as velocity_score,
             COALESCE(change_count, 0) as change_count, fragility
      FROM files
      WHERE project_id = ? AND velocity_score > 0.5
      ORDER BY velocity_score DESC
      LIMIT 3
    `).all(projectId);

    for (const file of hotFiles) {
      if (file.fragility >= 7) {
        results.push({
          type: 'anomaly',
          title: `High-velocity fragile file: ${basename(file.path)}`,
          content: `${file.path} has velocity ${file.velocity_score.toFixed(2)} and fragility ${file.fragility}/10. This combination is risky.`,
          evidence: [
            `Velocity: ${file.velocity_score.toFixed(2)}`,
            `Changes: ${file.change_count}`,
            `Fragility: ${file.fragility}/10`,
          ],
          confidence: 0.8,
        });
      } else if (file.change_count >= 10) {
        results.push({
          type: 'recommendation',
          title: `Frequently changing: ${basename(file.path)}`,
          content: `${file.path} has been modified ${file.change_count} times. Consider stabilizing its interface.`,
          evidence: [`Changed ${file.change_count} times`, `Velocity: ${file.velocity_score.toFixed(2)}`],
          confidence: 0.6,
        });
      }
    }
  } catch {
    // Velocity columns might not exist
  }
}

/**
 * Detect decision outcome patterns (success/failure rates by category).
 */
function detectDecisionPatterns(db: Database, projectId: number, results: Insight[]): void {
  try {
    const outcomes = db.query<{
      outcome_status: string; count: number;
    }, [number]>(`
      SELECT outcome_status, COUNT(*) as count FROM decisions
      WHERE project_id = ? AND outcome_status != 'pending'
      GROUP BY outcome_status
    `).all(projectId);

    const total = outcomes.reduce((s, o) => s + o.count, 0);
    if (total < 3) return; // Not enough data

    const failed = outcomes.find(o => o.outcome_status === 'failed');
    const succeeded = outcomes.find(o => o.outcome_status === 'succeeded');

    if (failed && failed.count >= 2) {
      const failRate = Math.round((failed.count / total) * 100);
      results.push({
        type: 'pattern',
        title: `Decision failure rate: ${failRate}%`,
        content: `${failed.count} out of ${total} reviewed decisions failed. Review the failed decisions for common themes.`,
        evidence: outcomes.map(o => `${o.outcome_status}: ${o.count}`),
        confidence: 0.7,
      });
    }

    if (succeeded && succeeded.count >= 3) {
      const successRate = Math.round((succeeded.count / total) * 100);
      if (successRate >= 80) {
        results.push({
          type: 'pattern',
          title: `Strong decision track record: ${successRate}%`,
          content: `${succeeded.count} out of ${total} reviewed decisions succeeded. Decision-making process is working well.`,
          evidence: outcomes.map(o => `${o.outcome_status}: ${o.count}`),
          confidence: 0.8,
        });
      }
    }
  } catch {
    // outcome_status column might not exist
  }
}

/**
 * Detect departures from established workflow patterns.
 */
function detectWorkflowDeviations(db: Database, projectId: number, results: Insight[]): void {
  try {
    // Find workflows that haven't been used recently
    const stale = db.query<{
      task_type: string; approach: string; times_used: number; last_used_at: string | null;
    }, [number]>(`
      SELECT task_type, approach, times_used, last_used_at FROM workflow_patterns
      WHERE (project_id = ? OR project_id IS NULL)
        AND times_used >= 3
        AND (last_used_at IS NULL OR last_used_at < datetime('now', '-30 days'))
    `).all(projectId);

    for (const wf of stale) {
      results.push({
        type: 'recommendation',
        title: `Unused workflow: ${wf.task_type}`,
        content: `The ${wf.task_type} workflow (used ${wf.times_used}x) hasn't been applied recently. Consider if it's still relevant.`,
        evidence: [`Used ${wf.times_used} times`, `Last used: ${wf.last_used_at || 'unknown'}`],
        confidence: 0.5,
      });
    }
  } catch {
    // Table might not exist
  }
}

/**
 * Detect sessions touching many files correlating with more issues.
 */
function detectScopeCreep(db: Database, projectId: number, results: Insight[]): void {
  try {
    // Find sessions with many files and issues
    const bigSessions = db.query<{
      id: number; goal: string | null; files_touched: string | null; issues_found: string | null;
    }, [number]>(`
      SELECT id, goal, files_touched, issues_found FROM sessions
      WHERE project_id = ?
        AND ended_at IS NOT NULL
        AND files_touched IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 20
    `).all(projectId);

    let bigSessionsWithIssues = 0;
    let totalBigSessions = 0;

    for (const s of bigSessions) {
      try {
        const files = JSON.parse(s.files_touched || '[]');
        const issues = JSON.parse(s.issues_found || '[]');

        if (files.length >= 5) {
          totalBigSessions++;
          if (issues.length > 0) {
            bigSessionsWithIssues++;
          }
        }
      } catch { /* invalid JSON */ }
    }

    if (totalBigSessions >= 3 && bigSessionsWithIssues >= 2) {
      const rate = Math.round((bigSessionsWithIssues / totalBigSessions) * 100);
      results.push({
        type: 'pattern',
        title: `Scope creep risk: ${rate}% of large sessions find issues`,
        content: `Sessions touching 5+ files have a ${rate}% chance of finding new issues. Consider smaller, focused sessions.`,
        evidence: [
          `${bigSessionsWithIssues}/${totalBigSessions} large sessions found issues`,
        ],
        confidence: Math.min(0.8, 0.4 + (bigSessionsWithIssues * 0.1)),
      });
    }
  } catch {
    // Table structure might differ
  }
}

// ============================================================================
// List & Manage Insights
// ============================================================================

export function listInsights(
  db: Database,
  projectId: number,
  options?: { status?: InsightStatus; limit?: number }
): Array<{
  id: number;
  type: string;
  title: string;
  content: string;
  confidence: number;
  status: string;
  generated_at: string;
}> {
  const statusFilter = options?.status ? "AND status = ?" : "";
  const limit = options?.limit ?? 10;
  const params: (number | string)[] = [projectId];
  if (options?.status) params.push(options.status);
  params.push(String(limit));

  try {
    return db.query<{
      id: number; type: string; title: string; content: string;
      confidence: number; status: string; generated_at: string;
    }, (number | string)[]>(`
      SELECT id, type, title, content, confidence, status, generated_at
      FROM insights
      WHERE project_id = ? ${statusFilter}
      ORDER BY confidence DESC, generated_at DESC
      LIMIT ?
    `).all(...params);
  } catch {
    return [];
  }
}

export function acknowledgeInsight(db: Database, insightId: number): void {
  try {
    db.run(`
      UPDATE insights SET status = 'acknowledged', acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [insightId]);
  } catch {
    // Table might not exist
  }
}

export function dismissInsight(db: Database, insightId: number): void {
  try {
    db.run(`UPDATE insights SET status = 'dismissed' WHERE id = ?`, [insightId]);
  } catch {
    // Table might not exist
  }
}

export function applyInsight(db: Database, insightId: number): void {
  try {
    db.run(`UPDATE insights SET status = 'applied' WHERE id = ?`, [insightId]);
  } catch {
    // Table might not exist
  }
}

// ============================================================================
// Helpers
// ============================================================================

function basename(path: string): string {
  return path.split('/').pop() || path;
}

// ============================================================================
// CLI Handler
// ============================================================================

export function handleInsightsCommand(db: Database, projectId: number, args: string[]): void {
  const subCmd = args[0];

  switch (subCmd) {
    case "generate": {
      console.error("🧠 Generating insights...\n");
      const insights = generateInsights(db, projectId);

      if (insights.length === 0) {
        console.error("No new insights generated. Use the system more to build patterns.");
      } else {
        console.error(`Generated ${insights.length} insight(s):\n`);
        for (const i of insights) {
          const pct = Math.round(i.confidence * 100);
          console.error(`  [${i.type}] ${i.title} (${pct}%)`);
          console.error(`    ${i.content.slice(0, 80)}`);
          console.error("");
        }
      }
      outputJson(insights);
      break;
    }

    case "list":
    case undefined: {
      const status = args.find(a => ['new', 'acknowledged', 'dismissed', 'applied'].includes(a)) as InsightStatus | undefined;
      const insights = listInsights(db, projectId, { status });

      if (insights.length === 0) {
        console.error("No insights yet. Run `muninn insights generate` to analyze patterns.");
        outputJson([]);
        return;
      }

      console.error(`\n🧠 Insights (${insights.length}):\n`);
      for (const i of insights) {
        const pct = Math.round(i.confidence * 100);
        const statusIcon = i.status === 'new' ? '🆕' : i.status === 'acknowledged' ? '✓' : i.status === 'applied' ? '✅' : '✗';
        console.error(`  ${statusIcon} #${i.id} [${i.type}] ${i.title} (${pct}%)`);
      }
      console.error("");
      outputJson(insights);
      break;
    }

    case "ack":
    case "acknowledge": {
      const id = parseInt(args[1]);
      if (!id) {
        console.error("Usage: muninn insights ack <id>");
        return;
      }
      acknowledgeInsight(db, id);
      console.error(`✅ Insight #${id} acknowledged.`);
      outputSuccess({ id, status: 'acknowledged' });
      break;
    }

    case "dismiss": {
      const id = parseInt(args[1]);
      if (!id) {
        console.error("Usage: muninn insights dismiss <id>");
        return;
      }
      dismissInsight(db, id);
      console.error(`✗ Insight #${id} dismissed.`);
      outputSuccess({ id, status: 'dismissed' });
      break;
    }

    case "apply": {
      const id = parseInt(args[1]);
      if (!id) {
        console.error("Usage: muninn insights apply <id>");
        return;
      }
      applyInsight(db, id);
      console.error(`✅ Insight #${id} applied.`);
      outputSuccess({ id, status: 'applied' });
      break;
    }

    default:
      console.error("Usage: muninn insights <list|generate|ack|dismiss|apply> [args]");
  }
}
