/**
 * Ship checklist command
 * Pre-deployment quality checks
 */

import type { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import type { ShipCheck } from "../types";
import { outputJson, formatShipCheck } from "../utils/format";
import { logError } from "../utils/errors";
import { getGlobalDb, closeGlobalDb } from "../database/connection";

// ============================================================================
// Ship Checklist
// ============================================================================

export async function runShipChecklist(
  db: Database,
  projectId: number,
  projectPath: string
): Promise<ShipCheck[]> {
  const checks: ShipCheck[] = [];

  // Check 1: TypeScript compilation
  checks.push(await checkTypeScript(projectPath));

  // Check 2: Tests pass
  checks.push(await checkTests(projectPath));

  // Check 3: Linting
  checks.push(await checkLint(projectPath));

  // Check 4: No critical issues
  checks.push(checkCriticalIssues(db, projectId));

  // Check 5: No high-fragility files modified
  checks.push(checkFragileFiles(db, projectId, projectPath));

  // Check 6: Build succeeds
  checks.push(await checkBuild(projectPath));

  // Check 7: No uncommitted changes
  checks.push(checkGitStatus(projectPath));

  // Check 8: Security scan (basic)
  checks.push(await checkSecurityBasic(projectPath));

  return checks;
}

// ============================================================================
// Individual Checks
// ============================================================================

async function checkTypeScript(projectPath: string): Promise<ShipCheck> {
  const tsconfigPath = join(projectPath, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    return { name: "TypeScript", status: "skip", message: "No tsconfig.json found" };
  }

  try {
    const result = Bun.spawnSync(["bun", "x", "tsc", "--noEmit"], {
      cwd: projectPath,
    });

    if (result.exitCode === 0) {
      return { name: "TypeScript", status: "pass" };
    } else {
      const errorCount = (result.stderr.toString().match(/error TS/g) || []).length;
      return {
        name: "TypeScript",
        status: "fail",
        message: `${errorCount} type error(s)`,
      };
    }
  } catch (error) {
    logError('checkTypeScript', error);
    return { name: "TypeScript", status: "warn", message: "Could not run tsc" };
  }
}

async function checkTests(projectPath: string): Promise<ShipCheck> {
  // Check for test runner
  const hasVitest = existsSync(join(projectPath, "vitest.config.ts")) ||
                    existsSync(join(projectPath, "vitest.config.js"));
  const hasJest = existsSync(join(projectPath, "jest.config.js")) ||
                  existsSync(join(projectPath, "jest.config.ts"));

  if (!hasVitest && !hasJest) {
    // Check package.json for test script
    try {
      const pkgJson = Bun.file(join(projectPath, "package.json"));
      const pkg = await pkgJson.json() as { scripts?: Record<string, string> };
      if (!pkg.scripts?.test || pkg.scripts.test.includes("no test")) {
        return { name: "Tests", status: "skip", message: "No test runner configured" };
      }
    } catch {
      return { name: "Tests", status: "skip", message: "No package.json found" };
    }
  }

  try {
    const testCmd = hasVitest ? ["bun", "x", "vitest", "run"] : ["bun", "test"];
    const result = Bun.spawnSync(testCmd, {
      cwd: projectPath,
      timeout: 60000,
    });

    if (result.exitCode === 0) {
      return { name: "Tests", status: "pass" };
    } else {
      return { name: "Tests", status: "fail", message: "Tests failed" };
    }
  } catch (error) {
    logError('checkTests', error);
    return { name: "Tests", status: "warn", message: "Could not run tests" };
  }
}

async function checkLint(projectPath: string): Promise<ShipCheck> {
  const hasEslint = existsSync(join(projectPath, ".eslintrc.js")) ||
                    existsSync(join(projectPath, ".eslintrc.json")) ||
                    existsSync(join(projectPath, "eslint.config.js"));
  const hasBiome = existsSync(join(projectPath, "biome.json"));

  if (!hasEslint && !hasBiome) {
    return { name: "Lint", status: "skip", message: "No linter configured" };
  }

  try {
    const lintCmd = hasBiome
      ? ["bun", "x", "biome", "check", "."]
      : ["bun", "x", "eslint", "."];

    const result = Bun.spawnSync(lintCmd, {
      cwd: projectPath,
      timeout: 60000,
    });

    if (result.exitCode === 0) {
      return { name: "Lint", status: "pass" };
    } else {
      const output = result.stderr.toString() + result.stdout.toString();
      const errorCount = (output.match(/error/gi) || []).length;
      return {
        name: "Lint",
        status: errorCount > 10 ? "fail" : "warn",
        message: `${errorCount} issue(s)`,
      };
    }
  } catch (error) {
    logError('checkLint', error);
    return { name: "Lint", status: "warn", message: "Could not run linter" };
  }
}

function checkCriticalIssues(db: Database, projectId: number): ShipCheck {
  const criticalCount = db.query<{ count: number }, [number]>(`
    SELECT COUNT(*) as count FROM issues
    WHERE project_id = ? AND status = 'open' AND severity >= 8
  `).get(projectId)?.count || 0;

  if (criticalCount > 0) {
    return {
      name: "Critical Issues",
      status: "fail",
      message: `${criticalCount} critical issue(s) open`,
    };
  }

  const highCount = db.query<{ count: number }, [number]>(`
    SELECT COUNT(*) as count FROM issues
    WHERE project_id = ? AND status = 'open' AND severity >= 6
  `).get(projectId)?.count || 0;

  if (highCount > 0) {
    return {
      name: "Critical Issues",
      status: "warn",
      message: `${highCount} high-severity issue(s) open`,
    };
  }

  return { name: "Critical Issues", status: "pass" };
}

function checkFragileFiles(db: Database, projectId: number, projectPath: string): ShipCheck {
  // Get git status for modified files
  const gitResult = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: projectPath });

  if (gitResult.exitCode !== 0) {
    return { name: "Fragile Files", status: "skip", message: "Not a git repo" };
  }

  const modifiedFiles = gitResult.stdout.toString()
    .split("\n")
    .filter(line => line.startsWith(" M") || line.startsWith("M "))
    .map(line => line.substring(3));

  if (modifiedFiles.length === 0) {
    return { name: "Fragile Files", status: "pass" };
  }

  // Check if any modified files are fragile
  const placeholders = modifiedFiles.map(() => "?").join(",");
  const fragileModified = db.query<{ path: string; fragility: number }, (number | string)[]>(`
    SELECT path, fragility FROM files
    WHERE project_id = ? AND fragility >= 7 AND path IN (${placeholders})
  `).all(projectId, ...modifiedFiles);

  if (fragileModified.length > 0) {
    return {
      name: "Fragile Files",
      status: "warn",
      message: `${fragileModified.length} fragile file(s) modified: ${fragileModified.map(f => f.path).join(", ")}`,
    };
  }

  return { name: "Fragile Files", status: "pass" };
}

async function checkBuild(projectPath: string): Promise<ShipCheck> {
  // Check for build script in package.json
  try {
    const pkgJson = Bun.file(join(projectPath, "package.json"));
    const pkg = await pkgJson.json() as { scripts?: Record<string, string> };

    if (!pkg.scripts?.build) {
      return { name: "Build", status: "skip", message: "No build script" };
    }
  } catch {
    return { name: "Build", status: "skip", message: "No package.json" };
  }

  try {
    const result = Bun.spawnSync(["bun", "run", "build"], {
      cwd: projectPath,
      timeout: 120000,
    });

    if (result.exitCode === 0) {
      return { name: "Build", status: "pass" };
    } else {
      return { name: "Build", status: "fail", message: "Build failed" };
    }
  } catch (error) {
    logError('checkBuild', error);
    return { name: "Build", status: "warn", message: "Could not run build" };
  }
}

function checkGitStatus(projectPath: string): ShipCheck {
  const result = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: projectPath });

  if (result.exitCode !== 0) {
    return { name: "Git Status", status: "skip", message: "Not a git repo" };
  }

  const changes = result.stdout.toString().trim();

  if (!changes) {
    return { name: "Git Status", status: "pass" };
  }

  const lineCount = changes.split("\n").length;
  return {
    name: "Git Status",
    status: "warn",
    message: `${lineCount} uncommitted change(s)`,
  };
}

async function checkSecurityBasic(projectPath: string): Promise<ShipCheck> {
  // Run npm/bun audit
  try {
    const result = Bun.spawnSync(["bun", "pm", "audit"], { cwd: projectPath });

    if (result.exitCode === 0) {
      return { name: "Security Audit", status: "pass" };
    } else {
      const output = result.stderr.toString() + result.stdout.toString();
      const criticalMatch = output.match(/(\d+)\s+critical/i);
      const highMatch = output.match(/(\d+)\s+high/i);

      const criticalCount = criticalMatch ? parseInt(criticalMatch[1]) : 0;
      const highCount = highMatch ? parseInt(highMatch[1]) : 0;

      if (criticalCount > 0) {
        return {
          name: "Security Audit",
          status: "fail",
          message: `${criticalCount} critical vulnerabilities`,
        };
      }

      if (highCount > 0) {
        return {
          name: "Security Audit",
          status: "warn",
          message: `${highCount} high vulnerabilities`,
        };
      }

      return { name: "Security Audit", status: "pass" };
    }
  } catch (error) {
    logError('checkSecurityBasic', error);
    return { name: "Security Audit", status: "skip", message: "Could not run audit" };
  }
}

// ============================================================================
// Ship Command Handler
// ============================================================================

export async function handleShipCommand(
  db: Database,
  projectId: number,
  projectPath: string
): Promise<void> {
  console.error("🚀 Running ship checklist...\n");

  const checks = await runShipChecklist(db, projectId, projectPath);

  const passed = checks.filter(c => c.status === "pass").length;
  const failed = checks.filter(c => c.status === "fail").length;
  const warned = checks.filter(c => c.status === "warn").length;

  for (const check of checks) {
    console.error(formatShipCheck(check));
  }

  console.error("");

  if (failed > 0) {
    console.error(`❌ Ship blocked: ${failed} check(s) failed`);
  } else if (warned > 0) {
    console.error(`⚠️ Ship with caution: ${warned} warning(s)`);
  } else {
    console.error(`✅ Clear to ship!`);
  }

  // Log to global DB
  const globalDb = getGlobalDb();
  globalDb.run(`
    INSERT INTO ship_history (project_path, checks_passed, checks_failed, notes)
    VALUES (?, ?, ?, ?)
  `, [
    projectPath,
    JSON.stringify(checks.filter(c => c.status === "pass").map(c => c.name)),
    JSON.stringify(checks.filter(c => c.status !== "pass").map(c => ({ name: c.name, status: c.status, message: c.message }))),
    failed > 0 ? "blocked" : warned > 0 ? "shipped with warnings" : "clean ship",
  ]);
  closeGlobalDb();

  outputJson({ passed, failed, warned, checks });
}
