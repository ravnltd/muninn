/**
 * Risk Alerts — Proactive Risk Detection
 *
 * Analyzes project state to surface emerging risks:
 *   - Fragile files with recent high-velocity changes
 *   - Clusters of failing tests
 *   - Decisions with no outcome tracking
 *   - High-severity unresolved issues
 *   - Knowledge staleness (many outdated files)
 */

import type { DatabaseAdapter } from "../database/adapter";

interface RiskAlert {
  alertType: string;
  severity: "critical" | "warning" | "info";
  title: string;
  details: string;
  sourceFile?: string;
}

/** Compute risk alerts for a project */
export async function computeRiskAlerts(
  db: DatabaseAdapter,
  projectId: number,
): Promise<RiskAlert[]> {
  const alerts: RiskAlert[] = [];

  await detectFragileFileChurn(db, projectId, alerts);
  await detectStaleDecisions(db, projectId, alerts);
  await detectCriticalIssueBacklog(db, projectId, alerts);
  await detectKnowledgeStaleness(db, projectId, alerts);
  await detectLowConfidenceLearnings(db, projectId, alerts);

  return alerts;
}

/** Persist computed alerts, deduplicating against existing active alerts */
export async function persistRiskAlerts(
  db: DatabaseAdapter,
  projectId: number,
  alerts: RiskAlert[],
): Promise<number> {
  let inserted = 0;

  // Clear old dismissed alerts (older than 30 days)
  await db.run(
    `DELETE FROM risk_alerts WHERE project_id = ? AND dismissed = 1
     AND created_at < datetime('now', '-30 days')`,
    [projectId],
  ).catch(() => {});

  for (const alert of alerts) {
    // Skip if an identical active alert already exists
    const existing = await db.get<{ id: number }>(
      `SELECT id FROM risk_alerts
       WHERE project_id = ? AND alert_type = ? AND title = ? AND dismissed = 0`,
      [projectId, alert.alertType, alert.title],
    ).catch(() => null);

    if (existing) continue;

    await db.run(
      `INSERT INTO risk_alerts (project_id, alert_type, severity, title, details, source_file)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, alert.alertType, alert.severity, alert.title,
       alert.details, alert.sourceFile ?? null],
    );
    inserted++;
  }

  return inserted;
}

/** Fragile files (7+) with 3+ changes in last 7 days */
async function detectFragileFileChurn(
  db: DatabaseAdapter,
  projectId: number,
  alerts: RiskAlert[],
): Promise<void> {
  try {
    const churning = await db.all<{
      path: string;
      fragility: number;
      change_count: number;
    }>(
      `SELECT f.path, f.fragility, COUNT(gc.id) as change_count
       FROM files f
       LEFT JOIN git_commits gc ON gc.project_id = f.project_id
         AND gc.files_changed LIKE '%' || f.path || '%'
         AND gc.committed_at > datetime('now', '-7 days')
       WHERE f.project_id = ? AND f.fragility >= 7 AND f.archived_at IS NULL
       GROUP BY f.id
       HAVING change_count >= 3
       ORDER BY f.fragility DESC`,
      [projectId],
    );

    for (const file of churning) {
      alerts.push({
        alertType: "fragile_churn",
        severity: "critical",
        title: `High-fragility file ${file.path} has ${file.change_count} changes in 7 days`,
        details: `Fragility ${file.fragility}/10 with ${file.change_count} recent commits. Consider adding tests or reducing coupling.`,
        sourceFile: file.path,
      });
    }
  } catch {
    // git_commits or files table may lack expected columns
  }
}

/** Decisions older than 30 days with no outcome recorded */
async function detectStaleDecisions(
  db: DatabaseAdapter,
  projectId: number,
  alerts: RiskAlert[],
): Promise<void> {
  try {
    const stale = await db.all<{ id: number; title: string }>(
      `SELECT id, title FROM decisions
       WHERE project_id = ? AND outcome IS NULL AND archived_at IS NULL
       AND created_at < datetime('now', '-30 days')
       ORDER BY created_at ASC LIMIT 5`,
      [projectId],
    );

    if (stale.length > 0) {
      alerts.push({
        alertType: "stale_decisions",
        severity: "warning",
        title: `${stale.length} decision(s) have no outcome after 30+ days`,
        details: stale.map(d => d.title).join(", "),
      });
    }
  } catch {
    // decisions table may lack outcome column
  }
}

/** High-severity open issues piling up */
async function detectCriticalIssueBacklog(
  db: DatabaseAdapter,
  projectId: number,
  alerts: RiskAlert[],
): Promise<void> {
  try {
    const critical = await db.all<{ id: number; title: string; severity: number }>(
      `SELECT id, title, severity FROM issues
       WHERE project_id = ? AND status = 'open' AND severity >= 7
       ORDER BY severity DESC`,
      [projectId],
    );

    if (critical.length >= 3) {
      alerts.push({
        alertType: "issue_backlog",
        severity: "critical",
        title: `${critical.length} high-severity issues remain open`,
        details: critical.map(i => `[sev:${i.severity}] ${i.title}`).join("; "),
      });
    } else if (critical.length > 0) {
      alerts.push({
        alertType: "issue_backlog",
        severity: "warning",
        title: `${critical.length} high-severity issue(s) open`,
        details: critical.map(i => `[sev:${i.severity}] ${i.title}`).join("; "),
      });
    }
  } catch {
    // issues table may not exist
  }
}

/** Many files with outdated knowledge */
async function detectKnowledgeStaleness(
  db: DatabaseAdapter,
  projectId: number,
  alerts: RiskAlert[],
): Promise<void> {
  try {
    const staleCount = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM files
       WHERE project_id = ? AND archived_at IS NULL
       AND updated_at < datetime('now', '-30 days')`,
      [projectId],
    );

    const totalCount = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM files
       WHERE project_id = ? AND archived_at IS NULL`,
      [projectId],
    );

    if (staleCount && totalCount && totalCount.count > 0) {
      const ratio = staleCount.count / totalCount.count;
      if (ratio > 0.5 && staleCount.count > 10) {
        alerts.push({
          alertType: "knowledge_stale",
          severity: "warning",
          title: `${staleCount.count}/${totalCount.count} files have stale knowledge (30+ days)`,
          details: `${Math.round(ratio * 100)}% of tracked files have outdated analysis. Run reindex to refresh.`,
        });
      }
    }
  } catch {
    // files table may lack expected columns
  }
}

/** Many learnings with low confidence */
async function detectLowConfidenceLearnings(
  db: DatabaseAdapter,
  projectId: number,
  alerts: RiskAlert[],
): Promise<void> {
  try {
    const lowConf = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM learnings
       WHERE project_id = ? AND archived_at IS NULL AND confidence < 3`,
      [projectId],
    );

    if (lowConf && lowConf.count > 10) {
      alerts.push({
        alertType: "low_confidence",
        severity: "info",
        title: `${lowConf.count} learnings have low confidence (< 3)`,
        details: "Consider archiving or reinforcing these learnings to keep context clean.",
      });
    }
  } catch {
    // learnings table may lack confidence column
  }
}
