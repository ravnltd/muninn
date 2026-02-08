/**
 * Pattern Detector — Cross-session pattern analysis
 *
 * Runs every 5 sessions (via existing shouldGenerateInsights check).
 * Detects:
 * - File access sequences (A always read before editing B)
 * - Error recurrence (same signature 3+ times -> auto-create issue)
 * - Exploration waste (sessions where files_read >> files_touched)
 * - Tool usage patterns -> feed into developer_profile
 *
 * Produces insights persisted via the existing insights table.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

interface DetectedPattern {
  type: "file_sequence" | "error_recurrence" | "exploration_waste" | "tool_preference";
  title: string;
  content: string;
  evidence: string[];
  confidence: number;
}

// ============================================================================
// Pattern Detectors
// ============================================================================

/**
 * Detect files that are always read before editing another file.
 * "schema.ts read in 80% of sessions editing connection.ts"
 */
async function detectFileSequences(
  db: DatabaseAdapter,
  projectId: number,
  patterns: DetectedPattern[]
): Promise<void> {
  try {
    // Find file pairs where reading A correlates with editing B
    // Uses tool_calls to find read -> write sequences
    const sequences = await db.all<{
      read_file: string;
      write_file: string;
      occurrence_count: number;
    }>(
      `WITH read_files AS (
         SELECT DISTINCT session_id, json_each.value as file_path
         FROM tool_calls, json_each(files_involved)
         WHERE project_id = ? AND tool_name IN ('muninn_check', 'muninn_query', 'muninn_enrich')
         AND files_involved IS NOT NULL
       ),
       write_files AS (
         SELECT DISTINCT session_id, json_each.value as file_path
         FROM tool_calls, json_each(files_involved)
         WHERE project_id = ? AND tool_name IN ('muninn_file_add')
         AND files_involved IS NOT NULL
       )
       SELECT r.file_path as read_file, w.file_path as write_file, COUNT(DISTINCT r.session_id) as occurrence_count
       FROM read_files r
       JOIN write_files w ON r.session_id = w.session_id AND r.file_path != w.file_path
       GROUP BY r.file_path, w.file_path
       HAVING occurrence_count >= 5
       ORDER BY occurrence_count DESC
       LIMIT 10`,
      [projectId, projectId]
    );

    for (const seq of sequences) {
      // Skip same-directory pairs (obvious coupling)
      const dirA = seq.read_file.substring(0, seq.read_file.lastIndexOf("/"));
      const dirB = seq.write_file.substring(0, seq.write_file.lastIndexOf("/"));
      if (dirA === dirB) continue;

      patterns.push({
        type: "file_sequence",
        title: `Workflow: ${basename(seq.read_file)} before ${basename(seq.write_file)}`,
        content: `${seq.read_file} is checked in ${seq.occurrence_count} sessions before modifying ${seq.write_file}. This appears to be an established workflow.`,
        evidence: [`Observed ${seq.occurrence_count} times`],
        confidence: Math.min(0.9, 0.5 + seq.occurrence_count * 0.1),
      });
    }
  } catch {
    // tool_calls table might be empty or missing json_each support
  }
}

/**
 * Detect recurring errors (same signature 3+ times).
 * Auto-creates issues for persistent problems.
 */
async function detectErrorRecurrence(
  db: DatabaseAdapter,
  projectId: number,
  patterns: DetectedPattern[]
): Promise<void> {
  try {
    const recurring = await db.all<{
      error_signature: string;
      error_type: string;
      error_message: string;
      occurrence_count: number;
      first_seen: string;
      last_seen: string;
    }>(
      `SELECT error_signature, error_type,
              MIN(error_message) as error_message,
              COUNT(*) as occurrence_count,
              MIN(created_at) as first_seen,
              MAX(created_at) as last_seen
       FROM error_events
       WHERE project_id = ?
       GROUP BY error_signature
       HAVING occurrence_count >= 3
       ORDER BY occurrence_count DESC
       LIMIT 5`,
      [projectId]
    );

    for (const error of recurring) {
      // Check if there is already a known fix
      const hasFix = await db.get<{ id: number }>(
        `SELECT id FROM error_fix_pairs WHERE project_id = ? AND error_signature = ?`,
        [projectId, error.error_signature]
      );

      if (hasFix) continue; // Already have a fix, no need to flag

      patterns.push({
        type: "error_recurrence",
        title: `Recurring ${error.error_type}: ${error.error_message.slice(0, 50)}`,
        content: `This error has occurred ${error.occurrence_count} times (first: ${error.first_seen}, last: ${error.last_seen}) with no known fix recorded.`,
        evidence: [
          `Occurred ${error.occurrence_count} times`,
          `Type: ${error.error_type}`,
          `Signature: ${error.error_signature.slice(0, 80)}`,
        ],
        confidence: Math.min(0.9, 0.6 + error.occurrence_count * 0.05),
      });

      // Auto-create issue for persistent errors (5+ occurrences)
      if (error.occurrence_count >= 5) {
        try {
          await db.run(
            `INSERT OR IGNORE INTO issues (project_id, title, description, severity, type, status)
             VALUES (?, ?, ?, ?, 'bug', 'open')`,
            [
              projectId,
              `Recurring error: ${error.error_message.slice(0, 80)}`,
              `Auto-detected: ${error.error_type} occurred ${error.occurrence_count} times. Signature: ${error.error_signature.slice(0, 200)}`,
              Math.min(8, 5 + Math.floor(error.occurrence_count / 3)),
            ]
          );
        } catch {
          // Issue might already exist
        }
      }
    }
  } catch {
    // Tables might not exist
  }
}

/**
 * Detect exploration waste: sessions where files_read >> files_touched.
 * Suggests missing context or unclear task scope.
 */
async function detectExplorationWaste(
  db: DatabaseAdapter,
  projectId: number,
  patterns: DetectedPattern[]
): Promise<void> {
  try {
    // Get recent sessions with tool call data
    const sessions = await db.all<{
      session_id: number;
      goal: string;
      read_count: number;
      write_count: number;
    }>(
      `SELECT
         tc.session_id,
         s.goal,
         SUM(CASE WHEN tc.tool_name IN ('muninn_query', 'muninn_check', 'muninn_suggest', 'muninn_predict', 'muninn_enrich') THEN 1 ELSE 0 END) as read_count,
         SUM(CASE WHEN tc.tool_name IN ('muninn_file_add', 'muninn_decision_add', 'muninn_learn_add', 'muninn_issue') THEN 1 ELSE 0 END) as write_count
       FROM tool_calls tc
       JOIN sessions s ON tc.session_id = s.id
       WHERE tc.project_id = ? AND s.ended_at IS NOT NULL
       GROUP BY tc.session_id
       HAVING read_count > 10 AND write_count <= 1
       ORDER BY s.started_at DESC
       LIMIT 10`,
      [projectId]
    );

    if (sessions.length >= 3) {
      const avgReadCount = Math.round(sessions.reduce((s, x) => s + x.read_count, 0) / sessions.length);
      patterns.push({
        type: "exploration_waste",
        title: `${sessions.length} exploration-heavy sessions detected`,
        content: `${sessions.length} recent sessions averaged ${avgReadCount} queries but made few changes. Consider building better onboarding context or task descriptions.`,
        evidence: sessions.slice(0, 3).map((s) => `Session "${s.goal}": ${s.read_count} reads, ${s.write_count} writes`),
        confidence: Math.min(0.8, 0.4 + sessions.length * 0.05),
      });
    }
  } catch {
    // Tables might not exist
  }
}

/**
 * Detect tool usage patterns and update developer profile.
 */
async function detectToolPreferences(
  db: DatabaseAdapter,
  projectId: number,
  _patterns: DetectedPattern[]
): Promise<void> {
  try {
    // Get overall tool usage distribution
    const toolUsage = await db.all<{
      tool_name: string;
      total_calls: number;
      avg_duration: number;
    }>(
      `SELECT tool_name, COUNT(*) as total_calls, AVG(duration_ms) as avg_duration
       FROM tool_calls
       WHERE project_id = ?
       GROUP BY tool_name
       ORDER BY total_calls DESC
       LIMIT 10`,
      [projectId]
    );

    if (toolUsage.length === 0) return;

    const totalCalls = toolUsage.reduce((s, t) => s + t.total_calls, 0);

    // Find dominant tools (> 30% of all calls)
    for (const tool of toolUsage) {
      const percentage = Math.round((tool.total_calls / totalCalls) * 100);
      if (percentage >= 30) {
        // Update developer profile
        try {
          await db.run(
            `INSERT INTO developer_profile (project_id, key, value, evidence, confidence, category, source, times_confirmed)
             VALUES (?, ?, ?, ?, 0.7, 'tool_preference', 'auto_detected', 1)
             ON CONFLICT(project_id, key) DO UPDATE SET
               value = excluded.value,
               evidence = excluded.evidence,
               times_confirmed = times_confirmed + 1,
               confidence = MIN(0.95, confidence + 0.05),
               last_updated_at = datetime('now')`,
            [
              projectId,
              `preferred_tool_${tool.tool_name}`,
              `${tool.tool_name} used ${percentage}% of the time`,
              `${tool.total_calls} calls, avg ${Math.round(tool.avg_duration)}ms`,
            ]
          );
        } catch {
          // Table might not exist
        }
      }
    }
  } catch {
    // Tables might not exist
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Run all pattern detectors and return detected patterns.
 * Called by insight generation every 5 sessions.
 */
export async function detectPatterns(
  db: DatabaseAdapter,
  projectId: number
): Promise<DetectedPattern[]> {
  const patterns: DetectedPattern[] = [];

  await detectFileSequences(db, projectId, patterns);
  await detectErrorRecurrence(db, projectId, patterns);
  await detectExplorationWaste(db, projectId, patterns);
  await detectToolPreferences(db, projectId, patterns);

  return patterns;
}

/**
 * Persist detected patterns as insights.
 */
export async function persistPatternInsights(
  db: DatabaseAdapter,
  projectId: number,
  patterns: DetectedPattern[]
): Promise<number> {
  let persisted = 0;

  for (const pattern of patterns) {
    try {
      await db.run(
        `INSERT INTO insights (project_id, type, title, content, evidence, confidence)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, title) DO UPDATE SET
           content = excluded.content,
           evidence = excluded.evidence,
           confidence = excluded.confidence,
           generated_at = CURRENT_TIMESTAMP`,
        [
          projectId,
          pattern.type === "error_recurrence" ? "anomaly" : pattern.type === "exploration_waste" ? "recommendation" : "pattern",
          pattern.title,
          pattern.content,
          JSON.stringify(pattern.evidence),
          pattern.confidence,
        ]
      );
      persisted++;
    } catch {
      // Insight might already exist
    }
  }

  return persisted;
}

// ============================================================================
// Helpers
// ============================================================================

function basename(path: string): string {
  return path.split("/").pop() || path;
}
