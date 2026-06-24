/**
 * Muninn MCP Server - Input Validation Schemas
 *
 * v9: NaturalText for recall/remember/track — allows backticks, parens, etc.
 * Shell metacharacter validation only applies to passthrough args.
 */

import { z } from "zod";

// ============================================================================
// Security Patterns
// ============================================================================

/** Shell-dangerous characters — only used for passthrough CLI args */
const SHELL_DANGEROUS = /[`$(){}|;&<>\\]/;

/** Path traversal attacks */
const PATH_TRAVERSAL = /\.\./;

// ============================================================================
// Base Validators
// ============================================================================

/**
 * Safe port number (1-65535). Used by CLI and web server.
 */
export const SafePort = z.coerce
  .number()
  .int()
  .min(1, "Port must be >= 1")
  .max(65535, "Port must be <= 65535");

/**
 * Safe passthrough argument that rejects shell metacharacters.
 * Only used for the muninn passthrough tool.
 */
export const SafePassthroughArg = z
  .string()
  .max(500, "Argument too long (max 500 chars)")
  .refine((s) => !SHELL_DANGEROUS.test(s), {
    message: "Argument contains potentially dangerous characters: ` $ ( ) { } | ; & < > \\",
  });

/**
 * Natural text — allows everything except null bytes.
 * Used for v9 tools (recall, remember, track) which use parameterized SQL.
 * Shell injection is impossible — no CLI passthrough involved.
 */
export const NaturalText = z
  .string()
  .min(1, "Text cannot be empty")
  .max(10000, "Text too long (max 10000 chars)")
  .refine((s) => !s.includes("\0"), {
    message: "Null bytes not allowed",
  });

/**
 * Natural text for short fields (titles, queries)
 */
export const ShortNaturalText = z
  .string()
  .min(1, "Text cannot be empty")
  .max(1000, "Text too long (max 1000 chars)")
  .refine((s) => !s.includes("\0"), {
    message: "Null bytes not allowed",
  });

/**
 * Safe file path — rejects path traversal but allows natural characters.
 */
export const SafePath = z
  .string()
  .min(1, "Path cannot be empty")
  .max(500, "Path too long (max 500 chars)")
  .transform((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  })
  .refine((s) => !PATH_TRAVERSAL.test(s), {
    message: "Path traversal (..) not allowed",
  });

/**
 * Safe working directory path.
 */
export const SafeCwd = z
  .string()
  .max(500)
  .refine((s) => s.startsWith("/"), {
    message: "Working directory must be an absolute path",
  })
  .refine((s) => !PATH_TRAVERSAL.test(s), {
    message: "Path traversal (..) not allowed in cwd",
  })
  .refine((s) => !s.includes("\0"), {
    message: "Null bytes not allowed in path",
  })
  .optional();

// ============================================================================
// v9 Tool Schemas — Natural Text
// ============================================================================

/**
 * recall input validation
 */
export const RecallInput = z.object({
  files: z.array(SafePath).max(50).optional(),
  query: ShortNaturalText.optional(),
  task: ShortNaturalText.optional(),
  cwd: SafeCwd,
}).refine(
  (data) => data.files || data.query || data.task,
  {
    message:
      'recall needs exactly one mode — files: ["path.ts"] for pre-edit warnings, ' +
      'query: "search terms" to search memory, or task: "what you are planning" for planning context',
  },
);

/**
 * remember input validation
 */
export const RememberInput = z.object({
  content: NaturalText,
  type: z.enum(["decision", "learning"]).optional(),
  files: z.array(SafePath).max(20).optional(),
  id: z.number().int().positive().optional(),
  supersedes: z.number().int().positive().optional(),
  alternatives: z.array(ShortNaturalText).max(10).optional(),
  revisit_when: ShortNaturalText.optional(),
  durability: z.enum(["permanent", "project", "session"]).optional(),
  cwd: SafeCwd,
});

/**
 * track input validation
 */
export const TrackInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    title: ShortNaturalText,
    description: NaturalText.optional(),
    severity: z.number().int().min(1).max(10).optional(),
    type: z.enum(["bug", "debt", "security", "performance"]).optional(),
    files: z.array(SafePath).max(20).optional(),
    cwd: SafeCwd,
  }),
  z.object({
    action: z.literal("resolve"),
    id: z.number().int().positive(),
    resolution: ShortNaturalText,
    cwd: SafeCwd,
  }),
]);

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
  schema: z.ZodType<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues
    .map((e) => `${e.path.join(".") || "input"}: ${e.message}`)
    .join("; ");
  return {
    success: false,
    error: `Invalid input — fix and retry: ${errors}`,
  };
}
