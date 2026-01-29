/**
 * Tests Enricher
 *
 * Injects related test files for the files being modified.
 */

import { BaseEnricher } from "../registry";
import type { EnricherOutput, EnrichmentContext, EnrichmentInput } from "../types";
import { testFileKey } from "../cache";
import { formatRelationsNative } from "../formatter";

interface TestFileInfo {
  testPath: string;
  sourcePath: string;
}

export class TestsEnricher extends BaseEnricher {
  constructor() {
    super({
      name: "tests",
      priority: 80,
      supportedTools: ["Edit", "Write"],
      tokenBudget: 30,
      enabled: true,
    });
  }

  async enrich(input: EnrichmentInput, ctx: EnrichmentContext): Promise<EnricherOutput | null> {
    if (!ctx.config.includeTestFiles) return null;

    const testFiles: TestFileInfo[] = [];
    const seenTests = new Set<string>();

    for (const filePath of input.files) {
      const cacheKey = testFileKey(input.projectId, filePath);

      // Try cache first
      let cached = ctx.cache.get<TestFileInfo[]>(cacheKey);

      if (!cached) {
        cached = await getTestFilesForSource(ctx, input.projectId, filePath);
        ctx.cache.set(cacheKey, cached, ctx.config.defaultCacheTtlMs);
      }

      for (const test of cached) {
        if (!seenTests.has(test.testPath)) {
          seenTests.add(test.testPath);
          testFiles.push(test);
        }
      }
    }

    if (testFiles.length === 0) return null;

    // Take top 3 test files
    const top = testFiles.slice(0, 3);

    const formatted = formatRelationsNative({
      tests: top.map((t) => t.testPath),
    });

    if (!formatted) return null;

    return this.output(formatted);
  }
}

async function getTestFilesForSource(
  ctx: EnrichmentContext,
  projectId: number,
  sourcePath: string
): Promise<TestFileInfo[]> {
  try {
    // Method 1: Via relationship graph
    const sourceFile = await ctx.db.get<{ id: number }>(
      "SELECT id FROM files WHERE project_id = ? AND path = ?",
      [projectId, sourcePath]
    );

    if (sourceFile) {
      const related = await ctx.db.all<{ path: string }>(
        `SELECT f.path FROM relationships r
         JOIN files f ON r.source_id = f.id AND r.source_type = 'file'
         WHERE r.target_type = 'file' AND r.target_id = ?
           AND r.relationship = 'tests'`,
        [sourceFile.id]
      );

      if (related.length > 0) {
        return related.map((r) => ({
          testPath: r.path,
          sourcePath,
        }));
      }
    }

    // Method 2: Via blast_radius table
    const blastTests = await ctx.db.all<{ affected_file: string }>(
      `SELECT affected_file FROM blast_radius
       WHERE project_id = ? AND source_file = ? AND is_test = 1
       ORDER BY distance ASC
       LIMIT 3`,
      [projectId, sourcePath]
    );

    if (blastTests.length > 0) {
      return blastTests.map((t) => ({
        testPath: t.affected_file,
        sourcePath,
      }));
    }

    // Method 3: Heuristic - look for common test patterns
    const testPatterns = [
      sourcePath.replace(/\.ts$/, ".test.ts"),
      sourcePath.replace(/\.ts$/, ".spec.ts"),
      sourcePath.replace(/\.tsx$/, ".test.tsx"),
      sourcePath.replace(/\.tsx$/, ".spec.tsx"),
      sourcePath.replace(/^src\//, "tests/"),
      sourcePath.replace(/^src\//, "__tests__/"),
    ];

    for (const pattern of testPatterns) {
      const exists = await ctx.db.get<{ path: string }>(
        "SELECT path FROM files WHERE project_id = ? AND path = ?",
        [projectId, pattern]
      );

      if (exists) {
        return [{ testPath: exists.path, sourcePath }];
      }
    }

    return [];
  } catch {
    return [];
  }
}
