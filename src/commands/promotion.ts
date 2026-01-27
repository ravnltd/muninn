/**
 * Learning Promotion System
 *
 * Graduates stable learnings from dynamic memory to static CLAUDE.md content.
 * Learnings that prove valuable over time get promoted to always-loaded context.
 *
 * Lifecycle: Learning → Foundational → Confirmed 3x → Candidate → Promoted → CLAUDE.md
 */

import type { DatabaseAdapter } from "../database/adapter";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MUNINN_PROMOTED_START, MUNINN_PROMOTED_END } from "../templates/claude-md";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

export type PromotionStatus = "not_ready" | "candidate" | "promoted" | "demoted";

export interface PromotionCandidate {
  id: number;
  title: string;
  content: string;
  category: string;
  confidence: number;
  times_applied: number;
  times_confirmed: number;
}

export interface StaleCLAUDEContent {
  id: number;
  title: string;
  reason: "confidence_dropped" | "not_referenced";
  confidence?: number;
  last_referenced_at?: string | null;
}

// ============================================================================
// Promotion Candidates
// ============================================================================

/**
 * Get learnings that are ready for promotion to CLAUDE.md.
 *
 * Criteria:
 * - foundational = 1
 * - confidence >= 8
 * - times_confirmed >= 3 (confirmed without revision 3+ times)
 * - times_applied >= 5 (actually used 5+ times)
 * - promotion_status = 'not_ready'
 * - Not archived
 */
export async function getPromotionCandidates(
  db: DatabaseAdapter,
  projectId: number
): Promise<PromotionCandidate[]> {
  try {
    return await db.all<PromotionCandidate>(
      `SELECT id, title, content, category, confidence, times_applied, times_confirmed
       FROM learnings
       WHERE project_id = ?
         AND foundational = 1
         AND confidence >= 8
         AND COALESCE(times_confirmed, 0) >= 3
         AND times_applied >= 5
         AND COALESCE(promotion_status, 'not_ready') = 'not_ready'
         AND archived_at IS NULL
       ORDER BY confidence DESC, times_applied DESC`,
      [projectId]
    );
  } catch {
    return []; // Columns might not exist yet
  }
}

/**
 * Check if a learning meets promotion criteria.
 */
export function isPromotionReady(learning: {
  foundational?: number;
  confidence: number;
  times_confirmed?: number;
  times_applied: number;
  promotion_status?: string;
  archived_at?: string | null;
}): boolean {
  return (
    (learning.foundational ?? 0) === 1 &&
    learning.confidence >= 8 &&
    (learning.times_confirmed ?? 0) >= 3 &&
    learning.times_applied >= 5 &&
    (learning.promotion_status ?? "not_ready") === "not_ready" &&
    !learning.archived_at
  );
}

// ============================================================================
// Promote Learning
// ============================================================================

/**
 * Promote a learning to CLAUDE.md.
 */
export async function promoteLearning(
  db: DatabaseAdapter,
  projectId: number,
  id: number,
  section: string
): Promise<void> {
  const learning = await db.get<{ id: number; project_id: number; title: string }>(
    "SELECT id, project_id, title FROM learnings WHERE id = ? AND project_id = ?",
    [id, projectId]
  );

  if (!learning) {
    throw new Error(`Learning #${id} not found`);
  }

  await db.run(
    `UPDATE learnings SET
       promotion_status = 'promoted',
       promoted_at = CURRENT_TIMESTAMP,
       promoted_to_section = ?
     WHERE id = ?`,
    [section, id]
  );
}

/**
 * Demote a learning (remove from CLAUDE.md).
 */
export async function demoteLearning(
  db: DatabaseAdapter,
  projectId: number,
  id: number,
  reason: string
): Promise<void> {
  const learning = await db.get<{ id: number; project_id: number; title: string }>(
    "SELECT id, project_id, title FROM learnings WHERE id = ? AND project_id = ?",
    [id, projectId]
  );

  if (!learning) {
    throw new Error(`Learning #${id} not found`);
  }

  await db.run(
    `UPDATE learnings SET
       promotion_status = 'demoted',
       promoted_at = NULL,
       promoted_to_section = NULL
     WHERE id = ?`,
    [id]
  );

  // Log the demotion reason as an observation
  try {
    await db.run(
      `INSERT INTO observations (project_id, type, content)
       VALUES (?, 'insight', ?)`,
      [projectId, `Demoted L${id}: ${reason}`]
    );
  } catch {
    // Observations table might not exist
  }
}

// ============================================================================
// Stale Detection
// ============================================================================

/**
 * Find promoted learnings that may need review (stale).
 *
 * Criteria:
 * - Confidence dropped below 6
 * - Not referenced in 90+ days
 */
export async function getStaleCLAUDEMDContent(
  db: DatabaseAdapter,
  projectId: number
): Promise<StaleCLAUDEContent[]> {
  const stale: StaleCLAUDEContent[] = [];

  try {
    // Confidence dropped
    const lowConfidence = await db.all<{ id: number; title: string; confidence: number }>(
      `SELECT id, title, confidence FROM learnings
       WHERE project_id = ?
         AND promotion_status = 'promoted'
         AND confidence < 6`,
      [projectId]
    );

    for (const l of lowConfidence) {
      stale.push({
        id: l.id,
        title: l.title,
        reason: "confidence_dropped",
        confidence: l.confidence,
      });
    }

    // Not referenced in 90+ days
    const notReferenced = await db.all<{
      id: number;
      title: string;
      last_referenced_at: string | null;
    }>(
      `SELECT id, title, last_referenced_at FROM learnings
       WHERE project_id = ?
         AND promotion_status = 'promoted'
         AND (last_referenced_at IS NULL OR last_referenced_at < datetime('now', '-90 days'))`,
      [projectId]
    );

    for (const l of notReferenced) {
      // Avoid duplicates
      if (!stale.some((s) => s.id === l.id)) {
        stale.push({
          id: l.id,
          title: l.title,
          reason: "not_referenced",
          last_referenced_at: l.last_referenced_at,
        });
      }
    }
  } catch {
    // Columns might not exist yet
  }

  return stale;
}

// ============================================================================
// CLAUDE.md Sync
// ============================================================================

/**
 * Get all promoted learnings grouped by section.
 */
async function getPromotedLearnings(
  db: DatabaseAdapter,
  projectId: number
): Promise<Map<string, Array<{ id: number; title: string; content: string }>>> {
  const bySection = new Map<string, Array<{ id: number; title: string; content: string }>>();

  try {
    const promoted = await db.all<{
      id: number;
      title: string;
      content: string;
      promoted_to_section: string;
    }>(
      `SELECT id, title, content, COALESCE(promoted_to_section, 'General') as promoted_to_section
       FROM learnings
       WHERE project_id = ?
         AND promotion_status = 'promoted'
       ORDER BY promoted_to_section, confidence DESC, id`,
      [projectId]
    );

    for (const l of promoted) {
      const section = l.promoted_to_section;
      if (!bySection.has(section)) {
        bySection.set(section, []);
      }
      bySection.get(section)!.push({
        id: l.id,
        title: l.title,
        content: l.content,
      });
    }
  } catch {
    // Columns might not exist yet
  }

  return bySection;
}

/**
 * Generate the promoted learnings markdown section.
 */
async function generatePromotedSection(db: DatabaseAdapter, projectId: number): Promise<string> {
  const bySection = await getPromotedLearnings(db, projectId);

  if (bySection.size === 0) {
    return "";
  }

  const now = new Date().toISOString().split("T")[0];
  let md = `${MUNINN_PROMOTED_START}\n`;
  md += `## Promoted Learnings\n\n`;
  md += `*Auto-managed by muninn. Run \`muninn promote sync\` to update.*\n\n`;

  for (const [section, learnings] of bySection) {
    md += `### ${section}\n`;
    for (const l of learnings) {
      // Truncate content for readability
      const summary = l.content.length > 100 ? l.content.slice(0, 100) + "..." : l.content;
      md += `- **L${l.id}: ${l.title}** - ${summary}\n`;
    }
    md += "\n";
  }

  md += `*Last synced: ${now}*\n`;
  md += `${MUNINN_PROMOTED_END}\n`;

  return md;
}

/**
 * Sync promoted learnings to CLAUDE.md.
 */
export async function syncPromotedToCLAUDEMD(
  db: DatabaseAdapter,
  projectId: number,
  claudeMdPath: string
): Promise<boolean> {
  if (!existsSync(claudeMdPath)) {
    console.error(`❌ CLAUDE.md not found at ${claudeMdPath}`);
    return false;
  }

  const existing = readFileSync(claudeMdPath, "utf-8");
  const promotedSection = await generatePromotedSection(db, projectId);

  let updated: string;

  if (existing.includes(MUNINN_PROMOTED_START)) {
    // Replace existing promoted section
    const before = existing.split(MUNINN_PROMOTED_START)[0];
    const afterParts = existing.split(MUNINN_PROMOTED_END);
    const after = afterParts.length > 1 ? afterParts[1] : "";

    if (promotedSection) {
      updated = `${before.trimEnd()}\n\n${promotedSection}${after.trimStart()}`;
    } else {
      // No promoted learnings - remove section entirely
      updated = `${before.trimEnd()}${after.trimStart() ? "\n\n" + after.trimStart() : ""}`;
    }
  } else if (promotedSection) {
    // No existing section - append before the end
    updated = `${existing.trimEnd()}\n\n${promotedSection}`;
  } else {
    // No promoted learnings and no section - nothing to do
    return true;
  }

  if (updated !== existing) {
    writeFileSync(claudeMdPath, updated);
    return true;
  }

  return true;
}

// ============================================================================
// Mark as Candidate
// ============================================================================

/**
 * Mark a learning as a promotion candidate.
 * Called automatically when a learning meets criteria.
 */
export async function markAsCandidate(db: DatabaseAdapter, id: number): Promise<void> {
  try {
    await db.run(`UPDATE learnings SET promotion_status = 'candidate' WHERE id = ?`, [id]);
  } catch {
    // Column might not exist yet
  }
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handlePromotionCommand(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  args: string[]
): Promise<void> {
  const subCmd = args[0];
  const claudeMdPath = join(cwd, "CLAUDE.md");

  switch (subCmd) {
    case "candidates":
    case "list":
    case undefined: {
      const candidates = await getPromotionCandidates(db, projectId);

      if (candidates.length === 0) {
        console.error("No learnings ready for promotion.");
        console.error(
          "\nPromotion criteria: foundational=1, confidence>=8, confirmed 3+ times, applied 5+ times"
        );
        outputJson([]);
        return;
      }

      console.error(`\n🎓 Promotion Candidates (${candidates.length}):\n`);
      for (const c of candidates) {
        console.error(`  L${c.id}: ${c.title} [${c.category}]`);
        console.error(
          `     Confidence: ${c.confidence}/10, Applied: ${c.times_applied}x, Confirmed: ${c.times_confirmed}x`
        );
        console.error(`     ${c.content.slice(0, 60)}...`);
        console.error("");
      }

      console.error(`Run \`muninn promote <id> --to "## Section"\` to promote.`);
      outputJson(candidates);
      break;
    }

    case "sync": {
      console.error("🔄 Syncing promoted learnings to CLAUDE.md...");
      const success = await syncPromotedToCLAUDEMD(db, projectId, claudeMdPath);
      if (success) {
        console.error("✅ CLAUDE.md updated with promoted learnings.");
        outputSuccess({ synced: true });
      } else {
        console.error("❌ Failed to sync promoted learnings.");
      }
      break;
    }

    case "stale": {
      const stale = await getStaleCLAUDEMDContent(db, projectId);

      if (stale.length === 0) {
        console.error("No stale promoted content found.");
        outputJson([]);
        return;
      }

      console.error(`\n⚠️ Stale Promoted Content (${stale.length}):\n`);
      for (const s of stale) {
        const reason =
          s.reason === "confidence_dropped"
            ? `Confidence dropped to ${s.confidence}`
            : `Not referenced since ${s.last_referenced_at || "never"}`;
        console.error(`  L${s.id}: ${s.title}`);
        console.error(`     Reason: ${reason}`);
        console.error("");
      }

      console.error(`Run \`muninn promote demote <id> "reason"\` to remove.`);
      outputJson(stale);
      break;
    }

    case "demote": {
      const id = parseInt(args[1], 10);
      const reason = args.slice(2).join(" ") || "Manual demotion";

      if (!id) {
        console.error("Usage: muninn promote demote <id> [reason]");
        return;
      }

      try {
        await demoteLearning(db, projectId, id, reason);
        console.error(`✅ L${id} demoted from CLAUDE.md.`);

        // Auto-sync after demotion
        await syncPromotedToCLAUDEMD(db, projectId, claudeMdPath);
        outputSuccess({ id, status: "demoted", reason });
      } catch (error) {
        console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }

    default: {
      // Check if it's a numeric ID (promote command)
      const id = parseInt(subCmd, 10);
      if (id && !isNaN(id)) {
        // Look for --to flag
        const toIdx = args.indexOf("--to");
        const section = toIdx !== -1 ? args.slice(toIdx + 1).join(" ") : "General";

        try {
          await promoteLearning(db, projectId, id, section);
          console.error(`✅ L${id} promoted to CLAUDE.md section: ${section}`);

          // Auto-sync after promotion
          await syncPromotedToCLAUDEMD(db, projectId, claudeMdPath);
          outputSuccess({ id, status: "promoted", section });
        } catch (error) {
          console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        console.error("Usage: muninn promote <candidates|sync|stale|demote> [args]");
        console.error("       muninn promote <id> [--to section]");
        console.error("");
        console.error("Commands:");
        console.error("  candidates       List learnings ready for promotion");
        console.error("  <id> [--to sec]  Promote learning to CLAUDE.md");
        console.error("  sync             Regenerate promoted section in CLAUDE.md");
        console.error("  stale            Find stale promoted content");
        console.error("  demote <id>      Remove learning from CLAUDE.md");
      }
    }
  }
}
