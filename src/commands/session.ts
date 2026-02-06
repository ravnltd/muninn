/**
 * Session commands
 * Track work sessions with goals, outcomes, and next steps
 */

import type { DatabaseAdapter } from "../database/adapter";
import { isNativeFormat } from "../config/index.js";
import { getApiKey } from "../utils/api-keys";
import { exitWithUsage, logError, safeJsonParse } from "../utils/errors";
import { getTimeAgo, outputJson, outputSuccess } from "../utils/format";
import { parseSessionEndArgs } from "../utils/validation";
import {
  formatSession,
  formatDecision,
  formatInsight,
} from "../output/formatter.js";
import { generateInsights, listInsights } from "./insights";
import {
  getDecisionsDue,
  incrementSessionsSince,
  getFoundationalLearningsDue,
  incrementFoundationalSessionsSince,
} from "./outcomes";
import {
  autoRelateFileCorrelations,
  autoRelateSessionDecisions,
  autoRelateSessionFiles,
  autoRelateSessionIssues,
  autoRelateSessionLearnings,
  autoRelateTestFiles,
} from "./relationships";
import { assignSessionNumber } from "./temporal";

// Import from extracted modules
import { decayTemperatures, getRecentObservations } from "./temperature";
import { updateFileCorrelations } from "./correlations";
import {
  extractSessionLearnings,
  analyzeTranscript,
  getStdinContent,
  type ExtractedLearning,
  type TranscriptAnalysis,
} from "./learning-extraction";

// ============================================================================
// Session Start
// ============================================================================

export async function sessionStart(db: DatabaseAdapter, projectId: number, goal: string): Promise<number> {
  if (!goal) {
    exitWithUsage("Usage: muninn session start <goal>");
  }

  // Decay temperatures on session start
  await decayTemperatures(db, projectId);

  const result = await db.run(
    `
    INSERT INTO sessions (project_id, goal)
    VALUES (?, ?)
  `,
    [projectId, goal]
  );

  const sessionId = Number(result.lastInsertRowid);

  // Fire intelligence on session start
  await assignSessionNumber(db, projectId, sessionId);
  await incrementSessionsSince(db, projectId);
  await incrementFoundationalSessionsSince(db, projectId);
  await generateInsightsIfDue(db, projectId);

  console.error(`\n🚀 Session #${sessionId} started`);
  console.error(`   Goal: ${goal}`);
  console.error(`\n   When done, run: muninn session end ${sessionId}`);
  console.error("");

  outputSuccess({ sessionId, goal });
  return sessionId;
}

/**
 * Check if there's meaningful new data since last insight generation.
 * Signals: completed sessions, file correlation updates, new decisions.
 */
async function shouldGenerateInsights(db: DatabaseAdapter, projectId: number): Promise<boolean> {
  try {
    const last = await db.get<{ generated_at: string | null }>(
      `SELECT MAX(generated_at) as generated_at FROM insights WHERE project_id = ?`,
      [projectId]
    );

    // Never generated — bootstrap
    if (!last?.generated_at) return true;

    const since = last.generated_at;

    // 3+ completed sessions since last generation
    const sessions = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM sessions
       WHERE project_id = ? AND ended_at > ?`,
      [projectId, since]
    );
    if ((sessions?.count ?? 0) >= 3) return true;

    // 5+ correlation updates since last generation
    const correlations = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM file_correlations
       WHERE project_id = ? AND last_cochange > ?`,
      [projectId, since]
    );
    if ((correlations?.count ?? 0) >= 5) return true;

    // 2+ new decisions since last generation
    const decisions = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM decisions
       WHERE project_id = ? AND decided_at > ?`,
      [projectId, since]
    );
    if ((decisions?.count ?? 0) >= 2) return true;

    return false;
  } catch {
    return false;
  }
}

async function generateInsightsIfDue(db: DatabaseAdapter, projectId: number): Promise<void> {
  if (await shouldGenerateInsights(db, projectId)) {
    await generateInsights(db, projectId);
  }
}

// ============================================================================
// Session End
// ============================================================================

export async function sessionEnd(db: DatabaseAdapter, sessionId: number, args: string[]): Promise<void> {
  const { values } = parseSessionEndArgs(args);

  if (!sessionId) {
    exitWithUsage("Usage: muninn session end <id> [--outcome <text>] [--next <steps>] [--success 0-2]");
  }

  // Verify session exists
  const session = await db.get<{ id: number; goal: string }>(
    "SELECT id, goal FROM sessions WHERE id = ?",
    [sessionId]
  );

  if (!session) {
    console.error(`❌ Session #${sessionId} not found`);
    process.exit(1);
  }

  await db.run(
    `
    UPDATE sessions SET
      ended_at = CURRENT_TIMESTAMP,
      outcome = ?,
      files_touched = ?,
      learnings = ?,
      next_steps = ?,
      success = ?
    WHERE id = ?
  `,
    [
      values.outcome || null,
      values.files || null,
      values.learnings || null,
      values.next || null,
      values.success ?? null,
      sessionId,
    ]
  );

  console.error(`\n✅ Session #${sessionId} ended`);
  if (values.outcome) {
    console.error(`   Outcome: ${values.outcome}`);
  }
  if (values.next) {
    console.error(`   Next: ${values.next}`);
  }
  console.error("");

  outputSuccess({ sessionId });
}

// ============================================================================
// Session Last
// ============================================================================

export async function sessionLast(db: DatabaseAdapter, projectId: number): Promise<void> {
  const session = await db.get<Record<string, unknown>>(
    `
    SELECT * FROM sessions
    WHERE project_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `,
    [projectId]
  );

  if (!session) {
    console.error("No sessions found. Start one with: muninn session start <goal>");
    outputJson({ found: false });
    return;
  }

  const timeAgo = getTimeAgo(session.started_at as string);
  const isOngoing = !session.ended_at;

  console.error(`\n📋 Last Session (#${session.id}) - ${timeAgo}`);
  console.error(`   Goal: ${session.goal || "Not specified"}`);

  if (session.outcome) {
    console.error(`   Outcome: ${session.outcome}`);
  }

  if (isOngoing) {
    console.error(`   Status: IN PROGRESS`);
    console.error(`\n   End with: muninn session end ${session.id}`);
  } else {
    if (session.next_steps) {
      console.error(`   Next: ${session.next_steps}`);
    }
  }
  console.error("");

  outputJson(session);
}

// ============================================================================
// Session Count
// ============================================================================

export async function sessionCount(db: DatabaseAdapter, projectId: number): Promise<number> {
  const result = await db.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM sessions WHERE project_id = ?`,
    [projectId]
  );
  return result?.count || 0;
}

// ============================================================================
// Session List
// ============================================================================

export async function sessionList(db: DatabaseAdapter, projectId: number, limit: number = 10): Promise<void> {
  const sessions = await db.all<Record<string, unknown>>(
    `
    SELECT id, goal, outcome, started_at, ended_at, success
    FROM sessions
    WHERE project_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `,
    [projectId, limit]
  );

  if (sessions.length === 0) {
    console.error("No sessions found.");
    outputJson([]);
    return;
  }

  console.error("\n📋 Recent Sessions:\n");

  for (const s of sessions) {
    const timeAgo = getTimeAgo(s.started_at as string);
    const isOngoing = !s.ended_at;
    const successIcon = s.success === 2 ? "✅" : s.success === 1 ? "⚠️" : s.success === 0 ? "❌" : "⚪";

    console.error(`  ${successIcon} #${s.id} (${timeAgo})${isOngoing ? " [ONGOING]" : ""}`);
    console.error(`     ${(s.goal as string)?.substring(0, 60) || "No goal"}...`);
  }
  console.error("");

  outputJson(sessions);
}

// ============================================================================
// Resume from Last Session
// ============================================================================

export async function generateResume(db: DatabaseAdapter, projectId: number): Promise<string> {
  const lastSession = await db.get<Record<string, unknown>>(
    `SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1`,
    [projectId]
  );

  if (!lastSession) {
    return 'No previous sessions found. Start fresh with `muninn session start "Your goal"`';
  }

  // v4 Phase 3: Minimal session start — ~20 lines instead of ~400
  // Everything else loads on-demand via task analyzer + enrichment pipeline
  let md = await buildMinimalPrimer(db, projectId);

  const timeAgo = getTimeAgo((lastSession.ended_at || lastSession.started_at) as string);
  const isOngoing = !lastSession.ended_at;

  // Session status (1-2 lines)
  md += `# Resume Point\n\n`;
  if (isNativeFormat()) {
    md += formatSession({
      id: lastSession.id as number,
      goal: lastSession.goal as string | null,
      outcome: lastSession.outcome as string | null,
      nextSteps: lastSession.next_steps as string | null,
      timeAgo,
      isOngoing,
    });
    md += "\n\n";
  } else {
    md += `**Session #${lastSession.id}** ${timeAgo}${isOngoing ? " (ongoing)" : ""}\n`;
    md += `Goal: ${lastSession.goal || "Not specified"}\n`;
    if (lastSession.outcome) md += `Outcome: ${lastSession.outcome}\n`;
    md += "\n";
  }

  // Files modified (compact, max 5)
  if (lastSession.files_touched) {
    try {
      const files = JSON.parse(lastSession.files_touched as string) as string[];
      if (files.length > 0) {
        md += `## Files Modified\n`;
        for (const f of files.slice(0, 5)) md += `- ${f}\n`;
        if (files.length > 5) md += `- ...and ${files.length - 5} more\n`;
        md += "\n";
      }
    } catch { /* skip */ }
  }

  // Recent observations (compact, max 3)
  const recentObs = await getRecentObservations(db, projectId);
  if (recentObs.length > 0) {
    md += `## Recent Observations\n`;
    for (const obs of recentObs.slice(0, 3)) {
      md += `- [${obs.type}] ${obs.content.slice(0, 60)}\n`;
    }
    md += "\n";
  }

  // Next steps (kept — these are actionable)
  if (lastSession.next_steps) {
    md += `## Next Steps\n`;
    const nextSteps = lastSession.next_steps as string;
    const steps = nextSteps.split(/[\n•-]/).map((s) => s.trim()).filter(Boolean);
    for (const step of steps.slice(0, 3)) md += `- [ ] ${step}\n`;
    md += "\n";
  }

  // Footer
  if (isOngoing) {
    md += `---\nSession still in progress. Use \`muninn session end ${lastSession.id}\` to close it.\n`;
  } else {
    const goalPreview = ((lastSession.goal as string) || "previous work").substring(0, 40);
    md += `---\nContinue with: \`muninn session start "Continue: ${goalPreview}"\`\n`;
  }

  return md;
}

// ============================================================================
// Session Relationships
// ============================================================================

/**
 * Get session accomplishments from relationship graph
 * Uses "made", "resolved", "learned" relationship types
 */
export async function getSessionRelationships(
  db: DatabaseAdapter,
  sessionId: number
): Promise<{
  hasData: boolean;
  decisionsMade: Array<{ id: number; title: string }>;
  issuesResolved: Array<{ id: number; title: string }>;
  learningsExtracted: Array<{ id: number; title: string }>;
}> {
  const result = {
    hasData: false,
    decisionsMade: [] as Array<{ id: number; title: string }>,
    issuesResolved: [] as Array<{ id: number; title: string }>,
    learningsExtracted: [] as Array<{ id: number; title: string }>,
  };

  try {
    // Decisions made (via "made" relationship)
    result.decisionsMade = await db.all<{ id: number; title: string }>(
      `
      SELECT d.id, d.title FROM relationships r
      JOIN decisions d ON r.target_id = d.id AND r.target_type = 'decision'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'made'
    `,
      [sessionId]
    );

    // Issues resolved (via "resolved" relationship)
    result.issuesResolved = await db.all<{ id: number; title: string }>(
      `
      SELECT i.id, i.title FROM relationships r
      JOIN issues i ON r.target_id = i.id AND r.target_type = 'issue'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'resolved'
    `,
      [sessionId]
    );

    // Learnings extracted (via "learned" relationship)
    result.learningsExtracted = await db.all<{ id: number; title: string }>(
      `
      SELECT l.id, l.title FROM relationships r
      JOIN learnings l ON r.target_id = l.id AND r.target_type = 'learning'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'learned'
    `,
      [sessionId]
    );

    result.hasData =
      result.decisionsMade.length > 0 || result.issuesResolved.length > 0 || result.learningsExtracted.length > 0;
  } catch {
    // Relationships table might not exist
  }

  return result;
}

// ============================================================================
// Enhanced Session End with Auto-Learning
// ============================================================================

/**
 * End session with correlation tracking and learning extraction.
 * Supports --analyze flag to read transcript from stdin for richer extraction.
 */
export async function sessionEndEnhanced(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
  args: string[]
): Promise<{ learnings: ExtractedLearning[] }> {
  const { values } = parseSessionEndArgs(args);

  // Get session
  const session = await db.get<{ id: number; goal: string; started_at: string; files_touched: string | null }>(
    "SELECT id, goal, started_at, files_touched FROM sessions WHERE id = ?",
    [sessionId]
  );

  if (!session) {
    throw new Error(`Session #${sessionId} not found`);
  }

  const filesTouched = safeJsonParse<string[]>(session.files_touched || values.files || "[]", []);

  // If --analyze, use stdin transcript to extract structured data
  let analysisResult: TranscriptAnalysis | null = null;
  if (values.analyze) {
    const keyResult = getApiKey("anthropic");
    if (keyResult.ok) {
      const transcript = getStdinContent();
      if (transcript.length > 0) {
        const truncated = transcript.slice(-12000);
        try {
          analysisResult = await analyzeTranscript(keyResult.value, truncated, session.goal || "Unknown", filesTouched);
        } catch (error) {
          logError("analyzeTranscript", error);
        }
      }
    }
  }

  // Use analysis results, falling back to manual args
  const extractedGoal = analysisResult?.goal || null;
  const outcome = analysisResult?.outcome || values.outcome || null;
  const nextSteps = analysisResult?.nextSteps || values.next || null;

  // Update correlations
  await updateFileCorrelations(db, projectId, filesTouched);

  // Auto-create relationships between session and files touched
  if (filesTouched.length > 0) {
    await autoRelateSessionFiles(db, projectId, sessionId, filesTouched);
  }

  // Standard end update (goal only updated if extracted and original was generic)
  const finalGoal = extractedGoal && session.goal === "New session" ? extractedGoal : session.goal;
  await db.run(
    `
    UPDATE sessions SET
      ended_at = CURRENT_TIMESTAMP,
      goal = ?,
      outcome = ?,
      files_touched = ?,
      learnings = ?,
      next_steps = ?,
      success = ?
    WHERE id = ?
  `,
    [
      finalGoal,
      outcome,
      JSON.stringify(filesTouched),
      values.learnings || null,
      nextSteps,
      values.success ?? 2,
      sessionId,
    ]
  );

  // Save learnings from analysis or fall back to existing extraction
  let learnings: ExtractedLearning[] = [];
  if (analysisResult?.learnings && analysisResult.learnings.length > 0) {
    for (const learning of analysisResult.learnings) {
      if (learning.confidence >= 0.7) {
        await db.run(
          `INSERT INTO learnings (project_id, category, title, content, source, confidence)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            projectId,
            learning.category,
            learning.title,
            learning.content,
            `session:${sessionId}`,
            Math.round(learning.confidence * 10),
          ]
        );
      }
    }
    learnings = analysisResult.learnings;
  } else {
    learnings = await extractSessionLearnings(db, projectId, sessionId, {
      goal: session.goal || "",
      outcome: outcome || "",
      files: filesTouched,
      success: values.success ?? 2,
    });
  }

  // --- v4: Tool-log-based session analysis (runs in addition to above) ---
  try {
    const { analyzeSession, saveLearnings } = await import("../learning/session-analyzer");
    const toolLogLearnings = await analyzeSession(db, projectId, sessionId, session.goal || "");
    if (toolLogLearnings.length > 0) {
      await saveLearnings(db, projectId, sessionId, toolLogLearnings);
      learnings = [...learnings, ...toolLogLearnings];
    }
  } catch {
    // v4 session analyzer is best-effort
  }

  // --- v4: Error-fix mapping (link errors to their fixes) ---
  try {
    const { processSessionErrors } = await import("../learning/error-mapper");
    await processSessionErrors(db, projectId, sessionId);
  } catch {
    // v4 error-fix mapper is best-effort
  }

  // ========================================================================
  // Auto-create relationships for session entities
  // ========================================================================

  // Get session data for relationships
  const sessionData = await db.get<{
    decisions_made: string | null;
    issues_found: string | null;
    issues_resolved: string | null;
  }>(
    "SELECT decisions_made, issues_found, issues_resolved FROM sessions WHERE id = ?",
    [sessionId]
  );

  // Session → Decisions (made)
  const decisionsMade = safeJsonParse<number[]>(sessionData?.decisions_made || "[]", []);
  if (decisionsMade.length > 0) {
    await autoRelateSessionDecisions(db, sessionId, decisionsMade);
  }

  // Session → Issues (found)
  const issuesFound = safeJsonParse<number[]>(sessionData?.issues_found || "[]", []);
  if (issuesFound.length > 0) {
    await autoRelateSessionIssues(db, sessionId, issuesFound, "found");
  }

  // Session → Issues (resolved)
  const issuesResolved = safeJsonParse<number[]>(sessionData?.issues_resolved || "[]", []);
  if (issuesResolved.length > 0) {
    await autoRelateSessionIssues(db, sessionId, issuesResolved, "resolved");
  }

  // Session → Learnings (from session_learnings table)
  await autoRelateSessionLearnings(db, sessionId);

  // File ↔ File correlations (based on co-change patterns)
  await autoRelateFileCorrelations(db, projectId, 3);

  // File ↔ File test relationships
  await autoRelateTestFiles(db, projectId);

  console.error(`\n✅ Session #${sessionId} ended`);
  if (outcome) {
    console.error(`   Outcome: ${outcome}`);
  }
  console.error(`   Files: ${filesTouched.length}`);

  if (learnings.length > 0) {
    console.error(`\n💡 Extracted ${learnings.length} learning(s):`);
    for (const l of learnings) {
      const icon = l.confidence >= 0.7 ? "✓" : "○";
      console.error(`   ${icon} [${l.category}] ${l.title}`);
    }
  }

  if (nextSteps) {
    console.error(`   Next: ${nextSteps}`);
  }
  console.error("");

  return { learnings };
}

// ============================================================================
// Minimal Primer (v4 Phase 3)
// ============================================================================

/**
 * v4 Phase 3: Minimal session primer — essential state only.
 * Tools and profile available on-demand via CLAUDE.md and muninn_query.
 * Context loads automatically via task analyzer on first tool call.
 */
async function buildMinimalPrimer(db: DatabaseAdapter, projectId: number): Promise<string> {
  const native = isNativeFormat();
  let md = "";

  // Decisions due — critical, keep count + top items
  const decisionsDue = await getDecisionsDue(db, projectId);
  const newInsights = await listInsights(db, projectId, { status: "new" });
  const foundationalDue = await getFoundationalLearningsDue(db, projectId);

  const hasRequired = decisionsDue.length > 0 || newInsights.length > 0 || foundationalDue.length > 0;

  if (hasRequired) {
    md += `## Required Actions\n`;

    if (decisionsDue.length > 0) {
      md += `- ${decisionsDue.length} decision(s) due for review`;
      if (native && decisionsDue.length <= 3) {
        md += `: ${decisionsDue.map((d) => formatDecision({ id: d.id, title: d.title, sessionsSince: d.sessions_since })).join(", ")}`;
      }
      md += "\n";
    }

    if (newInsights.length > 0) {
      md += `- ${newInsights.length} new insight(s) pending`;
      if (native && newInsights.length <= 3) {
        md += `: ${newInsights.map((i) => formatInsight({ id: i.id, type: i.type, title: i.title, content: i.content })).join(", ")}`;
      }
      md += "\n";
    }

    if (foundationalDue.length > 0) {
      md += `- ${foundationalDue.length} foundational learning(s) due for review\n`;
    }

    md += "\n";
  }

  // Critical warnings: fragile hot files
  try {
    const fragileHot = await db.all<{ path: string; fragility: number }>(
      `SELECT path, fragility FROM files
       WHERE project_id = ? AND temperature = 'hot' AND fragility >= 7
       ORDER BY fragility DESC LIMIT 3`,
      [projectId]
    );
    if (fragileHot.length > 0) {
      md += `## Warnings\n`;
      md += `- Fragile hot files: ${fragileHot.map((f) => `${f.path} (frag:${f.fragility})`).join(", ")}\n\n`;
    }
  } catch { /* column might not exist */ }

  return md;
}


// ============================================================================
// Re-exports for API compatibility
// ============================================================================

export { decayTemperatures, heatEntity, getHotEntities, getRecentObservations } from "./temperature";
export {
  updateFileCorrelations,
  getCorrelatedFiles,
  getTopCorrelations,
  handleCorrelationCommand,
  type FileCorrelation,
} from "./correlations";
export {
  getActiveSessionId,
  trackFileRead,
  trackQuery,
  trackFileTouched,
  trackDecisionMade,
  trackIssueFound,
  trackIssueResolved,
} from "./session-tracking";
export { extractSessionLearnings, type ExtractedLearning, type TranscriptAnalysis } from "./learning-extraction";
