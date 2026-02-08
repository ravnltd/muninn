/**
 * Active Inference Engine
 * Generates cross-session insights by analyzing patterns in the project data.
 * Detects correlations, anomalies, recommendations, and patterns.
 */

import type { DatabaseAdapter } from "../database/adapter";
import type { InsightStatus, InsightType } from "../types";
import { outputJson, outputSuccess } from "../utils/format";

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

export async function generateInsights(db: DatabaseAdapter, projectId: number): Promise<Insight[]> {
  const insights: Insight[] = [];

  await detectCochangePatterns(db, projectId, insights);
  await detectFragilityTrends(db, projectId, insights);
  await detectDecisionPatterns(db, projectId, insights);
  await detectWorkflowDeviations(db, projectId, insights);
  await detectScopeCreep(db, projectId, insights);

  // --- v4: Pattern detector from tool call analysis ---
  try {
    const { detectPatterns, persistPatternInsights } = await import("../learning/pattern-detector");
    const patterns = await detectPatterns(db, projectId);
    if (patterns.length > 0) {
      await persistPatternInsights(db, projectId, patterns);
      // Convert to Insight format for return value
      for (const p of patterns) {
        insights.push({
          type: p.type === "error_recurrence" ? "anomaly" : p.type === "exploration_waste" ? "recommendation" : "pattern",
          title: p.title,
          content: p.content,
          evidence: p.evidence,
          confidence: p.confidence,
        });
      }
    }
  } catch {
    // v4 pattern detector is best-effort
  }

  // Persist new insights
  for (const insight of insights) {
    try {
      await db.run(
        `
        INSERT INTO insights (project_id, type, title, content, evidence, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, title) DO UPDATE SET
          content = excluded.content,
          evidence = excluded.evidence,
          confidence = excluded.confidence,
          generated_at = CURRENT_TIMESTAMP
      `,
        [projectId, insight.type, insight.title, insight.content, JSON.stringify(insight.evidence), insight.confidence]
      );
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
async function detectCochangePatterns(db: DatabaseAdapter, projectId: number, results: Insight[]): Promise<void> {
  try {
    const pairs = await db.all<{
      file_a: string;
      file_b: string;
      cochange_count: number;
    }>(`
      SELECT file_a, file_b, cochange_count FROM file_correlations
      WHERE project_id = ? AND cochange_count >= 8
      ORDER BY cochange_count DESC
      LIMIT 10
    `, [projectId]);

    for (const pair of pairs) {
      // Skip same-directory pairs (obvious coupling, not actionable)
      const dirA = pair.file_a.substring(0, pair.file_a.lastIndexOf("/"));
      const dirB = pair.file_b.substring(0, pair.file_b.lastIndexOf("/"));
      if (dirA === dirB) continue;

      results.push({
        type: "correlation",
        title: `High co-change: ${basename(pair.file_a)} + ${basename(pair.file_b)}`,
        content: `${pair.file_a} and ${pair.file_b} have changed together ${pair.cochange_count} times. Consider extracting shared logic or merging.`,
        evidence: [`Co-changed ${pair.cochange_count} times`],
        confidence: Math.min(0.9, 0.5 + pair.cochange_count * 0.05),
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
async function detectFragilityTrends(db: DatabaseAdapter, projectId: number, results: Insight[]): Promise<void> {
  try {
    const hotFiles = await db.all<{
      path: string;
      velocity_score: number;
      change_count: number;
      fragility: number;
    }>(`
      SELECT path, COALESCE(velocity_score, 0) as velocity_score,
             COALESCE(change_count, 0) as change_count, fragility
      FROM files
      WHERE project_id = ? AND velocity_score > 0.5
      ORDER BY velocity_score DESC
      LIMIT 3
    `, [projectId]);

    for (const file of hotFiles) {
      if (file.fragility >= 7) {
        results.push({
          type: "anomaly",
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
          type: "recommendation",
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
async function detectDecisionPatterns(db: DatabaseAdapter, projectId: number, results: Insight[]): Promise<void> {
  try {
    const outcomes = await db.all<{
      outcome_status: string;
      count: number;
    }>(`
      SELECT outcome_status, COUNT(*) as count FROM decisions
      WHERE project_id = ? AND outcome_status != 'pending'
      GROUP BY outcome_status
    `, [projectId]);

    const total = outcomes.reduce((s, o) => s + o.count, 0);
    if (total < 3) return; // Not enough data

    const failed = outcomes.find((o) => o.outcome_status === "failed");
    const succeeded = outcomes.find((o) => o.outcome_status === "succeeded");

    if (failed && failed.count >= 2) {
      const failRate = Math.round((failed.count / total) * 100);
      results.push({
        type: "pattern",
        title: `Decision failure rate: ${failRate}%`,
        content: `${failed.count} out of ${total} reviewed decisions failed. Review the failed decisions for common themes.`,
        evidence: outcomes.map((o) => `${o.outcome_status}: ${o.count}`),
        confidence: 0.7,
      });
    }

    if (succeeded && succeeded.count >= 3) {
      const successRate = Math.round((succeeded.count / total) * 100);
      if (successRate >= 80) {
        results.push({
          type: "pattern",
          title: `Strong decision track record: ${successRate}%`,
          content: `${succeeded.count} out of ${total} reviewed decisions succeeded. Decision-making process is working well.`,
          evidence: outcomes.map((o) => `${o.outcome_status}: ${o.count}`),
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
async function detectWorkflowDeviations(db: DatabaseAdapter, projectId: number, results: Insight[]): Promise<void> {
  try {
    // Find workflows that haven't been used recently
    const stale = await db.all<{
      task_type: string;
      approach: string;
      times_used: number;
      last_used_at: string | null;
    }>(`
      SELECT task_type, approach, times_used, last_used_at FROM workflow_patterns
      WHERE (project_id = ? OR project_id IS NULL)
        AND times_used >= 3
        AND (last_used_at IS NULL OR last_used_at < datetime('now', '-30 days'))
    `, [projectId]);

    for (const wf of stale) {
      results.push({
        type: "recommendation",
        title: `Unused workflow: ${wf.task_type}`,
        content: `The ${wf.task_type} workflow (used ${wf.times_used}x) hasn't been applied recently. Consider if it's still relevant.`,
        evidence: [`Used ${wf.times_used} times`, `Last used: ${wf.last_used_at || "unknown"}`],
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
async function detectScopeCreep(db: DatabaseAdapter, projectId: number, results: Insight[]): Promise<void> {
  try {
    // Find sessions with many files and issues
    const bigSessions = await db.all<{
      id: number;
      goal: string | null;
      files_touched: string | null;
      issues_found: string | null;
    }>(`
      SELECT id, goal, files_touched, issues_found FROM sessions
      WHERE project_id = ?
        AND ended_at IS NOT NULL
        AND files_touched IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 20
    `, [projectId]);

    let bigSessionsWithIssues = 0;
    let totalBigSessions = 0;

    for (const s of bigSessions) {
      try {
        const files = JSON.parse(s.files_touched || "[]");
        const issues = JSON.parse(s.issues_found || "[]");

        if (files.length >= 5) {
          totalBigSessions++;
          if (issues.length > 0) {
            bigSessionsWithIssues++;
          }
        }
      } catch {
        /* invalid JSON */
      }
    }

    if (totalBigSessions >= 3 && bigSessionsWithIssues >= 2) {
      const rate = Math.round((bigSessionsWithIssues / totalBigSessions) * 100);
      results.push({
        type: "pattern",
        title: `Scope creep risk: ${rate}% of large sessions find issues`,
        content: `Sessions touching 5+ files have a ${rate}% chance of finding new issues. Consider smaller, focused sessions.`,
        evidence: [`${bigSessionsWithIssues}/${totalBigSessions} large sessions found issues`],
        confidence: Math.min(0.8, 0.4 + bigSessionsWithIssues * 0.1),
      });
    }
  } catch {
    // Table structure might differ
  }
}

// ============================================================================
// List & Manage Insights
// ============================================================================

export async function listInsights(
  db: DatabaseAdapter,
  projectId: number,
  options?: { status?: InsightStatus; limit?: number }
): Promise<Array<{
  id: number;
  type: string;
  title: string;
  content: string;
  confidence: number;
  status: string;
  generated_at: string;
}>> {
  const statusFilter = options?.status ? "AND status = ?" : "";
  const limit = options?.limit ?? 10;
  const params: (number | string)[] = [projectId];
  if (options?.status) params.push(options.status);
  params.push(String(limit));

  try {
    return await db.all<{
      id: number;
      type: string;
      title: string;
      content: string;
      confidence: number;
      status: string;
      generated_at: string;
    }>(`
      SELECT id, type, title, content, confidence, status, generated_at
      FROM insights
      WHERE project_id = ? ${statusFilter}
      ORDER BY confidence DESC, generated_at DESC
      LIMIT ?
    `, params);
  } catch {
    return [];
  }
}

export async function acknowledgeInsight(db: DatabaseAdapter, insightId: number): Promise<void> {
  try {
    await db.run(
      `
      UPDATE insights SET status = 'acknowledged', acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [insightId]
    );
  } catch {
    // Table might not exist
  }
}

export async function dismissInsight(db: DatabaseAdapter, insightId: number): Promise<void> {
  try {
    await db.run(`UPDATE insights SET status = 'dismissed' WHERE id = ?`, [insightId]);
  } catch {
    // Table might not exist
  }
}

export async function applyInsight(db: DatabaseAdapter, insightId: number): Promise<void> {
  try {
    await db.run(`UPDATE insights SET status = 'applied' WHERE id = ?`, [insightId]);
  } catch {
    // Table might not exist
  }
}

/**
 * Increment shown_count for an insight (called on session start).
 * Auto-dismisses if shown >= 5 times without action.
 */
export async function incrementInsightShown(db: DatabaseAdapter, insightId: number): Promise<void> {
  try {
    // Increment shown_count
    await db.run(
      `
      UPDATE insights SET shown_count = COALESCE(shown_count, 0) + 1
      WHERE id = ? AND status = 'new'
    `,
      [insightId]
    );

    // Auto-dismiss if shown >= 5 times
    await db.run(
      `
      UPDATE insights SET
        status = 'dismissed',
        acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'new' AND shown_count >= 5
    `,
      [insightId]
    );
  } catch {
    // Column might not exist yet
  }
}

// ============================================================================
// Helpers
// ============================================================================

function basename(path: string): string {
  return path.split("/").pop() || path;
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleInsightsCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "generate": {
      console.error("🧠 Generating insights...\n");
      const insights = await generateInsights(db, projectId);

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
      const status = args.find((a) => ["new", "acknowledged", "dismissed", "applied"].includes(a)) as
        | InsightStatus
        | undefined;
      const insights = await listInsights(db, projectId, { status });

      if (insights.length === 0) {
        console.error("No insights yet. Run `muninn insights generate` to analyze patterns.");
        outputJson([]);
        return;
      }

      console.error(`\n🧠 Insights (${insights.length}):\n`);
      for (const i of insights) {
        const pct = Math.round(i.confidence * 100);
        const statusIcon =
          i.status === "new" ? "🆕" : i.status === "acknowledged" ? "✓" : i.status === "applied" ? "✅" : "✗";
        console.error(`  ${statusIcon} #${i.id} [${i.type}] ${i.title} (${pct}%)`);
      }
      console.error("");
      outputJson(insights);
      break;
    }

    case "ack":
    case "acknowledge": {
      const id = parseInt(args[1], 10);
      if (!id) {
        console.error("Usage: muninn insights ack <id>");
        return;
      }
      await acknowledgeInsight(db, id);
      console.error(`✅ Insight #${id} acknowledged.`);
      outputSuccess({ id, status: "acknowledged" });
      break;
    }

    case "dismiss": {
      const id = parseInt(args[1], 10);
      if (!id) {
        console.error("Usage: muninn insights dismiss <id>");
        return;
      }
      await dismissInsight(db, id);
      console.error(`✗ Insight #${id} dismissed.`);
      outputSuccess({ id, status: "dismissed" });
      break;
    }

    case "apply": {
      const id = parseInt(args[1], 10);
      if (!id) {
        console.error("Usage: muninn insights apply <id>");
        return;
      }
      await applyInsight(db, id);
      console.error(`✅ Insight #${id} applied.`);
      outputSuccess({ id, status: "applied" });
      break;
    }

    case "shown": {
      const id = parseInt(args[1], 10);
      if (!id) {
        console.error("Usage: muninn insights shown <id>");
        return;
      }
      await incrementInsightShown(db, id);
      outputSuccess({ id, action: "shown_incremented" });
      break;
    }

    case "batch-dismiss": {
      // Format: muninn insights batch-dismiss 656 998 944 724
      const ids = args.slice(1).map(Number).filter(Boolean);
      if (ids.length === 0) {
        console.error("Usage: muninn insights batch-dismiss <id> [id ...]");
        return;
      }
      for (const id of ids) {
        await dismissInsight(db, id);
      }
      console.error(`Dismissed ${ids.length} insight(s): ${ids.join(", ")}`);
      outputJson(ids.map((id) => ({ id, status: "dismissed" })));
      break;
    }

    case "batch-ack": {
      // Format: muninn insights batch-ack 28 135
      const ids = args.slice(1).map(Number).filter(Boolean);
      if (ids.length === 0) {
        console.error("Usage: muninn insights batch-ack <id> [id ...]");
        return;
      }
      for (const id of ids) {
        await acknowledgeInsight(db, id);
      }
      console.error(`Acknowledged ${ids.length} insight(s): ${ids.join(", ")}`);
      outputJson(ids.map((id) => ({ id, status: "acknowledged" })));
      break;
    }

    default:
      console.error("Usage: muninn insights <list|generate|ack|dismiss|apply|shown|batch-dismiss|batch-ack> [args]");
  }
}
