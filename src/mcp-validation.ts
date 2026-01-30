/**
 * Muninn MCP Server - Input Validation Schemas
 *
 * Zod schemas for validating MCP tool inputs.
 * Rejects shell metacharacters to prevent injection attacks.
 */

import { z } from "zod";

// ============================================================================
// Security Patterns
// ============================================================================

/**
 * Characters that are dangerous in shell contexts.
 * These could be used for command injection if passed to a shell.
 */
const SHELL_DANGEROUS = /[`$(){}|;&<>\\]/;

/**
 * Pattern for path traversal attacks.
 */
const PATH_TRAVERSAL = /\.\./;

// ============================================================================
// Base Validators
// ============================================================================

/**
 * Safe port number (1-65535).
 */
export const SafePort = z.coerce
  .number()
  .int()
  .min(1, "Port must be >= 1")
  .max(65535, "Port must be <= 65535");

/**
 * Safe passthrough argument that rejects shell metacharacters.
 * Used to validate individual arguments in passthrough commands.
 */
export const SafePassthroughArg = z
  .string()
  .max(500, "Argument too long (max 500 chars)")
  .refine((s) => !SHELL_DANGEROUS.test(s), {
    message: "Argument contains potentially dangerous characters: ` $ ( ) { } | ; & < > \\",
  });

/**
 * Safe text that rejects shell metacharacters.
 * Use for titles, descriptions, queries, etc.
 */
export const SafeText = z
  .string()
  .min(1, "Text cannot be empty")
  .max(1000, "Text too long (max 1000 chars)")
  .refine((s) => !SHELL_DANGEROUS.test(s), {
    message: "Text contains potentially dangerous characters: ` $ ( ) { } | ; & < > \\",
  });

/**
 * Safe file path that rejects path traversal and shell metacharacters.
 * Decodes URL-encoded strings before checking to prevent bypass attempts.
 */
export const SafePath = z
  .string()
  .min(1, "Path cannot be empty")
  .max(500, "Path too long (max 500 chars)")
  .transform((s) => {
    // Decode URL-encoded characters to prevent bypass via %2e%2e
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  })
  .refine((s) => !PATH_TRAVERSAL.test(s), {
    message: "Path traversal (..) not allowed",
  })
  .refine((s) => !SHELL_DANGEROUS.test(s), {
    message: "Path contains potentially dangerous characters",
  });

/**
 * Longer content text (for descriptions, learnings, etc.)
 * Still rejects shell metacharacters but allows more length.
 */
export const ContentText = z
  .string()
  .max(10000, "Content too long (max 10000 chars)")
  .refine((s) => !SHELL_DANGEROUS.test(s), {
    message: "Content contains potentially dangerous characters",
  });

/**
 * Safe working directory path.
 */
export const SafeCwd = z
  .string()
  .max(500)
  .refine((s) => !PATH_TRAVERSAL.test(s), {
    message: "Path traversal (..) not allowed in cwd",
  })
  .optional();

// ============================================================================
// Tool-Specific Schemas
// ============================================================================

/**
 * muninn_query input validation
 */
export const QueryInput = z.object({
  query: SafeText,
  smart: z.boolean().optional(),
  vector: z.boolean().optional(),
  fts: z.boolean().optional(),
  cwd: SafeCwd,
});

/**
 * muninn_check input validation
 */
export const CheckInput = z.object({
  files: z.array(SafePath).min(1, "At least one file required").max(50, "Too many files (max 50)"),
  cwd: SafeCwd,
});

/**
 * muninn_file_add input validation
 */
export const FileAddInput = z.object({
  path: SafePath,
  purpose: SafeText,
  fragility: z.number().int().min(1).max(10),
  fragility_reason: SafeText.optional(),
  type: z
    .string()
    .max(50)
    .regex(/^[a-z-]+$/, "Type must be lowercase letters and hyphens only")
    .optional(),
  cwd: SafeCwd,
});

/**
 * muninn_decision_add input validation
 */
export const DecisionAddInput = z.object({
  title: SafeText,
  decision: ContentText,
  reasoning: ContentText,
  affects: z
    .string()
    .max(2000)
    .refine(
      (s) => {
        try {
          const parsed = JSON.parse(s);
          return Array.isArray(parsed) && parsed.every((p) => typeof p === "string");
        } catch {
          return false;
        }
      },
      { message: "affects must be a valid JSON array of strings" }
    )
    .optional(),
  cwd: SafeCwd,
});

/**
 * muninn_learn_add input validation
 */
export const LearnAddInput = z.object({
  title: SafeText,
  content: ContentText,
  category: z.enum(["pattern", "gotcha", "preference", "convention"]).optional(),
  context: SafeText.optional(),
  global: z.boolean().optional(),
  files: z
    .string()
    .max(2000)
    .refine(
      (s) => {
        try {
          const parsed = JSON.parse(s);
          return Array.isArray(parsed) && parsed.every((p) => typeof p === "string");
        } catch {
          return false;
        }
      },
      { message: "files must be a valid JSON array of strings" }
    )
    .optional(),
  foundational: z.boolean().optional(),
  reviewAfter: z.number().int().min(1).max(365).optional(),
  cwd: SafeCwd,
});

/**
 * muninn_issue input validation
 */
export const IssueInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    title: SafeText,
    description: ContentText.optional(),
    severity: z.number().int().min(1).max(10).optional(),
    type: z.enum(["bug", "potential", "security", "performance"]).optional(),
    cwd: SafeCwd,
  }),
  z.object({
    action: z.literal("resolve"),
    id: z.number().int().positive(),
    resolution: SafeText,
    cwd: SafeCwd,
  }),
]);

/**
 * muninn_session input validation
 */
export const SessionInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    goal: SafeText,
    cwd: SafeCwd,
  }),
  z.object({
    action: z.literal("end"),
    outcome: SafeText.optional(),
    next_steps: SafeText.optional(),
    success: z.number().int().min(0).max(2).optional(),
    cwd: SafeCwd,
  }),
]);

/**
 * muninn_predict input validation
 */
export const PredictInput = z.object({
  task: SafeText.optional(),
  files: z.array(SafePath).max(50).optional(),
  advise: z.boolean().optional(),
  cwd: SafeCwd,
});

/**
 * muninn_suggest input validation
 */
export const SuggestInput = z.object({
  task: SafeText,
  limit: z.number().int().min(1).max(100).optional(),
  includeSymbols: z.boolean().optional(),
  cwd: SafeCwd,
});

/**
 * muninn_enrich input validation
 */
export const EnrichInput = z.object({
  tool: z.enum(["Read", "Edit", "Write", "Bash", "Glob", "Grep"]),
  input: z.string().max(10000), // JSON string, validated separately
  cwd: SafeCwd,
});

/**
 * muninn_approve input validation
 */
export const ApproveInput = z.object({
  operationId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^op_[a-zA-Z0-9]+$/, "Invalid operation ID format (expected op_xxx)"),
  cwd: SafeCwd,
});

/**
 * muninn passthrough input validation
 */
export const PassthroughInput = z.object({
  command: z.string().min(1).max(2000),
  cwd: SafeCwd,
});

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Validate input against a schema and return a formatted error message.
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
  return { success: false, error: `Validation failed: ${errors}` };
}
