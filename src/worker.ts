#!/usr/bin/env bun

/**
 * Muninn Background Worker
 *
 * Separate process that runs background jobs from the work_queue table.
 * Spawned by git hooks and session-end hooks. Never runs in the MCP hot path.
 *
 * Usage: bun run src/worker.ts [--once] [--type <job_type>]
 *
 * Flags:
 *   --once   Process pending jobs and exit (default)
 *   --type   Only process jobs of this type
 */

import type { DatabaseAdapter } from "./database/adapter";

// ============================================================================
// Types
// ============================================================================

interface QueuedJob {
  id: number;
  job_type: string;
  payload: string;
  attempts: number;
  max_attempts: number;
}

type JobHandler = (db: DatabaseAdapter, payload: Record<string, unknown>) => Promise<void>;

// ============================================================================
// Job Registry
// ============================================================================

const JOB_HANDLERS: Record<string, JobHandler> = {
  async analyze_commit(db, payload) {
    const { processCommit } = await import("./ingestion/git-hook");
    const projectId = payload.projectId as number;
    await processCommit(db, projectId);
  },

  // v4 Phase 2: Analyze git diffs with LLM or heuristics
  async analyze_diffs(db, payload) {
    const { analyzeUnprocessedCommits } = await import("./learning/diff-analyzer");
    const projectId = payload.projectId as number;
    const maxBatch = (payload.maxBatch as number) || 5;
    await analyzeUnprocessedCommits(db, projectId, maxBatch);
  },

  // v4 Phase 2: Detect error-fix pairs from session data
  async map_error_fixes(db, payload) {
    const { processSessionErrors } = await import("./learning/error-mapper");
    const projectId = payload.projectId as number;
    const sessionId = payload.sessionId as number;
    await processSessionErrors(db, projectId, sessionId);
  },

  // v4 Phase 2: Run pattern detection across sessions
  async detect_patterns(db, payload) {
    const { detectPatterns, persistPatternInsights } = await import("./learning/pattern-detector");
    const projectId = payload.projectId as number;
    const patterns = await detectPatterns(db, projectId);
    if (patterns.length > 0) {
      await persistPatternInsights(db, projectId, patterns);
    }
  },

  // v4 Phase 4: Reindex symbols from source code
  async reindex_symbols(db, payload) {
    const { parseAndPersist } = await import("./code-intel/ast-parser");
    const projectId = payload.projectId as number;
    const projectPath = payload.projectPath as string;
    const filePaths = payload.filePaths as string[];
    await parseAndPersist(db, projectId, projectPath, filePaths);
  },

  // v4 Phase 4: Build call graph from source code
  async build_call_graph(db, payload) {
    const { buildAndPersistCallGraph } = await import("./code-intel/call-graph");
    const projectId = payload.projectId as number;
    const projectPath = payload.projectPath as string;
    const filePaths = payload.filePaths as string[];
    await buildAndPersistCallGraph(db, projectId, projectPath, filePaths);
  },

  // v4 Phase 4: Build test-source map
  async build_test_map(db, payload) {
    const { buildAndPersistTestMap } = await import("./code-intel/test-mapper");
    const projectId = payload.projectId as number;
    const projectPath = payload.projectPath as string;
    await buildAndPersistTestMap(db, projectId, projectPath);
  },

  // v4 Phase 5: Run tests after commit
  async run_tests(db, payload) {
    const { runTestsAfterCommit } = await import("./outcomes/test-tracker");
    const projectId = payload.projectId as number;
    const projectPath = payload.projectPath as string;
    const commitHash = (payload.commitHash as string) || null;
    const sessionId = (payload.sessionId as number) || null;
    await runTestsAfterCommit(db, projectId, projectPath, commitHash, sessionId);
  },

  // v4 Phase 5: Detect git reverts
  async detect_reverts(db, payload) {
    const { processReverts } = await import("./outcomes/revert-detector");
    const projectId = payload.projectId as number;
    await processReverts(db, projectId);
  },

  // v4 Phase 5: Track decision outcomes at session end
  async track_decisions(db, payload) {
    const { trackDecisionOutcomes } = await import("./outcomes/decision-tracker");
    const projectId = payload.projectId as number;
    const sessionId = payload.sessionId as number;
    await trackDecisionOutcomes(db, projectId, sessionId);
  },

  // v4 Phase 5: Calibrate prediction confidence at session end
  async calibrate_confidence(db, payload) {
    const { collectSessionFeedback } = await import("./outcomes/confidence-calibrator");
    const projectId = payload.projectId as number;
    const sessionId = payload.sessionId as number;
    await collectSessionFeedback(db, projectId, sessionId);
  },

  // v4 Phase 5: Process context feedback at session end
  async process_context_feedback(db, payload) {
    const { processContextFeedback } = await import("./outcomes/context-feedback");
    const projectId = payload.projectId as number;
    const sessionId = payload.sessionId as number;
    await processContextFeedback(db, projectId, sessionId);
  },

  // v5 Phase 1: Reinforce learnings based on session outcomes
  async reinforce_learnings(db, payload) {
    const { reinforceLearnings } = await import("./outcomes/learning-reinforcer");
    const projectId = payload.projectId as number;
    const sessionId = payload.sessionId as number;
    await reinforceLearnings(db, projectId, sessionId);
  },

  // v5 Phase 2: Compute composite fragility scores
  async compute_fragility(db, payload) {
    const { computeProjectFragility } = await import("./code-intel/fragility-scorer");
    const projectId = payload.projectId as number;
    await computeProjectFragility(db, projectId);
  },

  // v4 Phase 6: Aggregate high-confidence learnings to team
  async aggregate_learnings(db, payload) {
    const { aggregateLearnings } = await import("./team/knowledge-aggregator");
    const projectId = payload.projectId as number;
    await aggregateLearnings(db, projectId);
  },

  // v4 Phase 6: Refresh code ownership from git
  async refresh_ownership(db, payload) {
    const { refreshOwnership } = await import("./team/ownership");
    const projectId = payload.projectId as number;
    await refreshOwnership(db, projectId);
  },

  // v4 Phase 6: Promote recurring PR review patterns
  async promote_reviews(db, payload) {
    const { promoteRecurringPatterns } = await import("./team/pr-reviews");
    const projectId = payload.projectId as number;
    await promoteRecurringPatterns(db, projectId);
  },

  // v4 Phase 6: Detect cross-project patterns
  async detect_cross_project(db, payload) {
    const { detectAllPatterns, persistCrossProjectInsights } = await import("./team/cross-project");
    const projectId = payload.projectId as number;
    const patterns = await detectAllPatterns(db, projectId);
    if (patterns.length > 0) {
      await persistCrossProjectInsights(db, projectId, patterns);
    }
  },

  // v4 Phase 6: Generate onboarding context
  async generate_onboarding(db, payload) {
    const { generateOnboardingContext } = await import("./team/onboarding");
    const projectId = payload.projectId as number;
    const forceRefresh = (payload.forceRefresh as boolean) || false;
    await generateOnboardingContext(db, projectId, forceRefresh);
  },

  async update_file(db, payload) {
    const projectId = payload.projectId as number;
    const filePath = payload.filePath as string;

    const existing = await db.get<{ id: number; change_count: number }>(
      `SELECT id, change_count FROM files WHERE project_id = ? AND path = ?`,
      [projectId, filePath]
    );

    if (existing) {
      const newCount = existing.change_count + 1;
      await db.run(
        `UPDATE files SET
          change_count = ?,
          temperature = 'hot',
          last_referenced_at = datetime('now'),
          velocity_score = CAST(? AS REAL) / (1 + (julianday('now') - julianday(COALESCE(first_changed_at, created_at)))),
          updated_at = datetime('now')
         WHERE id = ?`,
        [newCount, newCount, existing.id]
      );
    }
  },
};

// ============================================================================
// Worker Loop
// ============================================================================

async function processJobs(db: DatabaseAdapter, jobType?: string): Promise<number> {
  let processed = 0;
  const maxBatch = 20;

  const typeFilter = jobType ? `AND job_type = ?` : "";

  const jobs = await db.all<QueuedJob>(
    `SELECT id, job_type, payload, attempts, max_attempts
     FROM work_queue
     WHERE status = ? ${typeFilter}
     ORDER BY created_at ASC
     LIMIT ?`,
    jobType ? ["pending", jobType, maxBatch] : ["pending", maxBatch]
  );

  for (const job of jobs) {
    const handler = JOB_HANDLERS[job.job_type];
    if (!handler) {
      // Unknown job type — mark as failed
      await db.run(
        `UPDATE work_queue SET status = 'failed', error_message = 'Unknown job type', completed_at = datetime('now') WHERE id = ?`,
        [job.id]
      );
      continue;
    }

    // Claim the job
    await db.run(
      `UPDATE work_queue SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1 WHERE id = ?`,
      [job.id]
    );

    try {
      const payload = JSON.parse(job.payload) as Record<string, unknown>;
      await handler(db, payload);

      // Mark completed
      await db.run(
        `UPDATE work_queue SET status = 'completed', completed_at = datetime('now') WHERE id = ?`,
        [job.id]
      );
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const newAttempts = job.attempts + 1;

      if (newAttempts >= job.max_attempts) {
        // Max attempts reached — mark as failed
        await db.run(
          `UPDATE work_queue SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`,
          [message, job.id]
        );
      } else {
        // Retry later — put back to pending
        await db.run(
          `UPDATE work_queue SET status = 'pending', error_message = ? WHERE id = ?`,
          [message, job.id]
        );
      }
    }
  }

  return processed;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jobType = args.includes("--type") ? args[args.indexOf("--type") + 1] : undefined;

  const { getGlobalDb } = await import("./database/connection");
  const db = await getGlobalDb();

  const processed = await processJobs(db, jobType);

  if (processed > 0) {
    process.stderr.write(`[muninn-worker] Processed ${processed} job(s)\n`);
  }

  db.close();
}

main().catch((error) => {
  process.stderr.write(`[muninn-worker] Fatal: ${error}\n`);
  process.exit(1);
});
