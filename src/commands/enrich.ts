/**
 * Enrichment CLI Commands
 *
 * CLI interface for the context enrichment layer.
 * - `muninn enrich <tool> <input>` - Run enrichment pipeline
 * - `muninn approve <operation-id>` - Approve a blocked operation
 */

import type { DatabaseAdapter } from "../database/adapter";
import { enrichWithResult, approveOperation, getEnrichmentEngine, initializeEnrichment } from "../enrichment";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Enrich Command
// ============================================================================

export async function handleEnrichCommand(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  args: string[]
): Promise<void> {
  const tool = args[0];
  const rawInput = args.slice(1).join(" ") || "{}";

  if (!tool) {
    console.error("Usage: muninn enrich <tool> [input]");
    console.error("");
    console.error("Run the context enrichment pipeline for a tool call.");
    console.error("");
    console.error("Tools: Read, Edit, Write, Bash, Glob, Grep");
    console.error("");
    console.error("Examples:");
    console.error('  muninn enrich Edit \'{"file_path": "src/index.ts"}\'');
    console.error('  muninn enrich Read \'{"file_path": "src/lib/auth.ts"}\'');
    console.error("");
    console.error("Options:");
    console.error("  --json     Output only JSON (no stderr)");
    console.error("  --verbose  Show detailed enricher output");
    return;
  }

  const verbose = args.includes("--verbose");
  const jsonOnly = args.includes("--json");

  // Initialize enrichment engine with built-in enrichers
  initializeEnrichment();

  // Run enrichment
  const result = await enrichWithResult(db, projectId, projectPath, tool, rawInput);

  if (verbose && !jsonOnly) {
    displayEnrichmentResult(result, tool, rawInput);
  }

  // Output the enrichment context
  if (result.context) {
    if (!jsonOnly) {
      console.error("\n--- Enrichment Context ---");
      console.error(result.context);
      console.error("--- End Context ---\n");
    }
  } else if (!jsonOnly) {
    console.error("No enrichment context generated (no relevant data found).");
  }

  outputJson({
    tool,
    context: result.context,
    totalTokens: result.totalTokens,
    enrichersUsed: result.enrichersUsed,
    blocked: result.blocked,
    metrics: result.metrics,
  });
}

function displayEnrichmentResult(
  result: import("../enrichment").EnrichmentResult,
  tool: string,
  input: string
): void {
  console.error("\n📊 Enrichment Result:\n");
  console.error(`Tool: ${tool}`);
  console.error(`Input: ${input.slice(0, 100)}${input.length > 100 ? "..." : ""}`);
  console.error("");

  if (result.blocked) {
    const icon = result.blocked.level === "hard" ? "🛑" : result.blocked.level === "soft" ? "⚠️" : "💡";
    console.error(`${icon} Blocked: ${result.blocked.level.toUpperCase()}`);
    console.error(`   Reason: ${result.blocked.reason}`);
    if (result.blocked.operationId) {
      console.error(`   Operation ID: ${result.blocked.operationId}`);
      console.error(`   To approve: muninn approve ${result.blocked.operationId}`);
    }
    console.error("");
  }

  console.error(`Enrichers Used: ${result.enrichersUsed.join(", ") || "(none)"}`);
  console.error(`Total Tokens: ~${result.totalTokens}`);
  console.error(`Latency: ${result.metrics.latencyMs.toFixed(1)}ms`);
  console.error(`Cache: ${result.metrics.cacheHits} hits, ${result.metrics.cacheMisses} misses`);
}

// ============================================================================
// Approve Command
// ============================================================================

export async function handleApproveCommand(
  db: DatabaseAdapter,
  args: string[]
): Promise<void> {
  const operationId = args[0];

  if (!operationId) {
    console.error("Usage: muninn approve <operation-id>");
    console.error("");
    console.error("Approve a blocked operation to proceed.");
    console.error("");
    console.error("Examples:");
    console.error("  muninn approve op_abc123");
    console.error("");
    console.error("Operation IDs are shown when an edit is blocked due to high fragility.");
    return;
  }

  // Get pending approval info first
  const pending = await db.get<{
    tool: string;
    file_path: string | null;
    reason: string;
    block_level: string;
    created_at: string;
    expires_at: string | null;
    approved_at: string | null;
  }>(
    "SELECT tool, file_path, reason, block_level, created_at, expires_at, approved_at FROM pending_approvals WHERE operation_id = ?",
    [operationId]
  );

  if (!pending) {
    console.error(`❌ Operation not found: ${operationId}`);
    console.error("");
    console.error("The operation may have expired or the ID may be incorrect.");
    outputJson({ success: false, error: "operation_not_found" });
    return;
  }

  if (pending.approved_at) {
    console.error(`✅ Operation already approved at ${pending.approved_at}`);
    outputJson({ success: true, alreadyApproved: true, approvedAt: pending.approved_at });
    return;
  }

  if (pending.expires_at && new Date(pending.expires_at) < new Date()) {
    console.error(`⏰ Operation expired at ${pending.expires_at}`);
    outputJson({ success: false, error: "operation_expired" });
    return;
  }

  // Approve the operation
  const success = await approveOperation(db, operationId);

  if (success) {
    console.error(`✅ Approved operation: ${operationId}`);
    console.error(`   Tool: ${pending.tool}`);
    if (pending.file_path) {
      console.error(`   File: ${pending.file_path}`);
    }
    console.error(`   Reason: ${pending.reason}`);
    console.error("");
    console.error("The blocked operation can now proceed.");

    outputSuccess({ operationId, approved: true });
  } else {
    console.error(`❌ Failed to approve operation: ${operationId}`);
    outputJson({ success: false, error: "approval_failed" });
  }
}

// ============================================================================
// Status Command (for debugging)
// ============================================================================

export async function handleEnrichmentStatusCommand(): Promise<void> {
  initializeEnrichment();
  const engine = getEnrichmentEngine();
  const status = engine.status();

  console.error("\n📊 Enrichment Engine Status:\n");

  console.error("Enrichers:");
  for (const e of status.enrichers) {
    const icon = e.enabled ? "✅" : "❌";
    console.error(`  ${icon} ${e.name} (priority: ${e.priority}, tools: ${e.tools.join(", ")})`);
  }
  console.error("");

  console.error("Cache:");
  console.error(`  Hits: ${status.cache.hits}`);
  console.error(`  Misses: ${status.cache.misses}`);
  console.error(`  Size: ${status.cache.size} entries`);
  console.error("");

  console.error("Configuration:");
  console.error(`  Token Budget: ${status.config.totalTokenBudget}`);
  console.error(`  Cache TTL: ${status.config.defaultCacheTtlMs}ms`);
  console.error(`  Fragility Thresholds: warn=${status.config.fragilityWarnThreshold}, soft=${status.config.fragilitySoftThreshold}, hard=${status.config.fragilityBlockThreshold}`);
  console.error("");

  outputJson(status);
}
