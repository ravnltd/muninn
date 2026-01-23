/**
 * Validation utilities using Zod
 * Provides type-safe validation for CLI inputs and data
 */

import { z } from "zod";
import { parseArgs } from "util";
import type { ServerRole } from "../types";

// ============================================================================
// Reusable Schema Components
// ============================================================================

export const NonEmptyString = z.string().min(1);
export const OptionalString = z.string().optional();
export const PositiveInt = z.number().int().positive();
export const NonNegativeInt = z.number().int().nonnegative();
export const FragilityScore = z.number().int().min(0).max(10);
export const SeverityScore = z.number().int().min(1).max(10);

// ============================================================================
// Infrastructure Schemas
// ============================================================================

export const ServerRoleSchema = z.enum(['production', 'staging', 'homelab', 'development']);
export const ServerStatusSchema = z.enum(['online', 'offline', 'degraded', 'unknown']);
export const HealthStatusSchema = z.enum(['healthy', 'unhealthy', 'degraded', 'unknown']);
export const ServiceStatusSchema = z.enum(['running', 'stopped', 'error', 'unknown']);

export const ServerAddInput = z.object({
  name: NonEmptyString,
  ip: z.string().ip().optional(),
  hostname: OptionalString,
  role: ServerRoleSchema.optional(),
  user: z.string().default('root'),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  key: OptionalString,
  jump: OptionalString,
  os: OptionalString,
  tags: OptionalString,
  notes: OptionalString,
});

export type ServerAddInput = z.infer<typeof ServerAddInput>;

export const ServiceAddInput = z.object({
  name: NonEmptyString,
  server: NonEmptyString,
  type: z.enum(['app', 'database', 'cache', 'queue', 'proxy', 'static']).optional(),
  runtime: OptionalString,
  port: z.coerce.number().int().min(1).max(65535).optional(),
  health: OptionalString,
  project: OptionalString,
  repo: OptionalString,
  branch: z.string().default('main'),
  deploy: OptionalString,
  restart: OptionalString,
  stop: OptionalString,
  logs: OptionalString,
  env: OptionalString,
});

export type ServiceAddInput = z.infer<typeof ServiceAddInput>;

export const RouteAddInput = z.object({
  domain: NonEmptyString,
  service: NonEmptyString,
  path: z.string().default('/'),
  proxy: OptionalString,
  ssl: z.enum(['letsencrypt', 'cloudflare', 'self-signed', 'none']).optional(),
  notes: OptionalString,
});

export type RouteAddInput = z.infer<typeof RouteAddInput>;

export const DepAddInput = z.object({
  service: NonEmptyString,
  depends: OptionalString,
  external: OptionalString,
  type: z.enum(['database', 'cache', 'api', 'queue', 'auth', 'storage']).optional(),
  env: OptionalString,
  optional: z.boolean().default(false),
}).refine(data => data.depends || data.external, {
  message: "Either --depends or --external must be specified",
});

export type DepAddInput = z.infer<typeof DepAddInput>;

// ============================================================================
// File Schemas
// ============================================================================

export const FileTypeSchema = z.enum([
  'component', 'route', 'util', 'config', 'schema',
  'service', 'hook', 'middleware', 'test', 'other'
]);

export const FileStatusSchema = z.enum(['active', 'deprecated', 'do-not-touch', 'generated']);

export const FileAddInput = z.object({
  path: NonEmptyString,
  type: FileTypeSchema.optional(),
  purpose: OptionalString,
  fragility: z.coerce.number().int().min(0).max(10).default(0),
  fragilityReason: OptionalString,
  status: FileStatusSchema.default('active'),
});

export type FileAddInput = z.infer<typeof FileAddInput>;

// ============================================================================
// Decision Schemas
// ============================================================================

export const DecisionStatusSchema = z.enum(['active', 'superseded', 'reconsidering']);

export const DecisionAddInput = z.object({
  title: NonEmptyString,
  decision: NonEmptyString,
  reasoning: OptionalString,
  affects: OptionalString,
});

export type DecisionAddInput = z.infer<typeof DecisionAddInput>;

// ============================================================================
// Issue Schemas
// ============================================================================

export const IssueTypeSchema = z.enum(['bug', 'tech-debt', 'enhancement', 'question', 'potential']);
export const IssueStatusSchema = z.enum(['open', 'in-progress', 'resolved', 'wont-fix']);

export const IssueAddInput = z.object({
  title: NonEmptyString,
  description: OptionalString,
  type: IssueTypeSchema.default('bug'),
  severity: z.coerce.number().int().min(1).max(10).default(5),
  files: OptionalString,
  workaround: OptionalString,
});

export type IssueAddInput = z.infer<typeof IssueAddInput>;

// ============================================================================
// Learning Schemas
// ============================================================================

export const LearningCategorySchema = z.enum(['pattern', 'gotcha', 'preference', 'convention', 'architecture']);

export const LearnAddInput = z.object({
  category: LearningCategorySchema.default('pattern'),
  title: NonEmptyString,
  content: NonEmptyString,
  context: OptionalString,
  global: z.boolean().default(false),
});

export type LearnAddInput = z.infer<typeof LearnAddInput>;

// ============================================================================
// Pattern Schemas
// ============================================================================

export const PatternAddInput = z.object({
  name: NonEmptyString,
  description: NonEmptyString,
  example: OptionalString,
  anti: OptionalString,
  applies: OptionalString,
});

export type PatternAddInput = z.infer<typeof PatternAddInput>;

// ============================================================================
// Tech Debt Schemas
// ============================================================================

export const DebtEffortSchema = z.enum(['small', 'medium', 'large']);
export const DebtStatusSchema = z.enum(['open', 'in-progress', 'resolved']);

export const DebtAddInput = z.object({
  title: NonEmptyString,
  description: OptionalString,
  severity: z.coerce.number().int().min(1).max(10).default(5),
  effort: DebtEffortSchema.default('medium'),
  files: OptionalString,
});

export type DebtAddInput = z.infer<typeof DebtAddInput>;

// ============================================================================
// Session Schemas
// ============================================================================

export const SessionStartInput = z.object({
  goal: NonEmptyString,
});

export const SessionEndInput = z.object({
  id: z.coerce.number().int().positive(),
  outcome: OptionalString,
  files: OptionalString,
  learnings: OptionalString,
  next: OptionalString,
  success: z.coerce.number().int().min(0).max(2).optional(),
});

export type SessionStartInput = z.infer<typeof SessionStartInput>;
export type SessionEndInput = z.infer<typeof SessionEndInput>;

// ============================================================================
// CLI Argument Parsing Helpers
// ============================================================================

export interface ParsedArgs<T> {
  values: T;
  positionals: string[];
}

export function parseServerArgs(args: string[]): ParsedArgs<Partial<ServerAddInput>> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      ip: { type: "string" },
      hostname: { type: "string" },
      role: { type: "string" },
      user: { type: "string", default: "root" },
      port: { type: "string", default: "22" },
      key: { type: "string" },
      jump: { type: "string" },
      os: { type: "string" },
      tags: { type: "string" },
      notes: { type: "string" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      name: positionals[0],
      ip: values.ip,
      hostname: values.hostname,
      role: values.role as ServerRole | undefined,
      user: values.user || 'root',
      port: parseInt(values.port || '22'),
      key: values.key,
      jump: values.jump,
      os: values.os,
      tags: values.tags,
      notes: values.notes,
    },
    positionals,
  };
}

export function parseServiceArgs(args: string[]): ParsedArgs<Partial<ServiceAddInput>> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      server: { type: "string", short: "s" },
      type: { type: "string", short: "t" },
      runtime: { type: "string", short: "r" },
      port: { type: "string", short: "p" },
      health: { type: "string" },
      project: { type: "string" },
      repo: { type: "string" },
      branch: { type: "string", default: "main" },
      deploy: { type: "string" },
      restart: { type: "string" },
      stop: { type: "string" },
      logs: { type: "string" },
      env: { type: "string" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      name: positionals[0],
      server: values.server,
      type: values.type as ServiceAddInput['type'],
      runtime: values.runtime,
      port: values.port ? parseInt(values.port) : undefined,
      health: values.health,
      project: values.project,
      repo: values.repo,
      branch: values.branch || 'main',
      deploy: values.deploy,
      restart: values.restart,
      stop: values.stop,
      logs: values.logs,
      env: values.env,
    },
    positionals,
  };
}

export function parseRouteArgs(args: string[]): ParsedArgs<Partial<RouteAddInput>> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      service: { type: "string", short: "s" },
      path: { type: "string", default: "/" },
      proxy: { type: "string" },
      ssl: { type: "string" },
      notes: { type: "string" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      domain: positionals[0],
      service: values.service,
      path: values.path || '/',
      proxy: values.proxy,
      ssl: values.ssl as RouteAddInput['ssl'],
      notes: values.notes,
    },
    positionals,
  };
}

export function parseFileArgs(args: string[]): ParsedArgs<Partial<FileAddInput>> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      type: { type: "string", short: "t" },
      purpose: { type: "string", short: "p" },
      fragility: { type: "string", short: "f" },
      "fragility-reason": { type: "string" },
      status: { type: "string", short: "s" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      path: positionals[0],
      type: values.type as FileAddInput['type'],
      purpose: values.purpose,
      fragility: values.fragility ? parseInt(values.fragility) : 0,
      fragilityReason: values["fragility-reason"],
      status: values.status as FileAddInput['status'],
    },
    positionals,
  };
}

export function parseDecisionArgs(args: string[]): ParsedArgs<Partial<DecisionAddInput>> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      title: { type: "string", short: "t" },
      decision: { type: "string", short: "d" },
      reasoning: { type: "string", short: "r" },
      affects: { type: "string", short: "a" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      title: values.title,
      decision: values.decision,
      reasoning: values.reasoning,
      affects: values.affects,
    },
    positionals,
  };
}

export function parseIssueArgs(args: string[]): ParsedArgs<Partial<IssueAddInput>> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      title: { type: "string", short: "t" },
      description: { type: "string", short: "d" },
      type: { type: "string" },
      severity: { type: "string", short: "s" },
      files: { type: "string", short: "f" },
      workaround: { type: "string", short: "w" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      title: values.title,
      description: values.description,
      type: values.type as IssueAddInput['type'],
      severity: values.severity ? parseInt(values.severity) : 5,
      files: values.files,
      workaround: values.workaround,
    },
    positionals,
  };
}

export function parseLearnArgs(args: string[]): ParsedArgs<Partial<LearnAddInput>> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      category: { type: "string", short: "c" },
      title: { type: "string", short: "t" },
      content: { type: "string" },
      context: { type: "string" },
      global: { type: "boolean", short: "g" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      category: values.category as LearnAddInput['category'],
      title: values.title,
      content: values.content,
      context: values.context,
      global: values.global || false,
    },
    positionals,
  };
}

export function parsePatternArgs(args: string[]): ParsedArgs<Partial<PatternAddInput>> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      name: { type: "string", short: "n" },
      description: { type: "string", short: "d" },
      example: { type: "string", short: "e" },
      anti: { type: "string", short: "a" },
      applies: { type: "string" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      name: values.name,
      description: values.description,
      example: values.example,
      anti: values.anti,
      applies: values.applies,
    },
    positionals,
  };
}

export function parseDebtArgs(args: string[]): ParsedArgs<Partial<DebtAddInput>> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      title: { type: "string", short: "t" },
      description: { type: "string", short: "d" },
      severity: { type: "string", short: "s" },
      effort: { type: "string", short: "e" },
      files: { type: "string", short: "f" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      title: values.title,
      description: values.description,
      severity: values.severity ? parseInt(values.severity) : 5,
      effort: values.effort as DebtAddInput['effort'],
      files: values.files,
    },
    positionals,
  };
}

export function parseSessionEndArgs(args: string[]): ParsedArgs<Partial<SessionEndInput> & { analyze?: boolean }> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      outcome: { type: "string", short: "o" },
      files: { type: "string", short: "f" },
      learnings: { type: "string", short: "l" },
      next: { type: "string", short: "n" },
      success: { type: "string", short: "s" },
      analyze: { type: "boolean", short: "a" },
    },
    allowPositionals: true,
  });

  return {
    values: {
      id: positionals[0] ? parseInt(positionals[0]) : undefined,
      outcome: values.outcome,
      files: values.files,
      learnings: values.learnings,
      next: values.next,
      success: values.success ? parseInt(values.success) : undefined,
      analyze: values.analyze,
    },
    positionals,
  };
}
