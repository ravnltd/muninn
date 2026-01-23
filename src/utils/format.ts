/**
 * Output formatting utilities
 * Provides consistent output formatting for CLI, JSON, and visual formats
 */

import { statSync } from "fs";
import type { Server, InfraStatus, ServerWithServices } from "../types";

// ============================================================================
// Time Formatting
// ============================================================================

export function getTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "never";

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

// ============================================================================
// File Utilities
// ============================================================================

export function getFileMtime(filePath: string): string | null {
  try {
    const stat = statSync(filePath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

export function computeContentHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

// ============================================================================
// Status Icons
// ============================================================================

export function getStatusIcon(status: string): string {
  switch (status) {
    case 'online':
    case 'healthy':
    case 'running':
    case 'success':
    case 'pass':
      return '🟢';
    case 'offline':
    case 'unhealthy':
    case 'stopped':
    case 'failed':
    case 'fail':
      return '🔴';
    case 'degraded':
    case 'warn':
    case 'warning':
      return '🟠';
    case 'critical':
      return '🔴';
    case 'error':
      return '🟠';
    case 'info':
      return '🔵';
    case 'unknown':
    case 'skip':
    default:
      return '⚪';
  }
}

export function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'critical':
      return '🔴';
    case 'high':
    case 'error':
      return '🟠';
    case 'medium':
    case 'warning':
      return '🟡';
    case 'low':
    case 'info':
      return '🔵';
    default:
      return '⚪';
  }
}

// ============================================================================
// JSON Output
// ============================================================================

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data));
}

export function outputSuccess(data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ success: true, ...data }));
}

export function outputError(error: string, details?: Record<string, unknown>): void {
  console.log(JSON.stringify({ success: false, error, ...details }));
}

// ============================================================================
// Table Formatting
// ============================================================================

export function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxRowWidth = Math.max(...rows.map(r => (r[i] || '').length));
    return Math.max(h.length, maxRowWidth);
  });

  const separator = colWidths.map(w => '─'.repeat(w + 2)).join('┼');
  const headerRow = headers.map((h, i) => ` ${h.padEnd(colWidths[i])} `).join('│');

  const dataRows = rows.map(row =>
    row.map((cell, i) => ` ${(cell || '').padEnd(colWidths[i])} `).join('│')
  );

  return [
    '┌' + separator.replace(/┼/g, '┬') + '┐',
    '│' + headerRow + '│',
    '├' + separator + '┤',
    ...dataRows.map(r => '│' + r + '│'),
    '└' + separator.replace(/┼/g, '┴') + '┘',
  ].join('\n');
}

// ============================================================================
// Infrastructure Formatting
// ============================================================================

export function formatServerList(servers: Server[]): void {
  if (servers.length === 0) {
    console.error("No servers registered. Add one with: context infra server add <name> --ip <ip>");
    return;
  }

  console.error("\n📡 Registered Servers:\n");
  for (const s of servers) {
    const ips = s.ip_addresses ? JSON.parse(s.ip_addresses).join(", ") : "no IP";
    const statusIcon = getStatusIcon(s.status);
    console.error(`  ${statusIcon} ${s.name}`);
    console.error(`     IP: ${ips} | Role: ${s.role || "unset"} | SSH: ${s.ssh_user}@${s.ssh_port}`);
    if (s.notes) console.error(`     Notes: ${s.notes}`);
  }
  console.error("");
}

export function formatInfraStatus(status: InfraStatus): void {
  if (status.servers.length === 0) {
    console.error("No infrastructure registered yet.\n");
    console.error("Get started:");
    console.error("  context infra server add prod-1 --ip 192.168.1.10 --role homelab");
    console.error("  context infra service add myapp --server prod-1 --port 3000");
    return;
  }

  console.error("\n📊 Infrastructure Status\n");

  for (const server of status.servers) {
    const serverStatus = getStatusIcon(server.status);
    const ips = server.ip_addresses ? JSON.parse(server.ip_addresses).join(", ") : "no IP";

    console.error(`${serverStatus} ${server.name} (${ips}) [${server.role || "unset"}]`);

    for (const svc of server.services) {
      const healthIcon = getStatusIcon(svc.health_status);
      const port = svc.port ? `:${svc.port}` : "";
      const domain = svc.primary_domain ? ` → ${svc.primary_domain}` : "";
      console.error(`   ${healthIcon} ${svc.name}${port}${domain}`);
    }

    if (server.services.length === 0) {
      console.error("   (no services)");
    }

    console.error("");
  }

  console.error(`Summary: ${status.summary.servers_online}/${status.summary.total_servers} servers online, ${status.summary.services_healthy}/${status.summary.total_services} services healthy`);
  console.error("");
}

// ============================================================================
// Mermaid Diagram Generation
// ============================================================================

export function generateMermaidInfraMap(
  servers: ServerWithServices[],
  deps: Array<{ from_svc: string; to_svc: string | null; dependency_type?: string | null }>,
  routes: Array<{ domain: string; service_name: string }>
): string {
  let mermaid = "graph TD\n";

  for (const server of servers) {
    mermaid += `    subgraph ${server.name}["📡 ${server.name}"]\n`;
    for (const svc of server.services) {
      const icon = svc.type === "database" ? "🗄️" : svc.type === "cache" ? "⚡" : "⚙️";
      mermaid += `        ${svc.name}["${icon} ${svc.name}"]\n`;
    }
    mermaid += "    end\n";
  }

  for (const dep of deps) {
    if (dep.to_svc) {
      mermaid += `    ${dep.from_svc} -->|${dep.dependency_type || "uses"}| ${dep.to_svc}\n`;
    }
  }

  for (const route of routes) {
    mermaid += `    ${route.domain}[["🌐 ${route.domain}"]] --> ${route.service_name}\n`;
  }

  return mermaid;
}

export function generateAsciiInfraMap(servers: ServerWithServices[]): void {
  console.error("\n🗺️  Infrastructure Map\n");
  console.error("┌" + "─".repeat(60) + "┐");

  for (const server of servers) {
    const statusIcon = server.status === "online" ? "🟢" : "🔴";
    console.error(`│ ${statusIcon} ${server.name.padEnd(54)} │`);
    console.error("│" + "─".repeat(60) + "│");

    for (const svc of server.services) {
      const domain = svc.primary_domain || "";
      const port = svc.port ? `:${svc.port}` : "";
      const line = `   ⚙️ ${svc.name}${port}`.padEnd(35) + domain.padEnd(25);
      console.error(`│${line}│`);
    }

    if (server.services.length === 0) {
      console.error(`│   (no services)${" ".repeat(44)}│`);
    }
    console.error("├" + "─".repeat(60) + "┤");
  }

  console.error("└" + "─".repeat(60) + "┘\n");
}

// ============================================================================
// Ship Checklist Formatting
// ============================================================================

export function formatShipCheck(check: { name: string; status: string; message?: string }): string {
  const icon = getStatusIcon(check.status);
  const message = check.message ? `: ${check.message}` : "";
  return `${icon} ${check.name}${message}`;
}

// ============================================================================
// Brief / Resume Formatting
// ============================================================================

export function formatBrief(data: {
  project: { name: string; type?: string; stack?: string[] };
  lastSession?: { goal: string; outcome?: string; next_steps?: string; ended_at?: string; started_at?: string };
  fragileFiles: Array<{ path: string; fragility: number; fragility_reason?: string }>;
  openIssues: Array<{ id: number; title: string; severity: number }>;
  activeDecisions: Array<{ id: number; title: string; decision: string }>;
  patterns: Array<{ name: string; description: string }>;
}): string {
  let md = `# Project: ${data.project.name}\n`;
  md += `**Type:** ${data.project.type || "unknown"} | **Stack:** ${data.project.stack?.join(", ") || "unknown"}\n\n`;

  if (data.lastSession) {
    const timeAgo = getTimeAgo(data.lastSession.ended_at || data.lastSession.started_at);
    md += `## Last Session (${timeAgo})\n`;
    md += `**Goal:** ${data.lastSession.goal || "Not specified"}\n`;
    md += `**Outcome:** ${data.lastSession.outcome || "Not recorded"}\n`;
    if (data.lastSession.next_steps) {
      md += `**Next:** ${data.lastSession.next_steps}\n`;
    }
    md += "\n";
  }

  if (data.fragileFiles.length > 0) {
    md += `## ⚠️ Fragile Files (touch carefully)\n`;
    for (const f of data.fragileFiles) {
      md += `- \`${f.path}\` [${f.fragility}/10]${f.fragility_reason ? ` - ${f.fragility_reason}` : ""}\n`;
    }
    md += "\n";
  }

  if (data.openIssues.length > 0) {
    md += `## 🔴 Open Issues (by severity)\n`;
    for (const i of data.openIssues) {
      md += `- #${i.id}: ${i.title} (sev ${i.severity})\n`;
    }
    md += "\n";
  }

  if (data.activeDecisions.length > 0) {
    md += `## 📋 Active Decisions\n`;
    for (const d of data.activeDecisions) {
      const decisionPreview = d.decision.substring(0, 60) + (d.decision.length > 60 ? "..." : "");
      md += `- D${d.id}: ${d.title} → ${decisionPreview}\n`;
    }
    md += "\n";
  }

  if (data.patterns.length > 0) {
    md += `## 💡 Patterns Library\n`;
    for (const p of data.patterns) {
      const descPreview = p.description.substring(0, 50) + (p.description.length > 50 ? "..." : "");
      md += `- ${p.name}: ${descPreview}\n`;
    }
  }

  return md;
}
