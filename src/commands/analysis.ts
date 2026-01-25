/**
 * Analysis commands
 * Project analysis, code review, status display
 */

import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { closeGlobalDb, getGlobalDb } from "../database/connection";
import type { AnalysisResult, DiscoveredFile } from "../types";
import { ELITE_STACK } from "../types";
import { getApiKey, redactApiKeys } from "../utils/api-keys";
import { logError, safeJsonParse } from "../utils/errors";
import { computeContentHash, formatBrief, getFileMtime, outputJson } from "../utils/format";

// ============================================================================
// Constants
// ============================================================================

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".vue",
  ".svelte",
  ".astro",
  ".sql",
  ".graphql",
  ".prisma",
  ".css",
  ".scss",
  ".less",
  ".sh",
  ".bash",
  ".zsh",
]);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".svelte-kit",
  "__pycache__",
  ".pytest_cache",
  "target",
  "vendor",
  ".claude",
  ".vscode",
  ".idea",
  "coverage",
]);

const MAX_FILE_SIZE = 500 * 1024; // 500KB - files larger than this are skipped with warning
const CHUNK_SIZE = 8000; // ~8KB chunks for LLM context (balances detail vs token usage)

// ============================================================================
// File Discovery
// ============================================================================

interface DiscoveryResult {
  files: DiscoveredFile[];
  skippedLargeFiles: { path: string; size: number }[];
}

export function discoverFiles(projectPath: string, maxFiles: number = 100): DiscoveryResult {
  const files: DiscoveredFile[] = [];
  const skippedLargeFiles: { path: string; size: number }[] = [];

  function walk(dir: string, depth: number = 0): void {
    if (depth > 10 || files.length >= maxFiles) return;

    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        if (entry.startsWith(".") || IGNORE_DIRS.has(entry)) continue;

        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (stat.isFile()) {
          const ext = extname(entry);
          const relativePath = fullPath.replace(`${projectPath}/`, "");

          // Skip files larger than MAX_FILE_SIZE with warning
          if (stat.size > MAX_FILE_SIZE) {
            if (CODE_EXTENSIONS.has(ext)) {
              skippedLargeFiles.push({ path: relativePath, size: stat.size });
            }
            continue;
          }

          let fileType: DiscoveredFile["type"] = "other";
          if (CODE_EXTENSIONS.has(ext)) {
            fileType = "code";
          } else if ([".json", ".yaml", ".yml", ".toml", ".env"].includes(ext)) {
            fileType = "config";
          } else if ([".md", ".mdx", ".txt", ".rst"].includes(ext)) {
            fileType = "doc";
          }

          files.push({
            path: relativePath,
            type: fileType,
            size: stat.size,
          });
        }
      }
    } catch (error) {
      logError("discoverFiles:walk", error);
    }
  }

  walk(projectPath);
  return { files, skippedLargeFiles };
}

// ============================================================================
// Project Analysis
// ============================================================================

/**
 * Chunk a large file into smaller pieces for analysis
 * Returns array of chunks with position info
 */
function chunkFileContent(content: string, filePath: string): string[] {
  if (content.length <= CHUNK_SIZE) {
    return [`=== ${filePath} ===\n${content}`];
  }

  const chunks: string[] = [];
  const totalChunks = Math.ceil(content.length / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, content.length);
    const chunkContent = content.slice(start, end);
    chunks.push(`=== ${filePath} (chunk ${i + 1}/${totalChunks}) ===\n${chunkContent}`);
  }

  return chunks;
}

export async function runAnalysis(db: Database, projectId: number, projectPath: string): Promise<AnalysisResult> {
  console.error("🔍 Analyzing project...\n");

  const { files, skippedLargeFiles } = discoverFiles(projectPath, 100);
  console.error(`Found ${files.length} files to analyze\n`);

  // Warn about skipped large files
  if (skippedLargeFiles.length > 0) {
    console.error(`⚠️  Skipped ${skippedLargeFiles.length} file(s) exceeding 500KB limit:`);
    for (const { path, size } of skippedLargeFiles) {
      console.error(`   - ${path} (${Math.round(size / 1024)}KB)`);
    }
    console.error("");
  }

  // Read and chunk file contents for analysis
  const fileContents: string[] = [];
  let totalChunks = 0;

  for (const file of files.filter((f) => f.type === "code").slice(0, 30)) {
    try {
      const content = readFileSync(join(projectPath, file.path), "utf-8");
      const chunks = chunkFileContent(content, file.path);
      fileContents.push(...chunks);
      totalChunks += chunks.length;
    } catch {
      // Skip unreadable files
    }
  }

  if (totalChunks > files.filter((f) => f.type === "code").length) {
    console.error(
      `📄 Processing ${totalChunks} chunks from ${files.filter((f) => f.type === "code").length} code files\n`
    );
  }

  // Determine project type and stack
  const projectInfo = detectProjectType(projectPath);

  // Call LLM for deep analysis
  const analysis = await analyzeWithLLM(projectInfo, fileContents);

  // Store analysis results
  storeAnalysisResults(db, projectId, projectPath, analysis, files);

  console.error("✅ Analysis complete\n");

  return analysis;
}

function detectProjectType(projectPath: string): { type: string; stack: string[] } {
  const stack: string[] = [];
  let type = "unknown";

  // Check package.json
  try {
    const pkgPath = join(projectPath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.next) {
        type = "next";
        stack.push("Next.js");
      } else if (deps.svelte) {
        type = "svelte";
        stack.push("SvelteKit");
      } else if (deps.astro) {
        type = "astro";
        stack.push("Astro");
      } else if (deps.react) {
        type = "react";
        stack.push("React");
      } else if (deps.vue) {
        type = "vue";
        stack.push("Vue");
      } else if (deps.express || deps.hono) {
        type = "api";
        stack.push(deps.hono ? "Hono" : "Express");
      }

      if (deps.typescript) stack.push("TypeScript");
      if (deps.tailwindcss) stack.push("Tailwind");
      if (deps.drizzle) stack.push("Drizzle");
      if (deps.prisma) stack.push("Prisma");
      if (deps.zod) stack.push("Zod");
      if (deps.vitest) stack.push("Vitest");
    }
  } catch {
    // No package.json
  }

  // Check go.mod
  if (existsSync(join(projectPath, "go.mod"))) {
    type = "go";
    stack.push("Go");
  }

  // Check Cargo.toml
  if (existsSync(join(projectPath, "Cargo.toml"))) {
    type = "rust";
    stack.push("Rust");
  }

  return { type, stack };
}

async function analyzeWithLLM(
  projectInfo: { type: string; stack: string[] },
  fileContents: string[]
): Promise<AnalysisResult> {
  // Check API key availability using secure utility
  const keyResult = getApiKey("anthropic");

  if (!keyResult.ok) {
    console.error(`⚠️  ${keyResult.error.message}. Using basic analysis.\n`);
    return {
      project: {
        type: projectInfo.type,
        stack: projectInfo.stack,
        description: "Project analysis requires ANTHROPIC_API_KEY",
      },
      files: [],
      decisions: [],
      architecture: { patterns: [], entry_points: [] },
      potential_issues: [],
    };
  }

  const prompt = `Analyze this codebase and provide a structured analysis.

Project type: ${projectInfo.type}
Stack: ${projectInfo.stack.join(", ")}

Sample files:
${fileContents.join("\n\n").substring(0, 15000)}

Return a JSON object with this structure:
{
  "project": { "type": "string", "stack": ["strings"], "description": "brief description" },
  "files": [
    { "path": "file.ts", "type": "component|route|util|config|service|other", "purpose": "what it does", "fragility": 1-10, "fragility_reason": "why if > 5", "exports": ["name"], "key_functions": ["name"] }
  ],
  "decisions": [
    { "title": "string", "decision": "what was decided", "reasoning": "why", "affects": ["files"] }
  ],
  "architecture": { "patterns": ["string"], "entry_points": ["files"], "data_flow": "description" },
  "potential_issues": [
    { "title": "string", "description": "what's wrong", "severity": 1-10, "affected_files": ["files"] }
  ],
  "tech_debt": [
    { "title": "string", "description": "what needs fixing", "severity": 1-10, "effort": "small|medium|large", "affected_files": ["files"] }
  ]
}

Focus on:
- File purposes and relationships
- Architectural decisions implied by the code
- Fragile/complex areas (high fragility score)
- Potential issues (security, performance, maintainability)
- Tech debt that should be addressed`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": keyResult.value,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${redactApiKeys(errorText)}`);
    }

    const data = (await response.json()) as { content: Array<{ text: string }> };
    const text = data.content[0]?.text || "";

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<AnalysisResult>;
      // Ensure all required fields exist with defaults
      return {
        project: parsed.project || { type: projectInfo.type, stack: projectInfo.stack, description: "" },
        files: parsed.files || [],
        decisions: parsed.decisions || [],
        architecture: parsed.architecture || { patterns: [], entry_points: [] },
        potential_issues: parsed.potential_issues || [],
        tech_debt: parsed.tech_debt || [],
      };
    }

    throw new Error("No JSON in response");
  } catch (error) {
    // Ensure no key exposure in logs
    const safeError = error instanceof Error ? new Error(redactApiKeys(error.message)) : error;
    logError("analyzeWithLLM", safeError);
    return {
      project: {
        type: projectInfo.type,
        stack: projectInfo.stack,
        description: "Analysis failed",
      },
      files: [],
      decisions: [],
      architecture: { patterns: [], entry_points: [] },
      potential_issues: [],
    };
  }
}

function storeAnalysisResults(
  db: Database,
  projectId: number,
  projectPath: string,
  analysis: AnalysisResult,
  _discoveredFiles: DiscoveredFile[]
): void {
  // Update project info
  db.run(
    `
    UPDATE projects SET
      type = ?,
      stack = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    [analysis.project.type, JSON.stringify(analysis.project.stack), projectId]
  );

  // Store file analysis
  for (const file of analysis.files) {
    const fullPath = join(projectPath, file.path);
    let contentHash: string | null = null;
    let fsMtime: string | null = null;

    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        contentHash = computeContentHash(content);
        fsMtime = getFileMtime(fullPath);
      } catch {
        // Skip
      }
    }

    db.run(
      `
      INSERT INTO files (project_id, path, type, purpose, fragility, fragility_reason, exports, content_hash, fs_modified_at, last_analyzed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project_id, path) DO UPDATE SET
        type = excluded.type,
        purpose = excluded.purpose,
        fragility = excluded.fragility,
        fragility_reason = excluded.fragility_reason,
        exports = excluded.exports,
        content_hash = excluded.content_hash,
        fs_modified_at = excluded.fs_modified_at,
        last_analyzed = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `,
      [
        projectId,
        file.path,
        file.type,
        file.purpose,
        file.fragility,
        file.fragility_reason || null,
        file.exports ? JSON.stringify(file.exports) : null,
        contentHash,
        fsMtime,
      ]
    );
  }

  // Store decisions
  for (const decision of analysis.decisions) {
    db.run(
      `
      INSERT INTO decisions (project_id, title, decision, reasoning, affects)
      VALUES (?, ?, ?, ?, ?)
    `,
      [projectId, decision.title, decision.decision, decision.reasoning, JSON.stringify(decision.affects)]
    );
  }

  // Store issues
  for (const issue of analysis.potential_issues) {
    db.run(
      `
      INSERT INTO issues (project_id, title, description, type, severity, affected_files)
      VALUES (?, ?, ?, 'potential', ?, ?)
    `,
      [projectId, issue.title, issue.description, issue.severity, JSON.stringify(issue.affected_files)]
    );
  }

  // Store tech debt in global DB
  if (analysis.tech_debt && analysis.tech_debt.length > 0) {
    const globalDb = getGlobalDb();
    for (const debt of analysis.tech_debt) {
      globalDb.run(
        `
        INSERT INTO tech_debt (project_path, title, description, severity, effort, affected_files)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        [projectPath, debt.title, debt.description, debt.severity, debt.effort, JSON.stringify(debt.affected_files)]
      );
    }
    closeGlobalDb();
  }
}

// ============================================================================
// Status Commands
// ============================================================================

export function showStatus(db: Database, projectId: number): void {
  const project = db
    .query<Record<string, unknown>, [number]>(`
    SELECT * FROM v_project_state WHERE id = ?
  `)
    .get(projectId);

  const fragileFiles = db
    .query<Record<string, unknown>, [number]>(`
    SELECT path, fragility, fragility_reason FROM files
    WHERE project_id = ? AND fragility >= 5
    ORDER BY fragility DESC
    LIMIT 5
  `)
    .all(projectId);

  const openIssues = db
    .query<Record<string, unknown>, [number]>(`
    SELECT id, title, severity, type FROM issues
    WHERE project_id = ? AND status = 'open'
    ORDER BY severity DESC
    LIMIT 5
  `)
    .all(projectId);

  const recentDecisions = db
    .query<Record<string, unknown>, [number]>(`
    SELECT id, title, decided_at FROM decisions
    WHERE project_id = ? AND status = 'active'
    ORDER BY decided_at DESC
    LIMIT 3
  `)
    .all(projectId);

  // Display status
  if (project) {
    console.error("\n📊 Project Status:\n");
    console.error(`  Name: ${project.name}`);
    console.error(`  Type: ${project.type || "unknown"}`);
    console.error(`  Files: ${project.file_count || 0}`);
    console.error(`  Open Issues: ${project.open_issues || 0}`);
    console.error(`  Active Decisions: ${project.active_decisions || 0}`);
  }

  if (fragileFiles.length > 0) {
    console.error("\n⚠️ Fragile Files:");
    for (const f of fragileFiles) {
      console.error(`  - ${f.path} [${f.fragility}/10]`);
    }
  }

  if (openIssues.length > 0) {
    console.error("\n🐛 Open Issues:");
    for (const i of openIssues) {
      console.error(`  - #${i.id}: ${i.title} (sev ${i.severity})`);
    }
  }

  console.error("");

  outputJson({
    project,
    fragileFiles,
    openIssues,
    recentDecisions,
  });
}

export function showFragile(db: Database, projectId: number): void {
  const files = db
    .query<Record<string, unknown>, [number]>(`
    SELECT path, type, fragility, fragility_reason, status
    FROM files
    WHERE project_id = ? AND (fragility >= 5 OR status = 'do-not-touch')
    ORDER BY fragility DESC
  `)
    .all(projectId);

  if (files.length === 0) {
    console.error("No fragile files detected.");
  } else {
    console.error("\n⚠️ Fragile Files (handle with care):\n");
    for (const f of files) {
      const icon = (f.fragility as number) >= 8 ? "🔴" : (f.fragility as number) >= 6 ? "🟠" : "🟡";
      console.error(`  ${icon} ${f.path} [${f.fragility}/10]`);
      if (f.fragility_reason) {
        console.error(`     ${f.fragility_reason}`);
      }
    }
    console.error("");
  }

  outputJson(files);
}

// ============================================================================
// Brief & Resume
// ============================================================================

export function generateBrief(db: Database, projectId: number, projectPath: string): string {
  const project = db
    .query<{ name: string; type: string | null; stack: string | null }, [number]>(`
    SELECT name, type, stack FROM projects WHERE id = ?
  `)
    .get(projectId);

  const lastSession = db
    .query<Record<string, unknown>, [number]>(`
    SELECT goal, outcome, next_steps, ended_at, started_at
    FROM sessions
    WHERE project_id = ? AND ended_at IS NOT NULL
    ORDER BY ended_at DESC
    LIMIT 1
  `)
    .get(projectId);

  const fragileFiles = db
    .query<{ path: string; fragility: number; fragility_reason: string | null }, [number]>(`
    SELECT path, fragility, fragility_reason
    FROM files
    WHERE project_id = ? AND fragility >= 5
    ORDER BY fragility DESC
    LIMIT 5
  `)
    .all(projectId);

  const openIssues = db
    .query<{ id: number; title: string; severity: number }, [number]>(`
    SELECT id, title, severity
    FROM issues
    WHERE project_id = ? AND status = 'open' AND severity >= 5
    ORDER BY severity DESC
    LIMIT 5
  `)
    .all(projectId);

  const activeDecisions = db
    .query<{ id: number; title: string; decision: string }, [number]>(`
    SELECT id, title, decision
    FROM decisions
    WHERE project_id = ? AND status = 'active'
    ORDER BY decided_at DESC
    LIMIT 5
  `)
    .all(projectId);

  const globalDb = getGlobalDb();
  const patterns = globalDb
    .query<{ name: string; description: string }, []>(`
    SELECT name, description FROM patterns LIMIT 5
  `)
    .all();
  closeGlobalDb();

  return formatBrief({
    project: {
      name: project?.name || basename(projectPath),
      type: project?.type || undefined,
      stack: project?.stack ? safeJsonParse(project.stack, []) : undefined,
    },
    lastSession: lastSession
      ? {
          goal: lastSession.goal as string,
          outcome: lastSession.outcome as string | undefined,
          next_steps: lastSession.next_steps as string | undefined,
          ended_at: lastSession.ended_at as string | undefined,
          started_at: lastSession.started_at as string,
        }
      : undefined,
    fragileFiles: fragileFiles.map((f) => ({
      path: f.path,
      fragility: f.fragility,
      fragility_reason: f.fragility_reason || undefined,
    })),
    openIssues,
    activeDecisions,
    patterns,
  });
}

// ============================================================================
// Stack Command
// ============================================================================

export function showStack(): void {
  console.error("\n🛠️ Elite Stack:\n");
  console.error(`  Runtime:     ${ELITE_STACK.runtime}`);
  console.error(`  Language:    ${ELITE_STACK.language}`);
  console.error(`  Frontend:    ${ELITE_STACK.frontend.join(", ")}`);
  console.error(`  Backend:     ${ELITE_STACK.backend.join(", ")}`);
  console.error(`  Database:    ${ELITE_STACK.database.join(", ")}`);
  console.error(`  Styling:     ${ELITE_STACK.styling.join(", ")}`);
  console.error(`  Validation:  ${ELITE_STACK.validation}`);
  console.error(`  Testing:     ${ELITE_STACK.testing.join(", ")}`);
  console.error(`  Deployment:  ${ELITE_STACK.deployment.join(", ")}`);
  console.error("");

  outputJson(ELITE_STACK);
}
