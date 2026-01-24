/**
 * Embedding CLI commands
 * Manage vector embeddings for semantic search
 */

import type { Database } from "bun:sqlite";
import { outputJson, outputSuccess } from "../utils/format";
import { getProvider, isEmbeddingAvailable, generateEmbedding, getDimensions } from "../embeddings";
import { getEmbeddingStats, backfillAll, backfillTable } from "../database/queries/vector";

// ============================================================================
// Main Command Handler
// ============================================================================

export async function handleEmbedCommand(
  db: Database,
  projectId: number,
  args: string[]
): Promise<void> {
  const subCommand = args[0];
  const subArgs = args.slice(1);

  switch (subCommand) {
    case "status":
      showEmbedStatus(db, projectId);
      break;

    case "backfill":
      await runBackfill(db, projectId, subArgs);
      break;

    case "test":
      await testEmbedding(subArgs.join(" "));
      break;

    default:
      console.error(`Usage: muninn embed <status|backfill|test>

Commands:
  status              Show embedding coverage statistics
  backfill [table]    Generate missing embeddings (optional: files|decisions|issues|learnings)
  test "text"         Test embedding generation for a text string
`);
  }
}

// ============================================================================
// Status Command
// ============================================================================

function showEmbedStatus(db: Database, projectId: number): void {
  const provider = getProvider();
  const available = isEmbeddingAvailable();
  const dimensions = getDimensions();
  const stats = getEmbeddingStats(db, projectId);

  console.error("\n📊 Embedding Status\n");
  console.error(`Provider: ${provider} (${dimensions}-dim)`);
  console.error(`Available: ${available ? "✅ Yes" : "❌ No"}`);
  if (provider === "local") {
    console.error(`Model: all-MiniLM-L6-v2 (offline, no API key needed)`);
  } else {
    console.error(`Model: voyage-3-lite (cloud, VOYAGE_API_KEY set)`);
  }
  console.error("");

  if (stats.length === 0) {
    console.error("No records found in database.");
  } else {
    console.error("Coverage by Table:");
    console.error("─".repeat(45));

    let totalRecords = 0;
    let totalWithEmb = 0;

    for (const stat of stats) {
      const bar = createProgressBar(stat.coverage, 20);
      console.error(
        `  ${stat.table.padEnd(12)} ${bar} ${stat.withEmbedding}/${stat.total} (${stat.coverage}%)`
      );
      totalRecords += stat.total;
      totalWithEmb += stat.withEmbedding;
    }

    console.error("─".repeat(45));
    const totalCoverage = totalRecords > 0 ? Math.round((totalWithEmb / totalRecords) * 100) : 0;
    console.error(`  ${"Total".padEnd(12)} ${createProgressBar(totalCoverage, 20)} ${totalWithEmb}/${totalRecords} (${totalCoverage}%)`);
  }

  console.error("");

  if (stats.some((s) => s.coverage < 100)) {
    console.error("💡 Run 'muninn embed backfill' to generate missing embeddings.");
  }
  if (provider === "local") {
    console.error("💡 Set VOYAGE_API_KEY for higher quality embeddings (512-dim).");
  }

  console.error("");

  outputJson({
    provider,
    available,
    dimensions: getDimensions(),
    stats,
  });
}

function createProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
}

// ============================================================================
// Backfill Command
// ============================================================================

async function runBackfill(db: Database, projectId: number, args: string[]): Promise<void> {
  if (!isEmbeddingAvailable()) {
    console.error("❌ No embedding provider available.");
    process.exit(1);
  }

  const targetTable = args[0];
  const validTables = ["files", "decisions", "issues", "learnings"];

  if (targetTable && !validTables.includes(targetTable)) {
    console.error(`❌ Invalid table: ${targetTable}`);
    console.error(`   Valid tables: ${validTables.join(", ")}`);
    process.exit(1);
  }

  console.error("\n🔄 Generating embeddings...\n");

  if (targetTable) {
    // Backfill single table
    const updated = await backfillTable(db, targetTable, projectId, (current, total) => {
      const percent = Math.round((current / total) * 100);
      process.stderr.write(`\r  ${targetTable}: ${current}/${total} (${percent}%)`);
    });

    console.error(""); // New line after progress
    console.error(`\n✅ Updated ${updated} records in ${targetTable}`);

    outputSuccess({ table: targetTable, updated });
  } else {
    // Backfill all tables
    const results = await backfillAll(db, projectId, (table, current, total) => {
      const percent = Math.round((current / total) * 100);
      process.stderr.write(`\r  ${table}: ${current}/${total} (${percent}%)`);
    });

    console.error(""); // New line after progress
    console.error("\n✅ Backfill complete:");

    let totalUpdated = 0;
    for (const [table, count] of Object.entries(results)) {
      console.error(`   ${table}: ${count} records`);
      totalUpdated += count;
    }
    console.error(`   Total: ${totalUpdated} records`);

    outputSuccess(results);
  }
}

// ============================================================================
// Test Command
// ============================================================================

async function testEmbedding(text: string): Promise<void> {
  if (!text) {
    console.error("Usage: muninn embed test \"your text here\"");
    process.exit(1);
  }

  if (!isEmbeddingAvailable()) {
    console.error("❌ No embedding provider available.");
    process.exit(1);
  }

  console.error(`\n🧪 Testing embedding generation...\n`);
  console.error(`Text: "${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"`);
  console.error("");

  const startTime = Date.now();
  const embedding = await generateEmbedding(text);
  const duration = Date.now() - startTime;

  if (!embedding) {
    console.error("❌ Failed to generate embedding");
    process.exit(1);
  }

  console.error(`✅ Embedding generated successfully`);
  console.error(`   Dimensions: ${embedding.length}`);
  console.error(`   Duration: ${duration}ms`);
  console.error(`   First 5 values: [${Array.from(embedding.slice(0, 5)).map(v => v.toFixed(4)).join(", ")}...]`);

  // Calculate some stats
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of embedding) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / embedding.length;

  console.error(`   Min: ${min.toFixed(4)}, Max: ${max.toFixed(4)}, Mean: ${mean.toFixed(4)}`);
  console.error("");

  outputJson({
    text: text.substring(0, 100),
    dimensions: embedding.length,
    duration,
    stats: { min, max, mean },
    sample: Array.from(embedding.slice(0, 10)),
  });
}
