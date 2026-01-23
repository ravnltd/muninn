/**
 * Session commands
 * Track work sessions with goals, outcomes, and next steps
 */

import type { Database } from "bun:sqlite";
import { outputJson, outputSuccess, getTimeAgo } from "../utils/format";
import { exitWithUsage, safeJsonParse, logError } from "../utils/errors";
import { parseSessionEndArgs } from "../utils/validation";
import { getApiKey, redactApiKeys } from "../utils/api-keys";
import { getOpenQuestionsForResume } from "./questions";
import { getTopProfileEntries } from "./profile";
import { getDecisionsDue } from "./outcomes";
import { listInsights } from "./insights";

// ============================================================================
// Types
// ============================================================================

interface FileCorrelation {
  file: string;
  cochange_count: number;
  correlation_strength: number;
  last_cochange: string;
}

interface ExtractedLearning {
  title: string;
  content: string;
  category: string;
  confidence: number;
}

// ============================================================================
// Session Start
// ============================================================================

export function sessionStart(db: Database, projectId: number, goal: string): number {
  if (!goal) {
    exitWithUsage("Usage: context session start <goal>");
  }

  // Decay temperatures on session start
  decayTemperatures(db, projectId);

  const result = db.run(`
    INSERT INTO sessions (project_id, goal)
    VALUES (?, ?)
  `, [projectId, goal]);

  const sessionId = Number(result.lastInsertRowid);

  console.error(`\n🚀 Session #${sessionId} started`);
  console.error(`   Goal: ${goal}`);
  console.error(`\n   When done, run: context session end ${sessionId}`);
  console.error("");

  outputSuccess({ sessionId, goal });
  return sessionId;
}

// ============================================================================
// Session End
// ============================================================================

export function sessionEnd(db: Database, sessionId: number, args: string[]): void {
  const { values } = parseSessionEndArgs(args);

  if (!sessionId) {
    exitWithUsage("Usage: context session end <id> [--outcome <text>] [--next <steps>] [--success 0-2]");
  }

  // Verify session exists
  const session = db.query<{ id: number; goal: string }, [number]>(
    "SELECT id, goal FROM sessions WHERE id = ?"
  ).get(sessionId);

  if (!session) {
    console.error(`❌ Session #${sessionId} not found`);
    process.exit(1);
  }

  db.run(`
    UPDATE sessions SET
      ended_at = CURRENT_TIMESTAMP,
      outcome = ?,
      files_touched = ?,
      learnings = ?,
      next_steps = ?,
      success = ?
    WHERE id = ?
  `, [
    values.outcome || null,
    values.files || null,
    values.learnings || null,
    values.next || null,
    values.success ?? null,
    sessionId,
  ]);

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

export function sessionLast(db: Database, projectId: number): void {
  const session = db.query<Record<string, unknown>, [number]>(`
    SELECT * FROM sessions
    WHERE project_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(projectId);

  if (!session) {
    console.error("No sessions found. Start one with: context session start <goal>");
    outputJson({ found: false });
    return;
  }

  const timeAgo = getTimeAgo(session.started_at as string);
  const isOngoing = !session.ended_at;

  console.error(`\n📋 Last Session (#${session.id}) - ${timeAgo}`);
  console.error(`   Goal: ${session.goal || 'Not specified'}`);

  if (session.outcome) {
    console.error(`   Outcome: ${session.outcome}`);
  }

  if (isOngoing) {
    console.error(`   Status: IN PROGRESS`);
    console.error(`\n   End with: context session end ${session.id}`);
  } else {
    if (session.next_steps) {
      console.error(`   Next: ${session.next_steps}`);
    }
  }
  console.error("");

  outputJson(session);
}

// ============================================================================
// Session List
// ============================================================================

export function sessionList(db: Database, projectId: number, limit: number = 10): void {
  const sessions = db.query<Record<string, unknown>, [number, number]>(`
    SELECT id, goal, outcome, started_at, ended_at, success
    FROM sessions
    WHERE project_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(projectId, limit);

  if (sessions.length === 0) {
    console.error("No sessions found.");
    outputJson([]);
    return;
  }

  console.error("\n📋 Recent Sessions:\n");

  for (const s of sessions) {
    const timeAgo = getTimeAgo(s.started_at as string);
    const isOngoing = !s.ended_at;
    const successIcon = s.success === 2 ? '✅' : s.success === 1 ? '⚠️' : s.success === 0 ? '❌' : '⚪';

    console.error(`  ${successIcon} #${s.id} (${timeAgo})${isOngoing ? ' [ONGOING]' : ''}`);
    console.error(`     ${(s.goal as string)?.substring(0, 60) || 'No goal'}...`);
  }
  console.error("");

  outputJson(sessions);
}

// ============================================================================
// Resume from Last Session
// ============================================================================

export function generateResume(db: Database, projectId: number): string {
  const lastSession = db.query<Record<string, unknown>, [number]>(`
    SELECT * FROM sessions
    WHERE project_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(projectId);

  if (!lastSession) {
    return "No previous sessions found. Start fresh with `context session start \"Your goal\"`";
  }

  // Build system primer section
  let md = buildSystemPrimer(db, projectId);

  const timeAgo = getTimeAgo((lastSession.ended_at || lastSession.started_at) as string);
  const isOngoing = !lastSession.ended_at;

  md += `# Resume Point\n\n`;
  md += `**Last session:** ${timeAgo}${isOngoing ? " (still ongoing)" : ""}\n`;
  md += `**Goal:** ${lastSession.goal || "Not specified"}\n`;

  if (lastSession.outcome) {
    md += `**Outcome:** ${lastSession.outcome}\n`;
  }

  md += "\n";

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
      const steps = nextSteps.split(/[\n•-]/).map(s => s.trim()).filter(Boolean);
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
        md += `- Found: ${found.map(id => `#${id}`).join(", ")}\n`;
      }
      if (resolved.length > 0) {
        md += `- Resolved: ${resolved.map(id => `#${id}`).join(", ")}\n`;
      }
      md += "\n";
    }
  }

  // Hot entities (actively in-flight context)
  const hotEntities = getHotEntities(db, projectId);
  const hasHot = hotEntities.files.length > 0 || hotEntities.decisions.length > 0 || hotEntities.learnings.length > 0;

  if (hasHot) {
    md += `## Hot Context\n`;
    if (hotEntities.files.length > 0) {
      md += `**Files:** ${hotEntities.files.map(f => f.path).join(', ')}\n`;
    }
    if (hotEntities.decisions.length > 0) {
      md += `**Decisions:** ${hotEntities.decisions.map(d => d.title).join(', ')}\n`;
    }
    if (hotEntities.learnings.length > 0) {
      md += `**Learnings:** ${hotEntities.learnings.map(l => l.title).join(', ')}\n`;
    }
    md += "\n";
  }

  // Open questions
  const openQuestions = getOpenQuestionsForResume(db, projectId);
  if (openQuestions.length > 0) {
    md += `## Open Questions\n`;
    for (const q of openQuestions) {
      const pri = ['', 'P1', 'P2', 'P3', 'P4', 'P5'][q.priority];
      md += `- [${pri}] ${q.question}\n`;
    }
    md += "\n";
  }

  // Recent observations
  const recentObs = getRecentObservations(db, projectId);
  if (recentObs.length > 0) {
    md += `## Recent Observations\n`;
    for (const obs of recentObs) {
      const freq = obs.frequency > 1 ? ` (${obs.frequency}x)` : '';
      md += `- [${obs.type}] ${obs.content.slice(0, 60)}${freq}\n`;
    }
    md += "\n";
  }

  if (isOngoing) {
    md += `---\n`;
    md += `Session still in progress. Use \`context session end ${lastSession.id}\` to close it.\n`;
  } else {
    const goalPreview = ((lastSession.goal as string) || "previous work").substring(0, 40);
    md += `---\n`;
    md += `Continue with: \`context session start "Continue: ${goalPreview}"\`\n`;
  }

  return md;
}

// ============================================================================
// Temperature System
// ============================================================================

/**
 * Decay temperature based on session count since last reference.
 * Called on session start.
 * Hot = referenced in last 3 sessions, Warm = 3-10, Cold = 10+
 */
export function decayTemperatures(db: Database, projectId: number): void {
  const tables = ['files', 'decisions', 'issues', 'learnings'];

  for (const table of tables) {
    try {
      // Set cold: last_referenced_at more than 10 sessions ago or null
      db.run(`
        UPDATE ${table}
        SET temperature = 'cold'
        WHERE project_id = ? AND temperature != 'cold'
        AND (last_referenced_at IS NULL OR
             (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND started_at > last_referenced_at) > 10)
      `, [projectId, projectId]);

      // Set warm: last_referenced between 3-10 sessions ago
      db.run(`
        UPDATE ${table}
        SET temperature = 'warm'
        WHERE project_id = ? AND temperature = 'hot'
        AND last_referenced_at IS NOT NULL
        AND (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND started_at > last_referenced_at) BETWEEN 3 AND 10
      `, [projectId, projectId]);
    } catch {
      // Temperature columns might not exist yet
    }
  }
}

/**
 * Heat an entity when it's queried/referenced
 */
export function heatEntity(db: Database, table: string, id: number): void {
  try {
    db.run(`
      UPDATE ${table}
      SET temperature = 'hot', last_referenced_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
  } catch {
    // Temperature columns might not exist
  }
}

/**
 * Get hot entities for resume display
 */
export function getHotEntities(db: Database, projectId: number): {
  files: Array<{ path: string; purpose: string | null }>;
  decisions: Array<{ id: number; title: string }>;
  learnings: Array<{ id: number; title: string }>;
} {
  const result = {
    files: [] as Array<{ path: string; purpose: string | null }>,
    decisions: [] as Array<{ id: number; title: string }>,
    learnings: [] as Array<{ id: number; title: string }>,
  };

  try {
    result.files = db.query<{ path: string; purpose: string | null }, [number]>(`
      SELECT path, purpose FROM files
      WHERE project_id = ? AND temperature = 'hot'
      ORDER BY last_referenced_at DESC LIMIT 5
    `).all(projectId);
  } catch { /* temperature column may not exist */ }

  try {
    result.decisions = db.query<{ id: number; title: string }, [number]>(`
      SELECT id, title FROM decisions
      WHERE project_id = ? AND temperature = 'hot' AND status = 'active'
      ORDER BY last_referenced_at DESC LIMIT 5
    `).all(projectId);
  } catch { /* temperature column may not exist */ }

  try {
    result.learnings = db.query<{ id: number; title: string }, [number]>(`
      SELECT id, title FROM learnings
      WHERE (project_id = ? OR project_id IS NULL) AND temperature = 'hot'
      ORDER BY last_referenced_at DESC LIMIT 5
    `).all(projectId);
  } catch { /* temperature column may not exist */ }

  return result;
}

/**
 * Get recent observations for resume
 */
export function getRecentObservations(db: Database, projectId: number, limit: number = 3): Array<{
  type: string; content: string; frequency: number;
}> {
  try {
    return db.query<{ type: string; content: string; frequency: number }, [number, number]>(`
      SELECT type, content, frequency FROM observations
      WHERE (project_id = ? OR project_id IS NULL)
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(projectId, limit);
  } catch {
    return [];
  }
}

// ============================================================================
// Session Tracking Helpers
// ============================================================================

/**
 * Get the current active session ID for a project
 */
export function getActiveSessionId(db: Database, projectId: number): number | null {
  const session = db.query<{ id: number }, [number]>(`
    SELECT id FROM sessions
    WHERE project_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `).get(projectId);

  return session?.id || null;
}

/**
 * Track a file read in the current active session
 */
export function trackFileRead(db: Database, projectId: number, filePath: string): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ files_read: string | null }, [number]>(`
    SELECT files_read FROM sessions WHERE id = ?
  `).get(sessionId);

  const filesRead = safeJsonParse<string[]>(session?.files_read || "[]", []);

  if (!filesRead.includes(filePath)) {
    filesRead.push(filePath);
    db.run(`
      UPDATE sessions SET files_read = ? WHERE id = ?
    `, [JSON.stringify(filesRead), sessionId]);
  }
}

/**
 * Track a query made in the current active session
 */
export function trackQuery(db: Database, projectId: number, query: string): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ queries_made: string | null }, [number]>(`
    SELECT queries_made FROM sessions WHERE id = ?
  `).get(sessionId);

  const queriesMade = safeJsonParse<string[]>(session?.queries_made || "[]", []);

  // Keep last 50 queries to avoid unbounded growth
  if (queriesMade.length >= 50) {
    queriesMade.shift();
  }

  queriesMade.push(query);
  db.run(`
    UPDATE sessions SET queries_made = ? WHERE id = ?
  `, [JSON.stringify(queriesMade), sessionId]);
}

/**
 * Track a file modification in the current active session
 */
export function trackFileTouched(db: Database, projectId: number, filePath: string): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ files_touched: string | null }, [number]>(`
    SELECT files_touched FROM sessions WHERE id = ?
  `).get(sessionId);

  const filesTouched = safeJsonParse<string[]>(session?.files_touched || "[]", []);

  if (!filesTouched.includes(filePath)) {
    filesTouched.push(filePath);
    db.run(`
      UPDATE sessions SET files_touched = ? WHERE id = ?
    `, [JSON.stringify(filesTouched), sessionId]);
  }
}

/**
 * Track an issue found in the current active session
 */
export function trackIssueFound(db: Database, projectId: number, issueId: number): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ issues_found: string | null }, [number]>(`
    SELECT issues_found FROM sessions WHERE id = ?
  `).get(sessionId);

  const issuesFound = safeJsonParse<number[]>(session?.issues_found || "[]", []);

  if (!issuesFound.includes(issueId)) {
    issuesFound.push(issueId);
    db.run(`
      UPDATE sessions SET issues_found = ? WHERE id = ?
    `, [JSON.stringify(issuesFound), sessionId]);
  }
}

/**
 * Track an issue resolved in the current active session
 */
export function trackIssueResolved(db: Database, projectId: number, issueId: number): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ issues_resolved: string | null }, [number]>(`
    SELECT issues_resolved FROM sessions WHERE id = ?
  `).get(sessionId);

  const issuesResolved = safeJsonParse<number[]>(session?.issues_resolved || "[]", []);

  if (!issuesResolved.includes(issueId)) {
    issuesResolved.push(issueId);
    db.run(`
      UPDATE sessions SET issues_resolved = ? WHERE id = ?
    `, [JSON.stringify(issuesResolved), sessionId]);
  }
}

// ============================================================================
// File Correlation Tracking
// ============================================================================

/**
 * Update file correlations based on files changed together
 */
export function updateFileCorrelations(
  db: Database,
  projectId: number,
  files: string[]
): void {
  if (files.length < 2) return;

  // Sort files to ensure consistent ordering (file_a < file_b alphabetically)
  const sortedFiles = [...files].sort();

  // Create all pairs
  for (let i = 0; i < sortedFiles.length; i++) {
    for (let j = i + 1; j < sortedFiles.length; j++) {
      const fileA = sortedFiles[i];
      const fileB = sortedFiles[j];

      try {
        // Upsert correlation
        db.run(
          `INSERT INTO file_correlations (project_id, file_a, file_b, cochange_count, last_cochange)
           VALUES (?, ?, ?, 1, datetime('now'))
           ON CONFLICT(project_id, file_a, file_b) DO UPDATE SET
             cochange_count = cochange_count + 1,
             last_cochange = datetime('now'),
             correlation_strength = CAST(cochange_count + 1 AS REAL) /
               (1 + (julianday('now') - julianday(created_at)))`,
          [projectId, fileA, fileB]
        );
      } catch {
        // Table might not exist in older databases, skip silently
      }
    }
  }
}

/**
 * Get files that often change together with a given file
 */
export function getCorrelatedFiles(
  db: Database,
  projectId: number,
  filePath: string,
  limit: number = 5
): FileCorrelation[] {
  try {
    // Check both directions (file could be file_a or file_b)
    const correlations = db.query<{
      file: string;
      cochange_count: number;
      correlation_strength: number;
      last_cochange: string;
    }, [string, number, string, string, number]>(
      `SELECT
         CASE WHEN file_a = ? THEN file_b ELSE file_a END as file,
         cochange_count,
         COALESCE(correlation_strength, CAST(cochange_count AS REAL) / 10) as correlation_strength,
         last_cochange
       FROM file_correlations
       WHERE project_id = ? AND (file_a = ? OR file_b = ?)
       ORDER BY cochange_count DESC, last_cochange DESC
       LIMIT ?`
    ).all(filePath, projectId, filePath, filePath, limit);

    return correlations;
  } catch {
    return []; // Table might not exist
  }
}

/**
 * Get top file correlations across the project
 */
export function getTopCorrelations(
  db: Database,
  projectId: number,
  limit: number = 10
): Array<{
  file_a: string;
  file_b: string;
  cochange_count: number;
  correlation_strength: number;
}> {
  try {
    return db.query<{
      file_a: string;
      file_b: string;
      cochange_count: number;
      correlation_strength: number;
    }, [number, number]>(
      `SELECT file_a, file_b, cochange_count,
         COALESCE(correlation_strength, CAST(cochange_count AS REAL) / 10) as correlation_strength
       FROM file_correlations
       WHERE project_id = ? AND cochange_count > 1
       ORDER BY cochange_count DESC
       LIMIT ?`
    ).all(projectId, limit);
  } catch {
    return []; // Table might not exist
  }
}

// ============================================================================
// Auto-Learning Extraction
// ============================================================================

/**
 * Extract learnings from a completed session using Claude
 */
export async function extractSessionLearnings(
  db: Database,
  projectId: number,
  sessionId: number,
  context: {
    goal: string;
    outcome: string;
    files: string[];
    success: number;
  }
): Promise<ExtractedLearning[]> {
  const keyResult = getApiKey("anthropic");
  if (!keyResult.ok) {
    return []; // No API key, skip extraction
  }

  // Don't extract from failed sessions with no useful info
  if (context.success === 0 && context.files.length === 0) {
    return [];
  }

  try {
    const prompt = buildExtractionPrompt(context);
    const response = await callClaudeForExtraction(keyResult.value, prompt);
    const learnings = parseExtractedLearnings(response);

    // Record the extractions
    for (const learning of learnings) {
      if (learning.confidence >= 0.7) {
        // High confidence - auto-save
        const result = db.run(
          `INSERT INTO learnings (project_id, category, title, content, source, confidence)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [projectId, learning.category, learning.title, learning.content,
           `session:${sessionId}`, Math.round(learning.confidence * 10)]
        );

        try {
          db.run(
            `INSERT INTO session_learnings (session_id, learning_id, confidence, auto_applied)
             VALUES (?, ?, ?, 1)`,
            [sessionId, Number(result.lastInsertRowid), learning.confidence]
          );
        } catch {
          // Table might not exist
        }
      } else {
        // Lower confidence - record but don't auto-save
        try {
          db.run(
            `INSERT INTO session_learnings (session_id, confidence, auto_applied)
             VALUES (?, ?, 0)`,
            [sessionId, learning.confidence]
          );
        } catch {
          // Table might not exist
        }
      }
    }

    return learnings;
  } catch (error) {
    logError('extractSessionLearnings', error);
    return [];
  }
}

function buildExtractionPrompt(context: {
  goal: string;
  outcome: string;
  files: string[];
  success: number;
}): string {
  const successLabel = context.success === 0 ? 'failed' :
                       context.success === 1 ? 'partial' : 'success';

  return `Analyze this coding session and extract reusable learnings.

SESSION:
- Goal: ${context.goal}
- Outcome: ${context.outcome}
- Status: ${successLabel}
- Files Modified: ${context.files.slice(0, 20).join(', ')}${context.files.length > 20 ? ` (+${context.files.length - 20} more)` : ''}

Extract 0-3 learnings that would be useful for future sessions. Focus on:
1. Patterns that worked well
2. Gotchas or pitfalls discovered
3. Conventions or preferences established

Return ONLY a JSON array (no markdown, no explanation):
[
  {
    "title": "Short title (max 50 chars)",
    "content": "The learning itself (1-2 sentences)",
    "category": "pattern|gotcha|preference|convention",
    "confidence": 0.0-1.0
  }
]

If no meaningful learnings, return empty array: []`;
}

async function callClaudeForExtraction(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${redactApiKeys(errorText)}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text: string }> };
  return data.content[0]?.text || "[]";
}

function parseExtractedLearnings(response: string): ExtractedLearning[] {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;

    const parsed = JSON.parse(jsonStr.trim());

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is ExtractedLearning =>
      typeof item === 'object' &&
      typeof item.title === 'string' &&
      typeof item.content === 'string' &&
      typeof item.category === 'string' &&
      typeof item.confidence === 'number'
    );
  } catch {
    return [];
  }
}

// ============================================================================
// Transcript Analysis
// ============================================================================

interface TranscriptAnalysis {
  outcome: string;
  learnings: ExtractedLearning[];
  nextSteps: string | null;
}

async function readStdinWithTimeout(timeoutMs: number): Promise<string> {
  if (process.stdin.isTTY) return "";

  return new Promise<string>((resolve) => {
    let data = "";
    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners();
      resolve(data);
    }, timeoutMs);

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timeout);
      resolve(data);
    });
    process.stdin.resume();
  });
}

async function analyzeTranscript(
  apiKey: string,
  transcript: string,
  goal: string,
  files: string[]
): Promise<TranscriptAnalysis> {
  const prompt = `Analyze this coding session transcript and extract:
1. A concise outcome summary (1-2 sentences of what was accomplished)
2. 0-3 reusable learnings (patterns, gotchas, conventions discovered)
3. Recommended next steps (if any)

SESSION GOAL: ${goal}
FILES MODIFIED: ${files.slice(0, 20).join(', ')}${files.length > 20 ? ` (+${files.length - 20} more)` : ''}

TRANSCRIPT (last portion):
${transcript}

Return ONLY valid JSON (no markdown, no explanation):
{
  "outcome": "What was accomplished (1-2 sentences)",
  "learnings": [
    {
      "title": "Short title (max 50 chars)",
      "content": "The learning (1-2 sentences)",
      "category": "pattern|gotcha|preference|convention",
      "confidence": 0.0-1.0
    }
  ],
  "next_steps": "What to do next (or null)"
}`;

  const response = await callClaudeForExtraction(apiKey, prompt);
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : response;
  const parsed = JSON.parse(jsonStr.trim());

  return {
    outcome: parsed.outcome || "Session completed",
    learnings: parseExtractedLearnings(JSON.stringify(parsed.learnings || [])),
    nextSteps: parsed.next_steps || null,
  };
}

// ============================================================================
// Enhanced Session End with Auto-Learning
// ============================================================================

/**
 * End session with correlation tracking and learning extraction.
 * Supports --analyze flag to read transcript from stdin for richer extraction.
 */
export async function sessionEndEnhanced(
  db: Database,
  projectId: number,
  sessionId: number,
  args: string[]
): Promise<{ learnings: ExtractedLearning[] }> {
  const { values } = parseSessionEndArgs(args);

  // Get session
  const session = db.query<{ id: number; goal: string; started_at: string; files_touched: string | null }, [number]>(
    "SELECT id, goal, started_at, files_touched FROM sessions WHERE id = ?"
  ).get(sessionId);

  if (!session) {
    throw new Error(`Session #${sessionId} not found`);
  }

  const filesTouched = safeJsonParse<string[]>(session.files_touched || values.files || "[]", []);

  // If --analyze, read stdin transcript and use Claude to extract structured data
  let analysisResult: TranscriptAnalysis | null = null;
  if (values.analyze) {
    const keyResult = getApiKey("anthropic");
    if (keyResult.ok) {
      const transcript = await readStdinWithTimeout(5000);
      if (transcript.length > 0) {
        const truncated = transcript.slice(-12000);
        try {
          analysisResult = await analyzeTranscript(
            keyResult.value,
            truncated,
            session.goal || "Unknown",
            filesTouched
          );
        } catch (error) {
          logError('analyzeTranscript', error);
        }
      }
    }
  }

  // Use analysis results, falling back to manual args
  const outcome = analysisResult?.outcome || values.outcome || null;
  const nextSteps = analysisResult?.nextSteps || values.next || null;

  // Update correlations
  updateFileCorrelations(db, projectId, filesTouched);

  // Standard end update
  db.run(`
    UPDATE sessions SET
      ended_at = CURRENT_TIMESTAMP,
      outcome = ?,
      files_touched = ?,
      learnings = ?,
      next_steps = ?,
      success = ?
    WHERE id = ?
  `, [
    outcome,
    JSON.stringify(filesTouched),
    values.learnings || null,
    nextSteps,
    values.success ?? 2,
    sessionId,
  ]);

  // Save learnings from analysis or fall back to existing extraction
  let learnings: ExtractedLearning[] = [];
  if (analysisResult?.learnings && analysisResult.learnings.length > 0) {
    for (const learning of analysisResult.learnings) {
      if (learning.confidence >= 0.7) {
        db.run(
          `INSERT INTO learnings (project_id, category, title, content, source, confidence)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [projectId, learning.category, learning.title, learning.content,
           `session:${sessionId}`, Math.round(learning.confidence * 10)]
        );
      }
    }
    learnings = analysisResult.learnings;
  } else {
    learnings = await extractSessionLearnings(db, projectId, sessionId, {
      goal: session.goal || "",
      outcome: outcome || "",
      files: filesTouched,
      success: values.success ?? 2
    });
  }

  console.error(`\n✅ Session #${sessionId} ended`);
  if (outcome) {
    console.error(`   Outcome: ${outcome}`);
  }
  console.error(`   Files: ${filesTouched.length}`);

  if (learnings.length > 0) {
    console.error(`\n💡 Extracted ${learnings.length} learning(s):`);
    for (const l of learnings) {
      const icon = l.confidence >= 0.7 ? '✓' : '○';
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
// Correlation Commands
// ============================================================================

/**
 * Handle correlation subcommands
 */
export function handleCorrelationCommand(
  db: Database,
  projectId: number,
  args: string[]
): void {
  const file = args[0];

  if (file) {
    const correlated = getCorrelatedFiles(db, projectId, file);
    if (correlated.length === 0) {
      console.error(`No correlations found for ${file}`);
      console.error("Correlations are built as you complete sessions.");
    } else {
      console.error(`\n🔗 Files that often change with ${file}:\n`);
      for (const c of correlated) {
        const strength = Math.round(c.correlation_strength * 100);
        console.error(`   ${c.file} (${c.cochange_count}x, ${strength}% strength)`);
      }
    }
    outputJson(correlated);
  } else {
    const top = getTopCorrelations(db, projectId);
    if (top.length === 0) {
      console.error("No file correlations recorded yet.");
      console.error("Correlations are built as you complete sessions.");
    } else {
      console.error("\n🔗 Top File Correlations:\n");
      for (const c of top) {
        console.error(`   ${c.file_a} ↔ ${c.file_b} (${c.cochange_count}x)`);
      }
    }
    outputJson(top);
  }
}

// ============================================================================
// System Primer (Phase 0)
// ============================================================================

/**
 * Build the system primer section that teaches Claude the available tools
 * and surfaces the developer profile + active state.
 */
function buildSystemPrimer(db: Database, projectId: number): string {
  let md = `# Context Intelligence System\n\n`;

  md += `## Your Tools (use proactively)\n`;
  md += `- \`context_predict "task"\` — Bundle all relevant context for a task in one call\n`;
  md += `- \`context_profile\` — Your developer preferences (coding style, patterns, anti-patterns)\n`;
  md += `- \`context_check [files]\` — Pre-edit safety check (MANDATORY before editing)\n`;
  md += `- \`context_query "topic"\` — Search all knowledge (decisions, learnings, issues, files)\n`;
  md += `- \`context_insights\` — Cross-session pattern insights\n`;
  md += `- \`context_decisions_due\` — Decisions needing outcome review\n`;
  md += `- \`context_outcome <id> <status>\` — Record whether a decision worked out\n`;
  md += `- \`context_observe "note"\` — Record a quick observation (auto-dedupes)\n`;
  md += `- \`context_focus_set "area"\` — Boost queries toward your current work\n`;
  md += `\n`;

  // Developer profile top entries
  const profileEntries = getTopProfileEntries(db, projectId, 5);
  if (profileEntries.length > 0) {
    md += `## Developer Profile (top preferences)\n`;
    for (const entry of profileEntries) {
      const pct = Math.round(entry.confidence * 100);
      md += `- ${entry.key} (${pct}%): ${entry.value.slice(0, 60)}\n`;
    }
    md += `\n`;
  }

  // Active state
  md += `## Active State\n`;

  // Focus
  try {
    const focus = db.query<{ area: string }, [number]>(`
      SELECT area FROM focus
      WHERE project_id = ? AND cleared_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(projectId);
    md += `- Focus: ${focus?.area || 'none'}\n`;
  } catch {
    md += `- Focus: none\n`;
  }

  // Hot files
  try {
    const hotFiles = db.query<{ path: string }, [number]>(`
      SELECT path FROM files
      WHERE project_id = ? AND temperature = 'hot'
      ORDER BY last_referenced_at DESC LIMIT 3
    `).all(projectId);
    if (hotFiles.length > 0) {
      md += `- Hot files: ${hotFiles.map(f => f.path).join(', ')}\n`;
    }
  } catch { /* temperature column might not exist */ }

  // Decisions due
  const decisionsDue = getDecisionsDue(db, projectId);
  if (decisionsDue.length > 0) {
    md += `- Decisions due: ${decisionsDue.length}\n`;
  }

  // Pending insights
  const newInsights = listInsights(db, projectId, { status: 'new' });
  if (newInsights.length > 0) {
    md += `- Pending insights: ${newInsights.length}\n`;
  }

  // Open questions count
  const openQuestions = getOpenQuestionsForResume(db, projectId);
  md += `- Open questions: ${openQuestions.length}\n`;

  md += `\n`;

  return md;
}
