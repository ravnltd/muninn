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
  formatProfile,
  formatDecision,
  formatInsight,
  formatHotContext,
} from "../output/formatter.js";
import { generateInsights, listInsights } from "./insights";
import {
  getDecisionsDue,
  incrementSessionsSince,
  getFoundationalLearningsDue,
  incrementFoundationalSessionsSince,
} from "./outcomes";
import { getPromotionCandidates } from "./promotion";
import { getTopProfileEntries } from "./profile";
import { getOpenQuestionsForResume } from "./questions";
import {
  autoRelateFileCorrelations,
  autoRelateSessionDecisions,
  autoRelateSessionFiles,
  autoRelateSessionIssues,
  autoRelateSessionLearnings,
  autoRelateTestFiles,
} from "./relationships";
import { assignSessionNumber, detectAnomalies } from "./temporal";

// Import from extracted modules
import { decayTemperatures, getHotEntities, getRecentObservations } from "./temperature";
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
    `
    SELECT * FROM sessions
    WHERE project_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `,
    [projectId]
  );

  if (!lastSession) {
    return 'No previous sessions found. Start fresh with `muninn session start "Your goal"`';
  }

  // Build system primer section
  let md = await buildSystemPrimer(db, projectId);

  const timeAgo = getTimeAgo((lastSession.ended_at || lastSession.started_at) as string);
  const isOngoing = !lastSession.ended_at;

  if (isNativeFormat()) {
    // Native format: dense session info
    md += `# Resume Point\n\n`;
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
    // Human format: prose
    md += `# Resume Point\n\n`;
    md += `**Last session:** ${timeAgo}${isOngoing ? " (still ongoing)" : ""}\n`;
    md += `**Goal:** ${lastSession.goal || "Not specified"}\n`;

    if (lastSession.outcome) {
      md += `**Outcome:** ${lastSession.outcome}\n`;
    }

    md += "\n";
  }

  if (lastSession.files_touched) {
    try {
      const files = JSON.parse(lastSession.files_touched as string);
      if (files.length > 0) {
        md += `## Files Modified\n`;
        for (const f of files) {
          md += `- ${f}\n`;
        }
        md += "\n";
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  if (lastSession.files_read) {
    try {
      const files = JSON.parse(lastSession.files_read as string);
      if (files.length > 0) {
        md += `## Files Read\n`;
        for (const f of files.slice(0, 10)) {
          md += `- ${f}\n`;
        }
        if (files.length > 10) {
          md += `- ...and ${files.length - 10} more\n`;
        }
        md += "\n";
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  if (lastSession.queries_made) {
    try {
      const queries = JSON.parse(lastSession.queries_made as string);
      if (queries.length > 0) {
        md += `## Queries Made\n`;
        for (const q of queries.slice(0, 5)) {
          md += `- "${q}"\n`;
        }
        if (queries.length > 5) {
          md += `- ...and ${queries.length - 5} more\n`;
        }
        md += "\n";
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  if (lastSession.next_steps) {
    md += `## Next Steps\n`;
    // Parse next_steps as a checklist if it contains bullet points
    const nextSteps = lastSession.next_steps as string;
    if (nextSteps.includes("\n") || nextSteps.includes("-")) {
      const steps = nextSteps
        .split(/[\n•-]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const step of steps) {
        md += `- [ ] ${step}\n`;
      }
    } else {
      md += `- [ ] ${nextSteps}\n`;
    }
    md += "\n";
  }

  if (lastSession.learnings) {
    md += `## Learnings from Session\n`;
    md += `${lastSession.learnings}\n\n`;
  }

  // Add context about issues found/resolved
  if (lastSession.issues_found || lastSession.issues_resolved) {
    const found = safeJsonParse<number[]>(lastSession.issues_found as string, []);
    const resolved = safeJsonParse<number[]>(lastSession.issues_resolved as string, []);

    if (found.length > 0 || resolved.length > 0) {
      md += `## Issues\n`;
      if (found.length > 0) {
        md += `- Found: ${found.map((id) => `#${id}`).join(", ")}\n`;
      }
      if (resolved.length > 0) {
        md += `- Resolved: ${resolved.map((id) => `#${id}`).join(", ")}\n`;
      }
      md += "\n";
    }
  }

  // Session accomplishments from relationship graph (more reliable than JSON fields)
  const sessionRelationships = await getSessionRelationships(db, Number(lastSession.id));
  if (sessionRelationships.hasData) {
    md += `## Session Accomplishments\n`;
    if (sessionRelationships.decisionsMade.length > 0) {
      md += `**Decisions:** ${sessionRelationships.decisionsMade.map((d) => `D${d.id} (${d.title})`).join(", ")}\n`;
    }
    if (sessionRelationships.issuesResolved.length > 0) {
      md += `**Resolved:** ${sessionRelationships.issuesResolved.map((i) => `#${i.id}`).join(", ")}\n`;
    }
    if (sessionRelationships.learningsExtracted.length > 0) {
      md += `**Learned:** ${sessionRelationships.learningsExtracted.map((l) => l.title.slice(0, 40)).join(", ")}\n`;
    }
    md += "\n";
  }

  // Hot entities (actively in-flight context)
  const hotEntities = await getHotEntities(db, projectId);
  const hasHot = hotEntities.files.length > 0 || hotEntities.decisions.length > 0 || hotEntities.learnings.length > 0;

  if (hasHot) {
    md += `## Hot Context\n`;
    if (isNativeFormat()) {
      md += formatHotContext(hotEntities);
    } else {
      if (hotEntities.files.length > 0) {
        md += `**Files:** ${hotEntities.files.map((f) => f.path).join(", ")}\n`;
      }
      if (hotEntities.decisions.length > 0) {
        md += `**Decisions:** ${hotEntities.decisions.map((d) => d.title).join(", ")}\n`;
      }
      if (hotEntities.learnings.length > 0) {
        md += `**Learnings:** ${hotEntities.learnings.map((l) => l.title).join(", ")}\n`;
      }
    }
    md += "\n";
  }

  // Open questions
  const openQuestions = await getOpenQuestionsForResume(db, projectId);
  if (openQuestions.length > 0) {
    md += `## Open Questions\n`;
    for (const q of openQuestions) {
      const pri = ["", "P1", "P2", "P3", "P4", "P5"][q.priority];
      md += `- [${pri}] ${q.question}\n`;
    }
    md += "\n";
  }

  // Recent observations
  const recentObs = await getRecentObservations(db, projectId);
  if (recentObs.length > 0) {
    md += `## Recent Observations\n`;
    for (const obs of recentObs) {
      const freq = obs.frequency > 1 ? ` (${obs.frequency}x)` : "";
      md += `- [${obs.type}] ${obs.content.slice(0, 60)}${freq}\n`;
    }
    md += "\n";
  }

  if (isOngoing) {
    md += `---\n`;
    md += `Session still in progress. Use \`muninn session end ${lastSession.id}\` to close it.\n`;
  } else {
    const goalPreview = ((lastSession.goal as string) || "previous work").substring(0, 40);
    md += `---\n`;
    md += `Continue with: \`muninn session start "Continue: ${goalPreview}"\`\n`;
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
// System Primer (Phase 0)
// ============================================================================

/**
 * Build the system primer section that teaches the AI the available tools
 * and surfaces the developer profile + active state.
 */
async function buildSystemPrimer(db: DatabaseAdapter, projectId: number): Promise<string> {
  const native = isNativeFormat();
  let md = `# Context Intelligence System\n\n`;

  // Tools section - always human readable for learnability
  md += `## Your Tools (use proactively)\n`;
  if (native) {
    // Compact tool list
    md += `- \`muninn_predict\` \`muninn_check\` \`muninn_query\` \`muninn_observe\` \`muninn_focus_set\`\n`;
    md += `- \`muninn_profile\` \`muninn_insights\` \`muninn_decisions_due\` \`muninn_outcome\`\n`;
  } else {
    md += `- \`muninn_predict "task"\` — Bundle all relevant context for a task in one call\n`;
    md += `- \`muninn_profile\` — Your developer preferences (coding style, patterns, anti-patterns)\n`;
    md += `- \`muninn_check [files]\` — Pre-edit safety check (MANDATORY before editing)\n`;
    md += `- \`muninn_query "topic"\` — Search all knowledge (decisions, learnings, issues, files)\n`;
    md += `- \`muninn_insights\` — Cross-session pattern insights\n`;
    md += `- \`muninn_decisions_due\` — Decisions needing outcome review\n`;
    md += `- \`muninn_outcome <id> <status>\` — Record whether a decision worked out\n`;
    md += `- \`muninn_observe "note"\` — Record a quick observation (auto-dedupes)\n`;
    md += `- \`muninn_focus_set "area"\` — Boost queries toward your current work\n`;
  }
  md += `\n`;

  // Developer profile top entries
  const profileEntries = await getTopProfileEntries(db, projectId, 5);
  if (profileEntries.length > 0) {
    md += `## Developer Profile (top preferences)\n`;
    for (const entry of profileEntries) {
      if (native) {
        md += formatProfile({
          key: entry.key,
          value: entry.value,
          confidence: entry.confidence,
          category: entry.category,
        });
      } else {
        const pct = Math.round(entry.confidence * 100);
        md += `- ${entry.key} (${pct}%): ${entry.value.slice(0, 60)}`;
      }
      md += `\n`;
    }
    md += `\n`;
  }

  // Active state
  md += `## Active State\n`;

  // Focus
  try {
    const focus = await db.get<{ area: string }>(
      `
      SELECT area FROM focus
      WHERE project_id = ? AND cleared_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `,
      [projectId]
    );
    md += `- Focus: ${focus?.area || "none"}\n`;
  } catch {
    md += `- Focus: none\n`;
  }

  // Hot files
  try {
    const hotFiles = await db.all<{ path: string; fragility?: number }>(
      `
      SELECT path, fragility FROM files
      WHERE project_id = ? AND temperature = 'hot'
      ORDER BY last_referenced_at DESC LIMIT 3
    `,
      [projectId]
    );
    if (hotFiles.length > 0) {
      if (native) {
        md += `- Hot: ${hotFiles.map((f) => `F[${f.path}${f.fragility ? `|frag:${f.fragility}` : ""}]`).join(" ")}\n`;
      } else {
        md += `- Hot files: ${hotFiles.map((f) => f.path).join(", ")}\n`;
      }
    }
  } catch {
    /* temperature column might not exist */
  }

  // Decisions due — show titles + age
  const decisionsDue = await getDecisionsDue(db, projectId);
  if (decisionsDue.length > 0) {
    md += `- Decisions due for review:\n`;
    for (const d of decisionsDue.slice(0, 3)) {
      if (native) {
        md += `  ${formatDecision({ id: d.id, title: d.title, sessionsSince: d.sessions_since })}\n`;
      } else {
        md += `  - "${d.title}" (${d.sessions_since} sessions)\n`;
      }
    }
    if (decisionsDue.length > 3) {
      md += `  - ...and ${decisionsDue.length - 3} more\n`;
    }
  }

  // Foundational learnings due — show titles + age
  const foundationalDue = await getFoundationalLearningsDue(db, projectId);
  if (foundationalDue.length > 0) {
    md += `- Foundational learnings for review:\n`;
    for (const l of foundationalDue.slice(0, 3)) {
      if (native) {
        md += `  K[foundational|#${l.id}|${l.title.slice(0, 40)}|sessions:${l.sessions_since_review}]\n`;
      } else {
        md += `  - L${l.id}: "${l.title}" (${l.sessions_since_review} sessions)\n`;
      }
    }
    if (foundationalDue.length > 3) {
      md += `  - ...and ${foundationalDue.length - 3} more\n`;
    }
  }

  // Pending insights — show type + content
  const newInsights = await listInsights(db, projectId, { status: "new" });
  if (newInsights.length > 0) {
    md += `- New insights:\n`;
    for (const i of newInsights.slice(0, 3)) {
      if (native) {
        md += `  ${formatInsight({ id: i.id, type: i.type, title: i.title, content: i.content })}\n`;
      } else {
        md += `  - [${i.type}] ${i.title}: ${i.content.slice(0, 80)}\n`;
      }
    }
    if (newInsights.length > 3) {
      md += `  - ...and ${newInsights.length - 3} more\n`;
    }
  }

  // Velocity anomalies — hot-changing files
  const anomalies = await detectAnomalies(db, projectId);
  if (anomalies.length > 0) {
    if (native) {
      md += `- Velocity: ${anomalies.map((a) => `${a.path}(${a.velocity_score.toFixed(1)}x)`).join(", ")}\n`;
    } else {
      md += `- Velocity anomalies: ${anomalies.map((a) => `${a.path} (${a.velocity_score.toFixed(1)}x)`).join(", ")}\n`;
    }
  }

  // Open questions count
  const openQuestions = await getOpenQuestionsForResume(db, projectId);
  md += `- Open questions: ${openQuestions.length}\n`;

  // Promotion candidates (learnings ready for CLAUDE.md)
  const promotionCandidates = await getPromotionCandidates(db, projectId);
  if (promotionCandidates.length > 0) {
    md += `- Promotion candidates (ready for CLAUDE.md):\n`;
    for (const c of promotionCandidates.slice(0, 3)) {
      if (native) {
        md += `  K[promo|#${c.id}|${c.title.slice(0, 40)}|conf:${c.confidence}]\n`;
      } else {
        md += `  - L${c.id}: "${c.title}" (conf ${c.confidence})\n`;
      }
    }
    if (promotionCandidates.length > 3) {
      md += `  - ...and ${promotionCandidates.length - 3} more\n`;
    }
  }

  md += `\n`;

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
