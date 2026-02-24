/**
 * Analysis types — AnalysisResult, ShipCheck, Security, Quality, Performance, Growth, CodeReview
 */

// ============================================================================
// Analysis Types
// ============================================================================

export interface AnalysisResult {
  project: {
    type: string;
    stack: string[];
    description: string;
  };
  files: Array<{
    path: string;
    type: string;
    purpose: string;
    fragility: number;
    fragility_reason?: string;
    exports?: string[];
    key_functions?: string[];
  }>;
  decisions: Array<{
    title: string;
    decision: string;
    reasoning: string;
    affects: string[];
  }>;
  architecture: {
    patterns: string[];
    entry_points: string[];
    data_flow?: string;
  };
  potential_issues: Array<{
    title: string;
    description: string;
    severity: number;
    affected_files: string[];
  }>;
  tech_debt?: Array<{
    title: string;
    description: string;
    severity: number;
    effort: string;
    affected_files: string[];
  }>;
}

// ============================================================================
// Ship Checklist Types
// ============================================================================

export type ShipCheckStatus = "pass" | "fail" | "warn" | "skip";

export interface ShipCheck {
  name: string;
  status: ShipCheckStatus;
  message?: string;
}

// ============================================================================
// Security Types
// ============================================================================

export type SecuritySeverity = "critical" | "high" | "medium" | "low";

export interface SecurityFinding {
  type: string;
  severity: SecuritySeverity;
  line?: number;
  snippet?: string;
  description: string;
  recommendation: string;
}

export interface SecretFinding {
  type: string;
  line: number;
  snippet: string;
}

export interface AuditVulnerability {
  package: string;
  severity: string;
  title: string;
  url?: string;
  recommendation?: string;
}

// ============================================================================
// Quality Types
// ============================================================================

export interface QualityMetrics {
  cyclomaticComplexity: number;
  maxFunctionLength: number;
  functionCount: number;
  anyTypeCount: number;
  tsIgnoreCount: number;
  todoCount: number;
  lintErrors: number;
  lintWarnings: number;
  overallScore: number;
  issues: Array<{ type: string; message: string; line?: number }>;
}

// ============================================================================
// Performance Types
// ============================================================================

export type PerformanceSeverity = "high" | "medium" | "low";

export interface PerformanceFinding {
  type: string;
  severity: PerformanceSeverity;
  line?: number;
  snippet?: string;
  description: string;
  recommendation: string;
}

// ============================================================================
// Growth Types
// ============================================================================

export interface GrowthScore {
  overall: number;
  shareability: number;
  networkEffects: number;
  virality: number;
  suggestions: string[];
}

// ============================================================================
// Code Review Types
// ============================================================================

export interface CodeReviewResult {
  summary: string;
  score: number;
  issues: Array<{
    severity: "critical" | "high" | "medium" | "low";
    line: number | null;
    issue: string;
    suggestion: string;
  }>;
  positives: string[];
  refactor_suggestions: string[];
}

// ============================================================================
// Configuration
// ============================================================================

export interface EliteStack {
  runtime: string;
  language: string;
  frontend: string[];
  backend: string[];
  database: string[];
  styling: string[];
  validation: string;
  testing: string[];
  deployment: string[];
}

export const ELITE_STACK: EliteStack = {
  runtime: "Bun",
  language: "TypeScript (strict)",
  frontend: ["SvelteKit", "Next.js 15", "Astro"],
  backend: ["Go", "Hono", "tRPC"],
  database: ["Drizzle", "SQLite/Turso", "PostgreSQL/Neon"],
  styling: ["Tailwind", "CVA"],
  validation: "Zod",
  testing: ["Vitest", "Playwright"],
  deployment: ["Vercel", "Cloudflare Workers", "Docker"],
};
