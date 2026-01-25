/**
 * Drizzle ORM Schema
 * Type-safe database schema - single source of truth
 *
 * Note: FTS5 virtual tables are not supported by Drizzle and remain as raw SQL
 */

import { sql } from "drizzle-orm";
import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ============================================================================
// CORE TABLES
// ============================================================================

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").unique().notNull(),
  name: text("name").notNull(),
  type: text("type"),
  stack: text("stack"), // JSON array
  status: text("status", { enum: ["active", "maintenance", "archived"] }).default("active"),
  mode: text("mode", { enum: ["exploring", "building", "hardening", "shipping", "maintaining"] }).default("exploring"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const files = sqliteTable(
  "files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    type: text("type"),
    purpose: text("purpose"),
    exports: text("exports"), // JSON array
    dependencies: text("dependencies"), // JSON array
    dependents: text("dependents"), // JSON array
    fragility: integer("fragility").default(0),
    fragilityReason: text("fragility_reason"),
    status: text("status", { enum: ["active", "deprecated", "do-not-touch", "generated"] }).default("active"),
    lastModified: text("last_modified"),
    lastAnalyzed: text("last_analyzed"),
    embedding: blob("embedding"),
    contentHash: text("content_hash"),
    fsModifiedAt: text("fs_modified_at"),
    lastQueriedAt: text("last_queried_at"),
    temperature: text("temperature").default("cold"),
    lastReferencedAt: text("last_referenced_at"),
    velocityScore: real("velocity_score").default(0.0),
    changeCount: integer("change_count").default(0),
    firstChangedAt: text("first_changed_at"),
    archivedAt: text("archived_at"),
    consolidatedInto: integer("consolidated_into"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_files_project").on(table.projectId),
    index("idx_files_type").on(table.type),
    index("idx_files_status").on(table.status),
    index("idx_files_fragility").on(table.fragility),
    index("idx_files_project_fragility").on(table.projectId, table.fragility),
    uniqueIndex("idx_files_project_path").on(table.projectId, table.path),
    index("idx_files_archived").on(table.archivedAt),
  ]
);

export const symbols = sqliteTable(
  "symbols",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    signature: text("signature"),
    purpose: text("purpose"),
    parameters: text("parameters"), // JSON
    returns: text("returns"),
    sideEffects: text("side_effects"), // JSON array
    callers: text("callers"), // JSON array
    calls: text("calls"), // JSON array
    complexity: integer("complexity").default(0),
    embedding: blob("embedding"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_symbols_file").on(table.fileId),
    index("idx_symbols_type").on(table.type),
    index("idx_symbols_name").on(table.name),
  ]
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    decision: text("decision").notNull(),
    reasoning: text("reasoning"),
    alternatives: text("alternatives"), // JSON array
    consequences: text("consequences"), // JSON array
    affects: text("affects"), // JSON array
    status: text("status", { enum: ["active", "superseded", "reconsidering"] }).default("active"),
    supersededBy: integer("superseded_by"),
    invariant: text("invariant"),
    constraintType: text("constraint_type", { enum: ["must_hold", "should_hold", "nice_to_have"] }).default(
      "should_hold"
    ),
    decidedAt: text("decided_at").default(sql`CURRENT_TIMESTAMP`),
    embedding: blob("embedding"),
    temperature: text("temperature").default("cold"),
    lastReferencedAt: text("last_referenced_at"),
    outcomeStatus: text("outcome_status").default("pending"),
    outcomeNotes: text("outcome_notes"),
    outcomeAt: text("outcome_at"),
    checkAfterSessions: integer("check_after_sessions").default(5),
    sessionsSince: integer("sessions_since").default(0),
    archivedAt: text("archived_at"),
    consolidatedInto: integer("consolidated_into"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_decisions_project").on(table.projectId),
    index("idx_decisions_status").on(table.status),
    index("idx_decisions_project_status").on(table.projectId, table.status),
    index("idx_decisions_archived").on(table.archivedAt),
  ]
);

export const issues = sqliteTable(
  "issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    type: text("type", { enum: ["bug", "tech-debt", "enhancement", "question", "potential"] }).default("bug"),
    severity: integer("severity").default(5),
    status: text("status", { enum: ["open", "in-progress", "resolved", "wont-fix"] }).default("open"),
    affectedFiles: text("affected_files"), // JSON array
    relatedSymbols: text("related_symbols"), // JSON array
    workaround: text("workaround"),
    resolution: text("resolution"),
    resolvedAt: text("resolved_at"),
    embedding: blob("embedding"),
    temperature: text("temperature").default("cold"),
    lastReferencedAt: text("last_referenced_at"),
    archivedAt: text("archived_at"),
    consolidatedInto: integer("consolidated_into"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_issues_project").on(table.projectId),
    index("idx_issues_status").on(table.status),
    index("idx_issues_type").on(table.type),
    index("idx_issues_severity").on(table.severity),
    index("idx_issues_project_status").on(table.projectId, table.status),
    index("idx_issues_archived").on(table.archivedAt),
  ]
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    startedAt: text("started_at").default(sql`CURRENT_TIMESTAMP`),
    endedAt: text("ended_at"),
    goal: text("goal"),
    outcome: text("outcome"),
    filesTouched: text("files_touched"), // JSON array
    filesRead: text("files_read"), // JSON array
    patternsUsed: text("patterns_used"), // JSON array
    queriesMade: text("queries_made"), // JSON array
    decisionsMade: text("decisions_made"), // JSON array
    issuesFound: text("issues_found"), // JSON array
    issuesResolved: text("issues_resolved"), // JSON array
    learnings: text("learnings"),
    nextSteps: text("next_steps"),
    success: integer("success"),
    sessionNumber: integer("session_number"),
  },
  (table) => [
    index("idx_sessions_project").on(table.projectId),
    index("idx_sessions_started").on(table.startedAt),
    index("idx_sessions_project_time").on(table.projectId, table.startedAt),
  ]
);

export const learnings = sqliteTable(
  "learnings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    context: text("context"),
    source: text("source"),
    confidence: integer("confidence").default(5),
    timesApplied: integer("times_applied").default(0),
    lastApplied: text("last_applied"),
    embedding: blob("embedding"),
    temperature: text("temperature").default("cold"),
    lastReferencedAt: text("last_referenced_at"),
    archivedAt: text("archived_at"),
    consolidatedInto: integer("consolidated_into"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_learnings_project").on(table.projectId),
    index("idx_learnings_category").on(table.category),
    index("idx_learnings_applied").on(table.timesApplied, table.confidence),
    index("idx_learnings_archived").on(table.archivedAt),
  ]
);

export const relationships = sqliteTable(
  "relationships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceType: text("source_type").notNull(),
    sourceId: integer("source_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    relationship: text("relationship").notNull(),
    strength: integer("strength").default(5),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_relationships_source").on(table.sourceType, table.sourceId),
    index("idx_relationships_target").on(table.targetType, table.targetId),
    index("idx_relationships_lookup").on(table.sourceType, table.sourceId, table.targetType),
    uniqueIndex("idx_relationships_unique").on(
      table.sourceType,
      table.sourceId,
      table.targetType,
      table.targetId,
      table.relationship
    ),
  ]
);

export const decisionLinks = sqliteTable(
  "decision_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    decisionId: integer("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    linkedDecisionId: integer("linked_decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull(),
    strength: real("strength").default(0.5),
    reason: text("reason"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_decision_links_decision").on(table.decisionId),
    index("idx_decision_links_linked").on(table.linkedDecisionId),
    index("idx_decision_links_type").on(table.linkType),
    uniqueIndex("idx_decision_links_unique").on(table.decisionId, table.linkedDecisionId, table.linkType),
  ]
);

export const modeTransitions = sqliteTable(
  "mode_transitions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fromMode: text("from_mode"),
    toMode: text("to_mode").notNull(),
    reason: text("reason"),
    transitionedAt: text("transitioned_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_mode_transitions_project").on(table.projectId),
    index("idx_mode_transitions_time").on(table.transitionedAt),
  ]
);

// ============================================================================
// CONSOLIDATION TABLES
// ============================================================================

export const consolidations = sqliteTable(
  "consolidations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    sourceIds: text("source_ids").notNull(), // JSON array of consolidated entity IDs
    summaryTitle: text("summary_title").notNull(),
    summaryContent: text("summary_content").notNull(),
    entityCount: integer("entity_count").notNull(),
    confidence: real("confidence").default(0.8),
    embedding: blob("embedding"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_consolidations_project").on(table.projectId),
    index("idx_consolidations_type").on(table.entityType),
  ]
);

// ============================================================================
// INFRASTRUCTURE TABLES
// ============================================================================

export const servers = sqliteTable("servers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").unique().notNull(),
  hostname: text("hostname"),
  ipAddresses: text("ip_addresses"), // JSON array
  role: text("role"),
  sshUser: text("ssh_user").default("root"),
  sshPort: integer("ssh_port").default(22),
  sshKeyPath: text("ssh_key_path"),
  sshJumpHost: text("ssh_jump_host"),
  os: text("os"),
  resources: text("resources"), // JSON object
  tags: text("tags"), // JSON array
  status: text("status", { enum: ["online", "offline", "degraded", "unknown"] }).default("unknown"),
  lastSeen: text("last_seen"),
  lastHealthCheck: text("last_health_check"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const services = sqliteTable(
  "services",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    serverId: integer("server_id").references(() => servers.id, { onDelete: "cascade" }),
    type: text("type"),
    runtime: text("runtime"),
    port: integer("port"),
    healthEndpoint: text("health_endpoint"),
    healthStatus: text("health_status", { enum: ["healthy", "unhealthy", "degraded", "unknown"] }).default("unknown"),
    lastHealthCheck: text("last_health_check"),
    responseTimeMs: integer("response_time_ms"),
    config: text("config"), // JSON object
    envFile: text("env_file"),
    projectPath: text("project_path"),
    gitRepo: text("git_repo"),
    gitBranch: text("git_branch").default("main"),
    currentVersion: text("current_version"),
    deployCommand: text("deploy_command"),
    restartCommand: text("restart_command"),
    stopCommand: text("stop_command"),
    logCommand: text("log_command"),
    status: text("status", { enum: ["running", "stopped", "error", "unknown"] }).default("unknown"),
    autoRestart: integer("auto_restart").default(1),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_services_server").on(table.serverId),
    index("idx_services_status").on(table.status),
    index("idx_services_health").on(table.healthStatus, table.serverId),
    uniqueIndex("idx_services_server_name").on(table.serverId, table.name),
  ]
);

export const routes = sqliteTable(
  "routes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    domain: text("domain").notNull(),
    path: text("path").default("/"),
    serviceId: integer("service_id").references(() => services.id, { onDelete: "cascade" }),
    method: text("method").default("*"),
    proxyType: text("proxy_type"),
    sslType: text("ssl_type"),
    rateLimit: text("rate_limit"), // JSON object
    authRequired: integer("auth_required").default(0),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_routes_service").on(table.serviceId),
    index("idx_routes_domain").on(table.domain),
    uniqueIndex("idx_routes_unique").on(table.domain, table.path, table.method),
  ]
);

export const serviceDeps = sqliteTable(
  "service_deps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    dependsOnServiceId: integer("depends_on_service_id").references(() => services.id, { onDelete: "set null" }),
    dependsOnExternal: text("depends_on_external"),
    dependencyType: text("dependency_type"),
    connectionEnvVar: text("connection_env_var"),
    required: integer("required").default(1),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_service_deps_service").on(table.serviceId),
    index("idx_service_deps_depends").on(table.dependsOnServiceId),
  ]
);

export const deployments = sqliteTable(
  "deployments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    previousVersion: text("previous_version"),
    deployedBy: text("deployed_by"),
    deployMethod: text("deploy_method"),
    status: text("status", { enum: ["pending", "in_progress", "success", "failed", "rolled_back"] }).default("pending"),
    startedAt: text("started_at").default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
    durationSeconds: integer("duration_seconds"),
    output: text("output"),
    error: text("error"),
    rollbackVersion: text("rollback_version"),
    notes: text("notes"),
  },
  (table) => [
    index("idx_deployments_service").on(table.serviceId),
    index("idx_deployments_status").on(table.status),
    index("idx_deployments_service_time").on(table.serviceId, table.startedAt),
  ]
);

export const infraEvents = sqliteTable(
  "infra_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id").references(() => servers.id, { onDelete: "set null" }),
    serviceId: integer("service_id").references(() => services.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    severity: text("severity", { enum: ["info", "warning", "error", "critical"] }).default("info"),
    title: text("title").notNull(),
    description: text("description"),
    metadata: text("metadata"), // JSON object
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_infra_events_server").on(table.serverId),
    index("idx_infra_events_service").on(table.serviceId),
    index("idx_infra_events_type").on(table.eventType),
  ]
);

export const secretsRegistry = sqliteTable(
  "secrets_registry",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    serviceId: integer("service_id").references(() => services.id, { onDelete: "cascade" }),
    serverId: integer("server_id").references(() => servers.id, { onDelete: "cascade" }),
    secretManager: text("secret_manager"),
    vaultPath: text("vault_path"),
    lastRotated: text("last_rotated"),
    rotationDays: integer("rotation_days"),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_secrets_service").on(table.serviceId)]
);

// ============================================================================
// SECURITY & QUALITY TABLES
// ============================================================================

export const securityFindings = sqliteTable(
  "security_findings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    findingType: text("finding_type").notNull(),
    severity: text("severity", { enum: ["critical", "high", "medium", "low"] }).notNull(),
    lineNumber: integer("line_number"),
    codeSnippet: text("code_snippet"),
    description: text("description").notNull(),
    recommendation: text("recommendation"),
    status: text("status", { enum: ["open", "resolved", "false_positive"] }).default("open"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_security_findings_project").on(table.projectId),
    index("idx_security_findings_severity").on(table.severity),
    index("idx_security_findings_status").on(table.status),
  ]
);

export const dependencyVulnerabilities = sqliteTable(
  "dependency_vulnerabilities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    currentVersion: text("current_version"),
    vulnerableVersions: text("vulnerable_versions"),
    severity: text("severity", { enum: ["critical", "high", "medium", "low"] }).notNull(),
    cveId: text("cve_id"),
    description: text("description"),
    recommendation: text("recommendation"),
    status: text("status").default("open"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_dep_vuln_project").on(table.projectId)]
);

export const qualityMetrics = sqliteTable(
  "quality_metrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    cyclomaticComplexity: integer("cyclomatic_complexity"),
    maxFunctionLength: integer("max_function_length"),
    functionCount: integer("function_count"),
    anyTypeCount: integer("any_type_count"),
    tsIgnoreCount: integer("ts_ignore_count"),
    todoCount: integer("todo_count"),
    testCoverage: real("test_coverage"),
    lintErrors: integer("lint_errors"),
    lintWarnings: integer("lint_warnings"),
    overallScore: real("overall_score"),
    analyzedAt: text("analyzed_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_quality_project").on(table.projectId),
    uniqueIndex("idx_quality_unique").on(table.projectId, table.filePath),
  ]
);

export const performanceFindings = sqliteTable(
  "performance_findings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    findingType: text("finding_type").notNull(),
    severity: text("severity").notNull(),
    lineNumber: integer("line_number"),
    codeSnippet: text("code_snippet"),
    description: text("description").notNull(),
    recommendation: text("recommendation"),
    status: text("status").default("open"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_perf_findings_project").on(table.projectId)]
);

// ============================================================================
// WORKING MEMORY TABLES
// ============================================================================

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    content: text("content").notNull(),
    source: text("source"),
    contentType: text("content_type", { enum: ["text", "code", "json", "markdown"] }).default("text"),
    priority: integer("priority").default(3),
    tags: text("tags"), // JSON array
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at"),
  },
  (table) => [
    index("idx_bookmarks_session").on(table.sessionId),
    index("idx_bookmarks_project").on(table.projectId),
    index("idx_bookmarks_label").on(table.label),
    index("idx_bookmarks_priority").on(table.priority),
    uniqueIndex("idx_bookmarks_unique").on(table.projectId, table.label),
  ]
);

export const focus = sqliteTable(
  "focus",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    area: text("area").notNull(),
    description: text("description"),
    files: text("files"), // JSON array of file patterns
    keywords: text("keywords"), // JSON array of keywords
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    clearedAt: text("cleared_at"),
  },
  (table) => [
    index("idx_focus_project").on(table.projectId),
    index("idx_focus_session").on(table.sessionId),
    index("idx_focus_area").on(table.area),
    uniqueIndex("idx_focus_unique").on(table.projectId, table.sessionId),
  ]
);

// ============================================================================
// CONTINUITY & SELF-IMPROVEMENT TABLES
// ============================================================================

export const observations = sqliteTable(
  "observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["pattern", "frustration", "insight", "dropped_thread", "preference", "behavior"],
    }).default("insight"),
    content: text("content").notNull(),
    frequency: integer("frequency").default(1),
    sessionId: integer("session_id").references(() => sessions.id, { onDelete: "set null" }),
    embedding: blob("embedding"),
    lastSeenAt: text("last_seen_at").default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_observations_project").on(table.projectId),
    index("idx_observations_type").on(table.type),
    index("idx_observations_frequency").on(table.frequency),
    index("idx_observations_last_seen").on(table.lastSeenAt),
  ]
);

export const openQuestions = sqliteTable(
  "open_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    context: text("context"),
    priority: integer("priority").default(3),
    status: text("status", { enum: ["open", "resolved", "dropped"] }).default("open"),
    resolution: text("resolution"),
    sessionId: integer("session_id").references(() => sessions.id, { onDelete: "set null" }),
    embedding: blob("embedding"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_questions_project").on(table.projectId),
    index("idx_questions_status").on(table.status),
    index("idx_questions_priority").on(table.priority),
  ]
);

export const workflowPatterns = sqliteTable(
  "workflow_patterns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskType: text("task_type").notNull(),
    approach: text("approach").notNull(),
    preferences: text("preferences"), // JSON object
    examples: text("examples"), // JSON array
    timesUsed: integer("times_used").default(1),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_workflow_project").on(table.projectId),
    index("idx_workflow_task_type").on(table.taskType),
    uniqueIndex("idx_workflow_unique").on(table.projectId, table.taskType),
  ]
);

// ============================================================================
// BLAST RADIUS TABLES
// ============================================================================

export const blastRadius = sqliteTable(
  "blast_radius",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceFile: text("source_file").notNull(),
    affectedFile: text("affected_file").notNull(),
    distance: integer("distance").notNull().default(1),
    dependencyPath: text("dependency_path"), // JSON array
    isTest: integer("is_test").default(0),
    isRoute: integer("is_route").default(0),
    computedAt: text("computed_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_blast_radius_project").on(table.projectId),
    index("idx_blast_radius_source").on(table.sourceFile),
    index("idx_blast_radius_affected").on(table.affectedFile),
    index("idx_blast_radius_distance").on(table.distance),
    index("idx_blast_radius_tests").on(table.projectId, table.isTest),
    index("idx_blast_radius_routes").on(table.projectId, table.isRoute),
    uniqueIndex("idx_blast_radius_unique").on(table.projectId, table.sourceFile, table.affectedFile),
  ]
);

export const blastSummary = sqliteTable(
  "blast_summary",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    directDependents: integer("direct_dependents").default(0),
    transitiveDependents: integer("transitive_dependents").default(0),
    totalAffected: integer("total_affected").default(0),
    maxDepth: integer("max_depth").default(0),
    affectedTests: integer("affected_tests").default(0),
    affectedRoutes: integer("affected_routes").default(0),
    blastScore: real("blast_score").default(0.0),
    computedAt: text("computed_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_blast_summary_project").on(table.projectId),
    index("idx_blast_summary_file").on(table.filePath),
    index("idx_blast_summary_score").on(table.blastScore),
    uniqueIndex("idx_blast_summary_unique").on(table.projectId, table.filePath),
  ]
);

// ============================================================================
// INTELLIGENCE TABLES
// ============================================================================

export const developerProfile = sqliteTable(
  "developer_profile",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    evidence: text("evidence"),
    confidence: real("confidence").default(0.5),
    category: text("category").notNull(),
    source: text("source").default("inferred"),
    timesConfirmed: integer("times_confirmed").default(1),
    embedding: blob("embedding"),
    lastUpdatedAt: text("last_updated_at").default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_profile_project").on(table.projectId),
    index("idx_profile_confidence").on(table.confidence),
    uniqueIndex("idx_profile_unique").on(table.projectId, table.key),
  ]
);

export const insights = sqliteTable(
  "insights",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    evidence: text("evidence"),
    confidence: real("confidence").default(0.5),
    status: text("status").default("new"),
    generatedAt: text("generated_at").default(sql`CURRENT_TIMESTAMP`),
    acknowledgedAt: text("acknowledged_at"),
    embedding: blob("embedding"),
  },
  (table) => [
    index("idx_insights_project").on(table.projectId),
    index("idx_insights_status").on(table.status),
    index("idx_insights_confidence").on(table.confidence),
    uniqueIndex("idx_insights_unique").on(table.projectId, table.title),
  ]
);

// ============================================================================
// GLOBAL TABLES (for global DB)
// ============================================================================

export const globalDeveloperProfile = sqliteTable("global_developer_profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").unique().notNull(),
  value: text("value").notNull(),
  evidence: text("evidence"),
  confidence: real("confidence").default(0.5),
  category: text("category").notNull(),
  source: text("source").default("inferred"),
  timesConfirmed: integer("times_confirmed").default(1),
  lastUpdatedAt: text("last_updated_at").default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const globalLearnings = sqliteTable("global_learnings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  context: text("context"),
  sourceProject: text("source_project"),
  confidence: integer("confidence").default(5),
  timesApplied: integer("times_applied").default(0),
  lastApplied: text("last_applied"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const patterns = sqliteTable("patterns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").unique().notNull(),
  description: text("description").notNull(),
  codeExample: text("code_example"),
  antiPattern: text("anti_pattern"),
  appliesTo: text("applies_to"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const qualityStandards = sqliteTable("quality_standards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  rule: text("rule").notNull(),
  severity: text("severity").default("warning"),
  autoFixable: integer("auto_fixable").default(0),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const techDebt = sqliteTable("tech_debt", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectPath: text("project_path").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  severity: integer("severity").default(5),
  effort: text("effort"),
  affectedFiles: text("affected_files"),
  status: text("status").default("open"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const shipHistory = sqliteTable("ship_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectPath: text("project_path").notNull(),
  version: text("version"),
  timestamp: text("timestamp").default(sql`CURRENT_TIMESTAMP`),
  checksPassed: text("checks_passed"),
  checksFailed: text("checks_failed"),
  notes: text("notes"),
});

// ============================================================================
// TYPE EXPORTS (inferred from schema)
// ============================================================================

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;

export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;

export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Learning = typeof learnings.$inferSelect;
export type NewLearning = typeof learnings.$inferInsert;

export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;

export type Route = typeof routes.$inferSelect;
export type NewRoute = typeof routes.$inferInsert;

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;

export type InfraEvent = typeof infraEvents.$inferSelect;
export type NewInfraEvent = typeof infraEvents.$inferInsert;

export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;

export type Focus = typeof focus.$inferSelect;
export type NewFocus = typeof focus.$inferInsert;

export type BlastRadiusRecord = typeof blastRadius.$inferSelect;
export type BlastSummaryRecord = typeof blastSummary.$inferSelect;

export type ObservationRecord = typeof observations.$inferSelect;
export type NewObservation = typeof observations.$inferInsert;

export type OpenQuestionRecord = typeof openQuestions.$inferSelect;
export type NewOpenQuestion = typeof openQuestions.$inferInsert;

export type WorkflowPatternRecord = typeof workflowPatterns.$inferSelect;
export type NewWorkflowPattern = typeof workflowPatterns.$inferInsert;

export type DeveloperProfileRecord = typeof developerProfile.$inferSelect;
export type NewDeveloperProfile = typeof developerProfile.$inferInsert;

export type InsightRecord = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;
