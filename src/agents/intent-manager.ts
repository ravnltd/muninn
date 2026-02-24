/**
 * Agent Intent Manager — v7 Phase 5A
 *
 * Intent declaration and conflict prevention for multi-agent scenarios.
 * Agents declare what they're about to do, the system checks for conflicts.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export type IntentAction = "declare" | "query" | "release";
export type IntentType = "edit" | "read" | "plan" | "debug" | "test";

export interface IntentRequest {
  action: IntentAction;
  agentId?: string;
  intentType?: IntentType;
  files?: string[];
  description?: string;
}

export interface IntentConflict {
  agentId: string;
  intentType: string;
  files: string[];
  description: string | null;
}

export interface IntentResult {
  success: boolean;
  conflicts: IntentConflict[];
  activeIntents: IntentConflict[];
  message: string;
}

// ============================================================================
// Constants
// ============================================================================

const INTENT_TTL_MINUTES = 30; // Intents expire after 30 minutes

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle an intent request.
 */
export async function handleIntent(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number | null,
  request: IntentRequest,
): Promise<IntentResult> {
  const agentId = request.agentId ?? `session-${sessionId ?? "unknown"}`;

  switch (request.action) {
    case "declare":
      return declareIntent(db, projectId, sessionId, agentId, request);
    case "query":
      return queryIntents(db, projectId, agentId);
    case "release":
      return releaseIntents(db, projectId, agentId);
  }
}

// ============================================================================
// Intent Operations
// ============================================================================

async function declareIntent(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number | null,
  agentId: string,
  request: IntentRequest,
): Promise<IntentResult> {
  const intentType = request.intentType ?? "edit";
  const files = request.files ?? [];

  // Check for conflicts
  const conflicts = await findConflicts(db, projectId, agentId, files);

  // Persist intent regardless of conflicts (caller decides what to do)
  try {
    await db.run(
      `INSERT INTO agent_intents
       (project_id, session_id, agent_id, intent_type, target_files, description, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${INTENT_TTL_MINUTES} minutes'))`,
      [
        projectId,
        sessionId,
        agentId,
        intentType,
        JSON.stringify(files),
        request.description ?? null,
      ],
    );
  } catch {
    // Table may not exist
  }

  const hasConflicts = conflicts.length > 0;
  return {
    success: !hasConflicts,
    conflicts,
    activeIntents: await getActiveIntents(db, projectId, agentId),
    message: hasConflicts
      ? `Conflict detected with ${conflicts.length} agent(s). Consider sequential execution.`
      : "Intent declared successfully. No conflicts.",
  };
}

async function queryIntents(
  db: DatabaseAdapter,
  projectId: number,
  agentId: string,
): Promise<IntentResult> {
  const intents = await getActiveIntents(db, projectId, agentId);
  return {
    success: true,
    conflicts: [],
    activeIntents: intents,
    message: intents.length > 0
      ? `${intents.length} active intent(s) from other agents.`
      : "No active intents from other agents.",
  };
}

async function releaseIntents(
  db: DatabaseAdapter,
  projectId: number,
  agentId: string,
): Promise<IntentResult> {
  try {
    await db.run(
      `UPDATE agent_intents SET status = 'released'
       WHERE project_id = ? AND agent_id = ? AND status = 'active'`,
      [projectId, agentId],
    );
  } catch {
    // Table may not exist
  }

  return {
    success: true,
    conflicts: [],
    activeIntents: [],
    message: "All intents released.",
  };
}

// ============================================================================
// Conflict Detection
// ============================================================================

async function findConflicts(
  db: DatabaseAdapter,
  projectId: number,
  agentId: string,
  targetFiles: string[],
): Promise<IntentConflict[]> {
  if (targetFiles.length === 0) return [];

  const conflicts: IntentConflict[] = [];

  try {
    // Get active intents from other agents
    const otherIntents = await db.all<{
      agent_id: string;
      intent_type: string;
      target_files: string;
      description: string | null;
    }>(
      `SELECT agent_id, intent_type, target_files, description
       FROM agent_intents
       WHERE project_id = ? AND agent_id != ? AND status = 'active'
       AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      [projectId, agentId],
    );

    for (const intent of otherIntents) {
      let intentFiles: string[] = [];
      try { intentFiles = JSON.parse(intent.target_files); } catch { /* skip */ }

      // Check for file overlap
      const overlap = targetFiles.filter((f) => intentFiles.includes(f));
      if (overlap.length > 0) {
        conflicts.push({
          agentId: intent.agent_id,
          intentType: intent.intent_type,
          files: overlap,
          description: intent.description,
        });
      }
    }
  } catch {
    // Table may not exist
  }

  return conflicts;
}

async function getActiveIntents(
  db: DatabaseAdapter,
  projectId: number,
  excludeAgentId: string,
): Promise<IntentConflict[]> {
  try {
    const intents = await db.all<{
      agent_id: string;
      intent_type: string;
      target_files: string;
      description: string | null;
    }>(
      `SELECT agent_id, intent_type, target_files, description
       FROM agent_intents
       WHERE project_id = ? AND agent_id != ? AND status = 'active'
       AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      [projectId, excludeAgentId],
    );

    return intents.map((i) => ({
      agentId: i.agent_id,
      intentType: i.intent_type,
      files: (() => { try { return JSON.parse(i.target_files); } catch { return []; } })(),
      description: i.description,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// Maintenance
// ============================================================================

/**
 * Expire old intents. Runs on a safeInterval.
 */
export async function expireIntents(
  db: DatabaseAdapter,
  projectId: number,
): Promise<number> {
  try {
    const result = await db.run(
      `UPDATE agent_intents SET status = 'expired'
       WHERE project_id = ? AND status = 'active'
       AND expires_at IS NOT NULL AND expires_at < datetime('now')`,
      [projectId],
    );
    return Number(result?.changes ?? 0);
  } catch {
    return 0;
  }
}
