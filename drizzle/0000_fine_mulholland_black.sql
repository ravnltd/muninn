CREATE TABLE `blast_radius` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`source_file` text NOT NULL,
	`affected_file` text NOT NULL,
	`distance` integer DEFAULT 1 NOT NULL,
	`dependency_path` text,
	`is_test` integer DEFAULT 0,
	`is_route` integer DEFAULT 0,
	`computed_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_blast_radius_project` ON `blast_radius` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_blast_radius_source` ON `blast_radius` (`source_file`);--> statement-breakpoint
CREATE INDEX `idx_blast_radius_affected` ON `blast_radius` (`affected_file`);--> statement-breakpoint
CREATE INDEX `idx_blast_radius_distance` ON `blast_radius` (`distance`);--> statement-breakpoint
CREATE INDEX `idx_blast_radius_tests` ON `blast_radius` (`project_id`,`is_test`);--> statement-breakpoint
CREATE INDEX `idx_blast_radius_routes` ON `blast_radius` (`project_id`,`is_route`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_blast_radius_unique` ON `blast_radius` (`project_id`,`source_file`,`affected_file`);--> statement-breakpoint
CREATE TABLE `blast_summary` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`direct_dependents` integer DEFAULT 0,
	`transitive_dependents` integer DEFAULT 0,
	`total_affected` integer DEFAULT 0,
	`max_depth` integer DEFAULT 0,
	`affected_tests` integer DEFAULT 0,
	`affected_routes` integer DEFAULT 0,
	`blast_score` real DEFAULT 0,
	`computed_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_blast_summary_project` ON `blast_summary` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_blast_summary_file` ON `blast_summary` (`file_path`);--> statement-breakpoint
CREATE INDEX `idx_blast_summary_score` ON `blast_summary` (`blast_score`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_blast_summary_unique` ON `blast_summary` (`project_id`,`file_path`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer,
	`project_id` integer,
	`label` text NOT NULL,
	`content` text NOT NULL,
	`source` text,
	`content_type` text DEFAULT 'text',
	`priority` integer DEFAULT 3,
	`tags` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`expires_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_bookmarks_session` ON `bookmarks` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_bookmarks_project` ON `bookmarks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_bookmarks_label` ON `bookmarks` (`label`);--> statement-breakpoint
CREATE INDEX `idx_bookmarks_priority` ON `bookmarks` (`priority`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bookmarks_unique` ON `bookmarks` (`project_id`,`label`);--> statement-breakpoint
CREATE TABLE `decision_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`decision_id` integer NOT NULL,
	`linked_decision_id` integer NOT NULL,
	`link_type` text NOT NULL,
	`strength` real DEFAULT 0.5,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_decision_links_decision` ON `decision_links` (`decision_id`);--> statement-breakpoint
CREATE INDEX `idx_decision_links_linked` ON `decision_links` (`linked_decision_id`);--> statement-breakpoint
CREATE INDEX `idx_decision_links_type` ON `decision_links` (`link_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_decision_links_unique` ON `decision_links` (`decision_id`,`linked_decision_id`,`link_type`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`decision` text NOT NULL,
	`reasoning` text,
	`alternatives` text,
	`consequences` text,
	`affects` text,
	`status` text DEFAULT 'active',
	`superseded_by` integer,
	`invariant` text,
	`constraint_type` text DEFAULT 'should_hold',
	`decided_at` text DEFAULT CURRENT_TIMESTAMP,
	`embedding` blob,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_decisions_project` ON `decisions` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_decisions_status` ON `decisions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_decisions_project_status` ON `decisions` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `dependency_vulnerabilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`package_name` text NOT NULL,
	`current_version` text,
	`vulnerable_versions` text,
	`severity` text NOT NULL,
	`cve_id` text,
	`description` text,
	`recommendation` text,
	`status` text DEFAULT 'open',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dep_vuln_project` ON `dependency_vulnerabilities` (`project_id`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_id` integer NOT NULL,
	`version` text NOT NULL,
	`previous_version` text,
	`deployed_by` text,
	`deploy_method` text,
	`status` text DEFAULT 'pending',
	`started_at` text DEFAULT CURRENT_TIMESTAMP,
	`completed_at` text,
	`duration_seconds` integer,
	`output` text,
	`error` text,
	`rollback_version` text,
	`notes` text,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_deployments_service` ON `deployments` (`service_id`);--> statement-breakpoint
CREATE INDEX `idx_deployments_status` ON `deployments` (`status`);--> statement-breakpoint
CREATE INDEX `idx_deployments_service_time` ON `deployments` (`service_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`path` text NOT NULL,
	`type` text,
	`purpose` text,
	`exports` text,
	`dependencies` text,
	`dependents` text,
	`fragility` integer DEFAULT 0,
	`fragility_reason` text,
	`status` text DEFAULT 'active',
	`last_modified` text,
	`last_analyzed` text,
	`embedding` blob,
	`content_hash` text,
	`fs_modified_at` text,
	`last_queried_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_files_project` ON `files` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_files_type` ON `files` (`type`);--> statement-breakpoint
CREATE INDEX `idx_files_status` ON `files` (`status`);--> statement-breakpoint
CREATE INDEX `idx_files_fragility` ON `files` (`fragility`);--> statement-breakpoint
CREATE INDEX `idx_files_project_fragility` ON `files` (`project_id`,`fragility`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_files_project_path` ON `files` (`project_id`,`path`);--> statement-breakpoint
CREATE TABLE `focus` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`session_id` integer,
	`area` text NOT NULL,
	`description` text,
	`files` text,
	`keywords` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`cleared_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_focus_project` ON `focus` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_focus_session` ON `focus` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_focus_area` ON `focus` (`area`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_focus_unique` ON `focus` (`project_id`,`session_id`);--> statement-breakpoint
CREATE TABLE `global_learnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`context` text,
	`source_project` text,
	`confidence` integer DEFAULT 5,
	`times_applied` integer DEFAULT 0,
	`last_applied` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `infra_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_id` integer,
	`service_id` integer,
	`event_type` text NOT NULL,
	`severity` text DEFAULT 'info',
	`title` text NOT NULL,
	`description` text,
	`metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_infra_events_server` ON `infra_events` (`server_id`);--> statement-breakpoint
CREATE INDEX `idx_infra_events_service` ON `infra_events` (`service_id`);--> statement-breakpoint
CREATE INDEX `idx_infra_events_type` ON `infra_events` (`event_type`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'bug',
	`severity` integer DEFAULT 5,
	`status` text DEFAULT 'open',
	`affected_files` text,
	`related_symbols` text,
	`workaround` text,
	`resolution` text,
	`resolved_at` text,
	`embedding` blob,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_issues_project` ON `issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_issues_status` ON `issues` (`status`);--> statement-breakpoint
CREATE INDEX `idx_issues_type` ON `issues` (`type`);--> statement-breakpoint
CREATE INDEX `idx_issues_severity` ON `issues` (`severity`);--> statement-breakpoint
CREATE INDEX `idx_issues_project_status` ON `issues` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `learnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`context` text,
	`source` text,
	`confidence` integer DEFAULT 5,
	`times_applied` integer DEFAULT 0,
	`last_applied` text,
	`embedding` blob,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_learnings_project` ON `learnings` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_learnings_category` ON `learnings` (`category`);--> statement-breakpoint
CREATE INDEX `idx_learnings_applied` ON `learnings` (`times_applied`,`confidence`);--> statement-breakpoint
CREATE TABLE `mode_transitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`from_mode` text,
	`to_mode` text NOT NULL,
	`reason` text,
	`transitioned_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mode_transitions_project` ON `mode_transitions` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_mode_transitions_time` ON `mode_transitions` (`transitioned_at`);--> statement-breakpoint
CREATE TABLE `patterns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`code_example` text,
	`anti_pattern` text,
	`applies_to` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patterns_name_unique` ON `patterns` (`name`);--> statement-breakpoint
CREATE TABLE `performance_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`finding_type` text NOT NULL,
	`severity` text NOT NULL,
	`line_number` integer,
	`code_snippet` text,
	`description` text NOT NULL,
	`recommendation` text,
	`status` text DEFAULT 'open',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_perf_findings_project` ON `performance_findings` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`stack` text,
	`status` text DEFAULT 'active',
	`mode` text DEFAULT 'exploring',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_path_unique` ON `projects` (`path`);--> statement-breakpoint
CREATE TABLE `quality_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`cyclomatic_complexity` integer,
	`max_function_length` integer,
	`function_count` integer,
	`any_type_count` integer,
	`ts_ignore_count` integer,
	`todo_count` integer,
	`test_coverage` real,
	`lint_errors` integer,
	`lint_warnings` integer,
	`overall_score` real,
	`analyzed_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_quality_project` ON `quality_metrics` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quality_unique` ON `quality_metrics` (`project_id`,`file_path`);--> statement-breakpoint
CREATE TABLE `quality_standards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`rule` text NOT NULL,
	`severity` text DEFAULT 'warning',
	`auto_fixable` integer DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`relationship` text NOT NULL,
	`strength` integer DEFAULT 5,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_relationships_source` ON `relationships` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_relationships_target` ON `relationships` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_relationships_lookup` ON `relationships` (`source_type`,`source_id`,`target_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_relationships_unique` ON `relationships` (`source_type`,`source_id`,`target_type`,`target_id`,`relationship`);--> statement-breakpoint
CREATE TABLE `routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`path` text DEFAULT '/',
	`service_id` integer,
	`method` text DEFAULT '*',
	`proxy_type` text,
	`ssl_type` text,
	`rate_limit` text,
	`auth_required` integer DEFAULT 0,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_routes_service` ON `routes` (`service_id`);--> statement-breakpoint
CREATE INDEX `idx_routes_domain` ON `routes` (`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_routes_unique` ON `routes` (`domain`,`path`,`method`);--> statement-breakpoint
CREATE TABLE `secrets_registry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`service_id` integer,
	`server_id` integer,
	`secret_manager` text,
	`vault_path` text,
	`last_rotated` text,
	`rotation_days` integer,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_secrets_service` ON `secrets_registry` (`service_id`);--> statement-breakpoint
CREATE TABLE `security_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`finding_type` text NOT NULL,
	`severity` text NOT NULL,
	`line_number` integer,
	`code_snippet` text,
	`description` text NOT NULL,
	`recommendation` text,
	`status` text DEFAULT 'open',
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_security_findings_project` ON `security_findings` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_security_findings_severity` ON `security_findings` (`severity`);--> statement-breakpoint
CREATE INDEX `idx_security_findings_status` ON `security_findings` (`status`);--> statement-breakpoint
CREATE TABLE `servers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`hostname` text,
	`ip_addresses` text,
	`role` text,
	`ssh_user` text DEFAULT 'root',
	`ssh_port` integer DEFAULT 22,
	`ssh_key_path` text,
	`ssh_jump_host` text,
	`os` text,
	`resources` text,
	`tags` text,
	`status` text DEFAULT 'unknown',
	`last_seen` text,
	`last_health_check` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `servers_name_unique` ON `servers` (`name`);--> statement-breakpoint
CREATE TABLE `service_deps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_id` integer NOT NULL,
	`depends_on_service_id` integer,
	`depends_on_external` text,
	`dependency_type` text,
	`connection_env_var` text,
	`required` integer DEFAULT 1,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_service_deps_service` ON `service_deps` (`service_id`);--> statement-breakpoint
CREATE INDEX `idx_service_deps_depends` ON `service_deps` (`depends_on_service_id`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`server_id` integer,
	`type` text,
	`runtime` text,
	`port` integer,
	`health_endpoint` text,
	`health_status` text DEFAULT 'unknown',
	`last_health_check` text,
	`response_time_ms` integer,
	`config` text,
	`env_file` text,
	`project_path` text,
	`git_repo` text,
	`git_branch` text DEFAULT 'main',
	`current_version` text,
	`deploy_command` text,
	`restart_command` text,
	`stop_command` text,
	`log_command` text,
	`status` text DEFAULT 'unknown',
	`auto_restart` integer DEFAULT 1,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_services_server` ON `services` (`server_id`);--> statement-breakpoint
CREATE INDEX `idx_services_status` ON `services` (`status`);--> statement-breakpoint
CREATE INDEX `idx_services_health` ON `services` (`health_status`,`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_services_server_name` ON `services` (`server_id`,`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP,
	`ended_at` text,
	`goal` text,
	`outcome` text,
	`files_touched` text,
	`files_read` text,
	`patterns_used` text,
	`queries_made` text,
	`decisions_made` text,
	`issues_found` text,
	`issues_resolved` text,
	`learnings` text,
	`next_steps` text,
	`success` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_project` ON `sessions` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_started` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_project_time` ON `sessions` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `ship_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_path` text NOT NULL,
	`version` text,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP,
	`checks_passed` text,
	`checks_failed` text,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `symbols` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`signature` text,
	`purpose` text,
	`parameters` text,
	`returns` text,
	`side_effects` text,
	`callers` text,
	`calls` text,
	`complexity` integer DEFAULT 0,
	`embedding` blob,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_symbols_file` ON `symbols` (`file_id`);--> statement-breakpoint
CREATE INDEX `idx_symbols_type` ON `symbols` (`type`);--> statement-breakpoint
CREATE INDEX `idx_symbols_name` ON `symbols` (`name`);--> statement-breakpoint
CREATE TABLE `tech_debt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_path` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`severity` integer DEFAULT 5,
	`effort` text,
	`affected_files` text,
	`status` text DEFAULT 'open',
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
