/**
 * Test Result Tracker — Run tests after commits and record outcomes
 *
 * Discovers the project's test command from package.json.
 * Rate-limited: max 1 run per 5 minutes to avoid CPU waste.
 * Records pass/fail, duration, and output summary.
 *
 * Runs in background worker — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// Types
// ============================================================================

export type TestStatus = "passed" | "failed" | "error" | "skipped" | "unknown";

export interface TestResult {
  status: TestStatus;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  outputSummary: string;
}

// ============================================================================
// Constants
// ============================================================================

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes
const TEST_TIMEOUT_MS = 120 * 1000; // 2 minutes max

// ============================================================================
// Test Command Discovery
// ============================================================================

/** Discover the test command from package.json */
export function discoverTestCommand(projectPath: string): string | null {
  const pkgPath = join(projectPath, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (!scripts) return null;

    // Prefer: test, test:unit, test:ci
    if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
      return scripts.test;
    }
    if (scripts["test:unit"]) return scripts["test:unit"];
    if (scripts["test:ci"]) return scripts["test:ci"];

    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Test Runner
// ============================================================================

/** Validate test command against known-safe patterns */
function isAllowedTestCommand(cmd: string): boolean {
  // Allow only known test runner patterns — no shell metacharacters
  const ALLOWED_PREFIXES = [
    "bun test", "bun run test", "bunx vitest",
    "npm test", "npm run test", "npx vitest", "npx jest",
    "pnpm test", "pnpm run test", "pnpm exec vitest",
    "yarn test", "yarn run test",
    "vitest", "jest", "mocha", "ava", "tap",
    "cargo test", "go test", "pytest", "python -m pytest",
  ];
  const trimmed = cmd.trim();
  return ALLOWED_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Run the test command and parse results */
export async function runTests(
  projectPath: string,
  testCommand: string
): Promise<TestResult> {
  const start = Date.now();

  // Reject commands with shell metacharacters or unknown patterns
  if (!isAllowedTestCommand(testCommand)) {
    return {
      status: "skipped",
      totalTests: 0, passed: 0, failed: 0, skipped: 0,
      durationMs: 0,
      outputSummary: "Test command rejected: not a recognized test runner pattern",
    };
  }

  try {
    // Split command into args instead of using sh -c to prevent injection
    const parts = testCommand.trim().split(/\s+/);
    const proc = Bun.spawn(parts, {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CI: "true", NODE_ENV: "test" },
    });

    // Race against timeout
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => {
        proc.kill();
        resolve(null);
      }, TEST_TIMEOUT_MS)
    );

    const exitResult = Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const result = await Promise.race([exitResult, timeout]);
    const durationMs = Date.now() - start;

    if (!result) {
      return {
        status: "error",
        totalTests: 0, passed: 0, failed: 0, skipped: 0,
        durationMs,
        outputSummary: "Test run timed out after 2 minutes",
      };
    }

    const [stdout, stderr, exitCode] = result;
    const output = `${stdout}\n${stderr}`.trim();
    const summary = output.slice(-500);

    // Parse test counts from output
    const counts = parseTestOutput(output);

    return {
      status: exitCode === 0 ? "passed" : "failed",
      totalTests: counts.total,
      passed: counts.passed,
      failed: counts.failed,
      skipped: counts.skipped,
      durationMs,
      outputSummary: summary,
    };
  } catch (error) {
    return {
      status: "error",
      totalTests: 0, passed: 0, failed: 0, skipped: 0,
      durationMs: Date.now() - start,
      outputSummary: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Parse test counts from various test runner output formats */
function parseTestOutput(output: string): {
  total: number; passed: number; failed: number; skipped: number;
} {
  let total = 0, passed = 0, failed = 0, skipped = 0;

  // Bun test format: "592 pass\n 0 fail\n 1 skip"
  const bunPass = output.match(/(\d+)\s+pass/);
  const bunFail = output.match(/(\d+)\s+fail/);
  const bunSkip = output.match(/(\d+)\s+skip/);
  if (bunPass) {
    passed = parseInt(bunPass[1], 10);
    failed = bunFail ? parseInt(bunFail[1], 10) : 0;
    skipped = bunSkip ? parseInt(bunSkip[1], 10) : 0;
    total = passed + failed + skipped;
    return { total, passed, failed, skipped };
  }

  // Jest/Vitest format: "Tests: 5 passed, 2 failed, 7 total"
  const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(\d+)\s+total/);
  if (jestMatch) {
    passed = jestMatch[1] ? parseInt(jestMatch[1], 10) : 0;
    failed = jestMatch[2] ? parseInt(jestMatch[2], 10) : 0;
    total = parseInt(jestMatch[3], 10);
    skipped = total - passed - failed;
    return { total, passed, failed, skipped };
  }

  // Generic: count "PASS" and "FAIL" lines
  const passLines = (output.match(/\bPASS\b/g) || []).length;
  const failLines = (output.match(/\bFAIL\b/g) || []).length;
  if (passLines + failLines > 0) {
    passed = passLines;
    failed = failLines;
    total = passed + failed;
  }

  return { total, passed, failed, skipped };
}

// ============================================================================
// Rate Limiting
// ============================================================================

/** Check if enough time has passed since last test run */
export async function canRunTests(
  db: DatabaseAdapter,
  projectId: number
): Promise<boolean> {
  try {
    const lastRun = await db.get<{ created_at: string }>(
      `SELECT created_at FROM test_results
       WHERE project_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );

    if (!lastRun) return true;

    const elapsed = Date.now() - new Date(lastRun.created_at).getTime();
    return elapsed >= RATE_LIMIT_MS;
  } catch {
    return true;
  }
}

// ============================================================================
// Persistence
// ============================================================================

/** Store test result in the database */
export async function storeTestResult(
  db: DatabaseAdapter,
  projectId: number,
  commitHash: string | null,
  sessionId: number | null,
  testCommand: string,
  result: TestResult
): Promise<void> {
  await db.run(
    `INSERT INTO test_results (project_id, commit_hash, session_id, test_command, status, total_tests, passed, failed, skipped, duration_ms, output_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      commitHash,
      sessionId,
      testCommand,
      result.status,
      result.totalTests,
      result.passed,
      result.failed,
      result.skipped,
      result.durationMs,
      result.outputSummary,
    ]
  );
}

/** Get recent test results */
export async function getRecentTestResults(
  db: DatabaseAdapter,
  projectId: number,
  limit: number = 10
): Promise<Array<{
  status: TestStatus;
  total_tests: number;
  passed: number;
  failed: number;
  duration_ms: number;
  commit_hash: string | null;
  created_at: string;
}>> {
  return db.all(
    `SELECT status, total_tests, passed, failed, duration_ms, commit_hash, created_at
     FROM test_results
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [projectId, limit]
  );
}

// ============================================================================
// Entry Point
// ============================================================================

/**
 * Run tests for a project after a commit.
 * Checks rate limit, discovers test command, runs, and stores result.
 */
export async function runTestsAfterCommit(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  commitHash: string | null,
  sessionId: number | null
): Promise<TestResult | null> {
  // Rate limit check
  const allowed = await canRunTests(db, projectId);
  if (!allowed) return null;

  // Discover test command
  const testCommand = discoverTestCommand(projectPath);
  if (!testCommand) return null;

  // Run tests
  const result = await runTests(projectPath, testCommand);

  // Store result
  await storeTestResult(db, projectId, commitHash, sessionId, testCommand, result);

  return result;
}
