/**
 * PR Review Learner — Extract patterns from code review feedback
 *
 * Categorizes review comments into: coding_standard, bug_fix, architecture, style.
 * Recurring patterns (3+ times) auto-promote to team learning.
 *
 * Can ingest from: git notes, PR descriptions, or manual input.
 * Runs in background worker — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export type ReviewCategory = "coding_standard" | "bug_fix" | "architecture" | "style" | "performance" | "security";

export interface ReviewExtract {
  prNumber: number | null;
  category: ReviewCategory;
  pattern: string;
  example: string | null;
  reviewer: string | null;
}

// ============================================================================
// Pattern Categorization
// ============================================================================

const CATEGORY_KEYWORDS: Record<ReviewCategory, string[]> = {
  coding_standard: ["naming", "convention", "format", "lint", "style guide", "consistent"],
  bug_fix: ["bug", "fix", "error", "crash", "null", "undefined", "race condition", "memory leak"],
  architecture: ["refactor", "abstract", "pattern", "separation", "coupling", "cohesion", "module"],
  style: ["readability", "clean", "simplify", "extract", "rename", "comment"],
  performance: ["performance", "slow", "optimize", "cache", "batch", "lazy", "eager"],
  security: ["security", "injection", "xss", "csrf", "auth", "sanitize", "validate", "escape"],
};

/** Categorize a review comment based on keyword matching */
export function categorizeReview(content: string): ReviewCategory {
  const lower = content.toLowerCase();
  let bestCategory: ReviewCategory = "style";
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [ReviewCategory, string[]][]) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

/** Extract a concise pattern from a review comment */
export function extractPattern(content: string): string {
  // Take first sentence or first 150 chars
  const firstSentence = content.match(/^[^.!?]+[.!?]/);
  if (firstSentence && firstSentence[0].length <= 150) {
    return firstSentence[0].trim();
  }
  return content.slice(0, 150).trim();
}

// ============================================================================
// Ingestion
// ============================================================================

/**
 * Ingest a review comment and extract pattern.
 */
export async function ingestReview(
  db: DatabaseAdapter,
  projectId: number,
  review: ReviewExtract
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO pr_review_extracts (project_id, pr_number, review_category, pattern, example, reviewer, occurrence_count)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(project_id, review_category, pattern) DO UPDATE SET
         occurrence_count = occurrence_count + 1,
         example = COALESCE(excluded.example, pr_review_extracts.example)`,
      [projectId, review.prNumber, review.category, review.pattern, review.example, review.reviewer]
    );
  } catch {
    // Table might not exist
  }
}

/**
 * Ingest multiple review comments from a PR.
 */
export async function ingestPRReviews(
  db: DatabaseAdapter,
  projectId: number,
  prNumber: number,
  comments: string[],
  reviewer: string | null
): Promise<number> {
  let ingested = 0;

  for (const comment of comments) {
    if (comment.length < 20) continue; // Skip short comments

    const category = categorizeReview(comment);
    const pattern = extractPattern(comment);

    await ingestReview(db, projectId, {
      prNumber,
      category,
      pattern,
      example: comment.slice(0, 500),
      reviewer,
    });
    ingested++;
  }

  return ingested;
}

// ============================================================================
// Pattern Promotion
// ============================================================================

/**
 * Promote recurring review patterns (3+ occurrences) to team learnings.
 */
export async function promoteRecurringPatterns(
  db: DatabaseAdapter,
  projectId: number
): Promise<number> {
  let promoted = 0;

  try {
    const recurring = await db.all<{
      id: number;
      review_category: string;
      pattern: string;
      example: string | null;
      occurrence_count: number;
    }>(
      `SELECT id, review_category, pattern, example, occurrence_count
       FROM pr_review_extracts
       WHERE project_id = ? AND occurrence_count >= 3 AND promoted_to_learning = 0
       ORDER BY occurrence_count DESC
       LIMIT 10`,
      [projectId]
    );

    for (const pattern of recurring) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO team_learnings (project_id, title, content, category, confidence, is_global)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            projectId,
            `Review pattern: ${pattern.pattern.slice(0, 80)}`,
            `${pattern.pattern}${pattern.example ? ` Example: ${pattern.example.slice(0, 200)}` : ""}`,
            pattern.review_category,
            Math.min(0.9, 0.5 + pattern.occurrence_count * 0.1),
            pattern.review_category === "security" || pattern.review_category === "coding_standard" ? 1 : 0,
          ]
        );

        await db.run(
          `UPDATE pr_review_extracts SET promoted_to_learning = 1 WHERE id = ?`,
          [pattern.id]
        );
        promoted++;
      } catch {
        // Might already exist
      }
    }
  } catch {
    // Tables might not exist
  }

  return promoted;
}

/**
 * Get review patterns by category.
 */
export async function getReviewPatterns(
  db: DatabaseAdapter,
  projectId: number,
  category?: ReviewCategory,
  limit: number = 10
): Promise<Array<{
  category: string;
  pattern: string;
  occurrences: number;
  promoted: boolean;
}>> {
  try {
    const query = category
      ? `SELECT review_category, pattern, occurrence_count, promoted_to_learning
         FROM pr_review_extracts WHERE project_id = ? AND review_category = ?
         ORDER BY occurrence_count DESC LIMIT ?`
      : `SELECT review_category, pattern, occurrence_count, promoted_to_learning
         FROM pr_review_extracts WHERE project_id = ?
         ORDER BY occurrence_count DESC LIMIT ?`;

    const params = category ? [projectId, category, limit] : [projectId, limit];

    const rows = await db.all<{
      review_category: string;
      pattern: string;
      occurrence_count: number;
      promoted_to_learning: number;
    }>(query, params);

    return rows.map((r) => ({
      category: r.review_category,
      pattern: r.pattern,
      occurrences: r.occurrence_count,
      promoted: r.promoted_to_learning === 1,
    }));
  } catch {
    return [];
  }
}
