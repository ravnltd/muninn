/**
 * Learning Graduation Pipeline
 *
 * Promotes or archives learnings based on usage and confidence:
 *   draft -> validated -> established -> foundational
 *   draft -> archived (if unused after 20 sessions)
 *
 * Runs as part of the reinforce_learnings background job.
 */

import type { DatabaseAdapter } from "../database/adapter.js";

// ============================================================================
// Types
// ============================================================================

type LearningStage = "draft" | "validated" | "established" | "foundational" | "archived";

interface GraduationResult {
  learningId: number;
  title: string;
  oldStage: LearningStage;
  newStage: LearningStage;
  reason: string;
}

interface LearningRow {
  id: number;
  title: string;
  stage: string | null;
  times_applied: number;
  confidence: number;
  created_at: string;
}

// ============================================================================
// Promotion Rules
// ============================================================================

interface PromotionRule {
  from: LearningStage;
  to: LearningStage;
  check: (row: LearningRow) => boolean;
  reason: string;
}

const PROMOTION_RULES: PromotionRule[] = [
  {
    from: "draft",
    to: "validated",
    check: (r) => r.times_applied >= 2 && r.confidence >= 5,
    reason: "Applied 2+ times with confidence >= 5",
  },
  {
    from: "validated",
    to: "established",
    check: (r) => r.times_applied >= 5 && r.confidence >= 7,
    reason: "Applied 5+ times with confidence >= 7",
  },
  {
    from: "established",
    to: "foundational",
    check: (r) => r.times_applied >= 10 && r.confidence >= 9,
    reason: "Applied 10+ times with confidence >= 9",
  },
];

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Run graduation rules: promote or archive learnings based on usage.
 */
export async function graduateLearnings(
  db: DatabaseAdapter,
  projectId: number,
): Promise<GraduationResult[]> {
  const results: GraduationResult[] = [];

  try {
    // Promote learnings through stages
    const promotions = await promoteLearnings(db, projectId);
    results.push(...promotions);

    // Archive stale drafts
    const archived = await archiveStaleDrafts(db, projectId);
    results.push(...archived);
  } catch {
    // Best-effort — stage column might not exist yet
  }

  return results;
}

// ============================================================================
// Promotion
// ============================================================================

async function promoteLearnings(
  db: DatabaseAdapter,
  projectId: number,
): Promise<GraduationResult[]> {
  const results: GraduationResult[] = [];

  for (const rule of PROMOTION_RULES) {
    const candidates = await db.all<LearningRow>(
      `SELECT id, title, stage, times_applied, confidence, created_at
       FROM learnings
       WHERE (project_id = ? OR project_id IS NULL)
       AND COALESCE(stage, 'validated') = ?
       AND archived_at IS NULL
       LIMIT 50`,
      [projectId, rule.from],
    );

    for (const row of candidates) {
      if (!rule.check(row)) continue;

      await db.run(
        `UPDATE learnings SET stage = ?, updated_at = datetime('now') WHERE id = ?`,
        [rule.to, row.id],
      );

      results.push({
        learningId: row.id,
        title: row.title,
        oldStage: rule.from,
        newStage: rule.to,
        reason: rule.reason,
      });
    }
  }

  return results;
}

// ============================================================================
// Archival
// ============================================================================

async function archiveStaleDrafts(
  db: DatabaseAdapter,
  projectId: number,
): Promise<GraduationResult[]> {
  const results: GraduationResult[] = [];

  // Count total sessions to determine age
  const sessionCount = await db.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM sessions WHERE project_id = ?`,
    [projectId],
  );
  const totalSessions = sessionCount?.cnt ?? 0;

  // Find drafts that are old enough and never applied
  const staleDrafts = await db.all<LearningRow>(
    `SELECT id, title, stage, times_applied, confidence, created_at
     FROM learnings
     WHERE (project_id = ? OR project_id IS NULL)
     AND COALESCE(stage, 'validated') = 'draft'
     AND times_applied = 0
     AND archived_at IS NULL
     AND created_at < datetime('now', '-60 days')
     LIMIT 20`,
    [projectId],
  );

  // Also archive if 20+ sessions have passed (approximate via date)
  if (totalSessions < 20) return results;

  for (const row of staleDrafts) {
    await db.run(
      `UPDATE learnings SET stage = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [row.id],
    );

    results.push({
      learningId: row.id,
      title: row.title,
      oldStage: "draft",
      newStage: "archived",
      reason: "Unused draft after 20+ sessions",
    });
  }

  return results;
}
