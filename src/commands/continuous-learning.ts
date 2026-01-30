/**
 * Continuous Learning Commands
 *
 * CLI commands for the continuous learning system:
 * - learn reinforce <id> - Manually reinforce a learning
 * - learn history <id> - Show version history of a learning
 * - conflicts list - Show unresolved learning conflicts
 * - conflicts resolve <id> - Resolve a conflict
 */

import type { DatabaseAdapter } from "../database/adapter";
import { outputJson, outputSuccess } from "../utils/format";
import { reinforceLearning } from "./outcomes";

// ============================================================================
// Types
// ============================================================================

interface LearningVersion {
  id: number;
  version: number;
  content: string;
  confidence: number | null;
  changed_at: string;
  change_reason: string | null;
}

interface LearningConflict {
  id: number;
  learning_a: number;
  learning_b: number;
  conflict_type: string;
  similarity_score: number | null;
  detected_at: string;
  learning_a_title: string;
  learning_a_content: string;
  learning_b_title: string;
  learning_b_content: string;
}

interface DecisionLearningLink {
  decision_id: number;
  decision_title: string;
  learning_id: number;
  contribution: string;
  linked_at: string;
}

export type ConflictResolution =
  | "a_supersedes"
  | "b_supersedes"
  | "both_valid_conditionally"
  | "merged"
  | "dismissed";

// ============================================================================
// Manual Reinforcement
// ============================================================================

/**
 * Manually reinforce a learning to boost confidence and reset decay
 */
export async function handleReinforceCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[]
): Promise<void> {
  const idStr = args[0];

  if (!idStr) {
    console.error("Usage: muninn learn reinforce <id>");
    console.error("");
    console.error("Manually reinforce a learning to boost confidence and reset decay timer.");
    console.error("Use this when you've confirmed a learning is still valid and useful.");
    return;
  }

  const id = parseInt(idStr, 10);
  if (Number.isNaN(id)) {
    console.error(`Invalid learning ID: ${idStr}`);
    return;
  }

  // Verify learning exists
  const learning = await db.get<{ id: number; title: string; project_id: number | null }>(
    "SELECT id, title, project_id FROM learnings WHERE id = ?",
    [id]
  );

  if (!learning) {
    console.error(`Learning #${id} not found`);
    return;
  }

  // Check project scope
  if (learning.project_id !== null && learning.project_id !== projectId) {
    console.error(`Learning #${id} belongs to a different project`);
    return;
  }

  try {
    await reinforceLearning(db, id);
    console.error(`✅ Learning L${id} reinforced: ${learning.title}`);
    console.error("   Confidence boosted, decay timer reset.");
    outputSuccess({ id, title: learning.title, action: "reinforced" });
  } catch (error) {
    console.error(`❌ Failed to reinforce learning: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================================================
// Learning History
// ============================================================================

/**
 * Show version history of a learning
 */
export async function handleHistoryCommand(
  db: DatabaseAdapter,
  _projectId: number,
  args: string[]
): Promise<void> {
  const idStr = args[0];

  if (!idStr) {
    console.error("Usage: muninn learn history <id>");
    console.error("");
    console.error("Show how a learning has evolved over time.");
    return;
  }

  const id = parseInt(idStr, 10);
  if (Number.isNaN(id)) {
    console.error(`Invalid learning ID: ${idStr}`);
    return;
  }

  // Get current learning
  const learning = await db.get<{
    id: number;
    title: string;
    content: string;
    confidence: number;
    created_at: string;
  }>("SELECT id, title, content, confidence, created_at FROM learnings WHERE id = ?", [id]);

  if (!learning) {
    console.error(`Learning #${id} not found`);
    return;
  }

  try {
    // Get version history
    const versions = await db.all<LearningVersion>(
      `SELECT id, version, content, confidence, changed_at, change_reason
       FROM learning_versions
       WHERE learning_id = ?
       ORDER BY version DESC`,
      [id]
    );

    console.error(`\n📚 History of L${id}: ${learning.title}\n`);
    console.error(`Current (v${versions.length + 1}):`);
    console.error(`  Content: ${learning.content.slice(0, 80)}...`);
    console.error(`  Confidence: ${learning.confidence}`);
    console.error("");

    if (versions.length === 0) {
      console.error("No previous versions recorded.");
      outputJson({ learning, versions: [] });
      return;
    }

    console.error("Previous versions:");
    for (const v of versions) {
      console.error(`  v${v.version} (${v.changed_at}):`);
      console.error(`    Content: ${v.content.slice(0, 60)}...`);
      console.error(`    Confidence: ${v.confidence ?? "N/A"}`);
      console.error(`    Reason: ${v.change_reason ?? "unknown"}`);
      console.error("");
    }

    outputJson({ learning, versions });
  } catch {
    console.error("Version history not available (table may not exist yet).");
    outputJson({ learning, versions: [] });
  }
}

// ============================================================================
// Conflict Management
// ============================================================================

/**
 * List unresolved learning conflicts
 */
export async function listConflicts(db: DatabaseAdapter, projectId: number): Promise<LearningConflict[]> {
  try {
    return await db.all<LearningConflict>(
      `SELECT
        lc.id,
        lc.learning_a,
        lc.learning_b,
        lc.conflict_type,
        lc.similarity_score,
        lc.detected_at,
        la.title as learning_a_title,
        la.content as learning_a_content,
        lb.title as learning_b_title,
        lb.content as learning_b_content
       FROM learning_conflicts lc
       JOIN learnings la ON lc.learning_a = la.id
       JOIN learnings lb ON lc.learning_b = lb.id
       WHERE lc.resolved_at IS NULL
         AND (la.project_id = ? OR la.project_id IS NULL)
       ORDER BY lc.detected_at DESC
       LIMIT 20`,
      [projectId]
    );
  } catch {
    return [];
  }
}

/**
 * Resolve a learning conflict
 */
export async function resolveConflict(
  db: DatabaseAdapter,
  conflictId: number,
  resolution: ConflictResolution,
  notes?: string
): Promise<void> {
  await db.run(
    `UPDATE learning_conflicts SET
      resolved_at = CURRENT_TIMESTAMP,
      resolution = ?,
      resolution_notes = ?
     WHERE id = ?`,
    [resolution, notes ?? null, conflictId]
  );
}

/**
 * Handle conflicts subcommand
 */
export async function handleConflictsCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[]
): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "list":
    case undefined: {
      const conflicts = await listConflicts(db, projectId);

      if (conflicts.length === 0) {
        console.error("✅ No unresolved learning conflicts.");
        outputJson([]);
        return;
      }

      console.error(`\n⚠️ Unresolved Learning Conflicts (${conflicts.length}):\n`);
      for (const c of conflicts) {
        console.error(`  #${c.id} [${c.conflict_type}]`);
        console.error(`    L${c.learning_a}: ${c.learning_a_title}`);
        console.error(`      "${c.learning_a_content.slice(0, 50)}..."`);
        console.error(`    vs`);
        console.error(`    L${c.learning_b}: ${c.learning_b_title}`);
        console.error(`      "${c.learning_b_content.slice(0, 50)}..."`);
        if (c.similarity_score) {
          console.error(`    Similarity: ${(c.similarity_score * 100).toFixed(1)}%`);
        }
        console.error("");
      }
      console.error("Resolve with: muninn conflicts resolve <id> <resolution> [notes]");
      console.error("Resolutions: a_supersedes, b_supersedes, both_valid_conditionally, merged, dismissed");
      outputJson(conflicts);
      break;
    }

    case "resolve": {
      const conflictId = parseInt(args[1], 10);
      const resolution = args[2] as ConflictResolution;
      const notes = args.slice(3).join(" ") || undefined;

      const validResolutions: ConflictResolution[] = [
        "a_supersedes",
        "b_supersedes",
        "both_valid_conditionally",
        "merged",
        "dismissed",
      ];

      if (!conflictId || !resolution || !validResolutions.includes(resolution)) {
        console.error("Usage: muninn conflicts resolve <id> <resolution> [notes]");
        console.error("");
        console.error("Resolutions:");
        console.error("  a_supersedes              - Learning A is correct, B should be updated/removed");
        console.error("  b_supersedes              - Learning B is correct, A should be updated/removed");
        console.error("  both_valid_conditionally  - Both are valid in different contexts");
        console.error("  merged                    - Combined into a single updated learning");
        console.error("  dismissed                 - False positive, no actual conflict");
        return;
      }

      try {
        await resolveConflict(db, conflictId, resolution, notes);
        console.error(`✅ Conflict #${conflictId} resolved: ${resolution}`);
        outputSuccess({ id: conflictId, resolution, notes });
      } catch (error) {
        console.error(`❌ Failed to resolve conflict: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }

    default:
      console.error("Usage: muninn conflicts <list|resolve> [args]");
  }
}

// ============================================================================
// Decision-Learning Linking
// ============================================================================

/**
 * Link learnings to a decision
 */
export async function linkLearningsToDecision(
  db: DatabaseAdapter,
  decisionId: number,
  learningIds: number[],
  contribution: string = "influenced"
): Promise<void> {
  for (const learningId of learningIds) {
    try {
      await db.run(
        `INSERT OR REPLACE INTO decision_learnings (decision_id, learning_id, contribution)
         VALUES (?, ?, ?)`,
        [decisionId, learningId, contribution]
      );
    } catch {
      // Table might not exist, silently ignore
    }
  }
}

/**
 * Get learnings linked to a decision
 */
export async function getDecisionLearnings(
  db: DatabaseAdapter,
  decisionId: number
): Promise<DecisionLearningLink[]> {
  try {
    return await db.all<DecisionLearningLink>(
      `SELECT
        dl.decision_id,
        d.title as decision_title,
        dl.learning_id,
        dl.contribution,
        dl.linked_at
       FROM decision_learnings dl
       JOIN decisions d ON dl.decision_id = d.id
       WHERE dl.decision_id = ?`,
      [decisionId]
    );
  } catch {
    return [];
  }
}

/**
 * Detect potential conflicts when adding a new learning
 */
export async function detectPotentialConflicts(
  db: DatabaseAdapter,
  projectId: number,
  newLearningId: number,
  newContent: string
): Promise<number> {
  let conflictsDetected = 0;

  try {
    // Simple keyword-based conflict detection
    // Look for opposite sentiment patterns
    const oppositePatterns = [
      { positive: "always", negative: "never" },
      { positive: "do", negative: "don't" },
      { positive: "should", negative: "shouldn't" },
      { positive: "must", negative: "must not" },
      { positive: "prefer", negative: "avoid" },
    ];

    const contentLower = newContent.toLowerCase();

    for (const pattern of oppositePatterns) {
      const hasPositive = contentLower.includes(pattern.positive);
      const hasNegative = contentLower.includes(pattern.negative);

      if (hasPositive || hasNegative) {
        // Search for learnings with opposite patterns on similar topics
        const searchTerm = hasPositive ? pattern.negative : pattern.positive;

        const potentialConflicts = await db.all<{ id: number; content: string }>(
          `SELECT id, content FROM learnings
           WHERE id != ?
             AND (project_id = ? OR project_id IS NULL)
             AND archived_at IS NULL
             AND content LIKE '%' || ? || '%'
           LIMIT 5`,
          [newLearningId, projectId, searchTerm]
        );

        for (const existing of potentialConflicts) {
          // Check if they're on the same topic (simple word overlap)
          const newWords = new Set(contentLower.split(/\s+/).filter((w) => w.length > 3));
          const existingWords = new Set(existing.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
          const overlap = [...newWords].filter((w) => existingWords.has(w)).length;

          if (overlap >= 2) {
            // Potential conflict - record it
            try {
              await db.run(
                `INSERT OR IGNORE INTO learning_conflicts (learning_a, learning_b, conflict_type)
                 VALUES (?, ?, 'potential')`,
                [Math.min(newLearningId, existing.id), Math.max(newLearningId, existing.id)]
              );
              conflictsDetected++;
            } catch {
              // Table might not exist
            }
          }
        }
      }
    }
  } catch {
    // Silently fail - this is a best-effort detection
  }

  return conflictsDetected;
}

// ============================================================================
// Effective Confidence Calculation
// ============================================================================

/**
 * Calculate effective confidence for a learning with decay
 */
export function calculateEffectiveConfidence(
  confidence: number,
  lastReinforcedAt: string | null,
  createdAt: string,
  decayRate: number = 0.05
): number {
  const referenceDate = lastReinforcedAt || createdAt;
  const daysSinceReinforcement =
    (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
  return Math.round(confidence * Math.exp(-decayRate * daysSinceReinforcement) * 100) / 100;
}

/**
 * Get learnings with effective confidence calculated
 */
export async function getLearningsWithEffectiveConfidence(
  db: DatabaseAdapter,
  projectId: number,
  limit: number = 20
): Promise<
  Array<{
    id: number;
    title: string;
    content: string;
    confidence: number;
    effectiveConfidence: number;
    daysSinceReinforcement: number;
    temperature: string;
  }>
> {
  try {
    const learnings = await db.all<{
      id: number;
      title: string;
      content: string;
      confidence: number;
      last_reinforced_at: string | null;
      created_at: string;
      decay_rate: number | null;
      temperature: string | null;
    }>(
      `SELECT id, title, content, confidence, last_reinforced_at, created_at, decay_rate, temperature
       FROM learnings
       WHERE (project_id = ? OR project_id IS NULL)
         AND archived_at IS NULL
       ORDER BY confidence DESC
       LIMIT ?`,
      [projectId, limit]
    );

    return learnings.map((l) => {
      const referenceDate = l.last_reinforced_at || l.created_at;
      const daysSinceReinforcement =
        (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);

      return {
        id: l.id,
        title: l.title,
        content: l.content,
        confidence: l.confidence,
        effectiveConfidence: calculateEffectiveConfidence(
          l.confidence,
          l.last_reinforced_at,
          l.created_at,
          l.decay_rate ?? 0.05
        ),
        daysSinceReinforcement: Math.round(daysSinceReinforcement * 10) / 10,
        temperature: l.temperature ?? "cold",
      };
    });
  } catch {
    // Decay columns might not exist, return without effective confidence
    const learnings = await db.all<{
      id: number;
      title: string;
      content: string;
      confidence: number;
      created_at: string;
    }>(
      `SELECT id, title, content, confidence, created_at
       FROM learnings
       WHERE (project_id = ? OR project_id IS NULL)
       ORDER BY confidence DESC
       LIMIT ?`,
      [projectId, limit]
    );

    return learnings.map((l) => ({
      id: l.id,
      title: l.title,
      content: l.content,
      confidence: l.confidence,
      effectiveConfidence: l.confidence,
      daysSinceReinforcement: 0,
      temperature: "cold",
    }));
  }
}
