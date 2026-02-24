/**
 * Session State — Hook Communication Layer
 *
 * MCP server writes temp files, hooks read them.
 * No CLI spawns. All writes are atomic or append-only.
 *
 * - checkedPath: append-only list of files that passed muninn_check
 * - contextPath: atomic-write cache of current task context
 * - discoveryPath: atomic-write JSON pointing hooks to correct temp files
 */

import {
  writeFileSync,
  appendFileSync,
  readFileSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { computeContentHash } from "./utils/format";

export class SessionState {
  private readonly checkedPath: string;
  private readonly contextPath: string;
  private readonly discoveryPath: string;
  private readonly MAX_CHECKED_ENTRIES = 200;
  private readonly TRIM_TO = 100;

  constructor(projectPath: string) {
    const hash = computeContentHash(projectPath).slice(0, 12);
    this.checkedPath = `/tmp/muninn-${hash}-checked.txt`;
    this.contextPath = `/tmp/muninn-${hash}-context.txt`;
    this.discoveryPath = `/tmp/muninn-discovery-${hash}.json`;
  }

  /** Record files as checked. Append-only, bounded at MAX_CHECKED_ENTRIES. */
  markChecked(files: string[]): void {
    try {
      const entries = files.map((f) => f + "\n").join("");
      appendFileSync(this.checkedPath, entries, { mode: 0o600 });
      this.trimIfNeeded();
    } catch {
      // fail-silent — enforcement will fail-open
    }
  }

  /** Check if a file was recently checked. */
  isChecked(file: string): boolean {
    try {
      if (!existsSync(this.checkedPath)) return false;
      const content = readFileSync(this.checkedPath, "utf-8");
      return content.includes(file);
    } catch {
      return false;
    }
  }

  /** Write task context cache. Atomic: write-to-tmp-then-rename. */
  writeContext(context: string): void {
    try {
      const tmp = this.contextPath + ".tmp";
      writeFileSync(tmp, context, { mode: 0o600 });
      renameSync(tmp, this.contextPath);
    } catch {
      // fail-silent
    }
  }

  /** Clear all state. Called on session start. */
  clear(): void {
    try {
      writeFileSync(this.checkedPath, "");
    } catch {
      // ignore
    }
    try {
      unlinkSync(this.contextPath);
    } catch {
      // ignore — file may not exist
    }
  }

  /** Write discovery file so hooks can find project-specific temp paths. */
  writeDiscoveryFile(options?: { hasFileData?: boolean }): void {
    try {
      const tmp = this.discoveryPath + ".tmp";
      writeFileSync(
        tmp,
        JSON.stringify({
          checkedPath: this.checkedPath,
          contextPath: this.contextPath,
          hasFileData: options?.hasFileData ?? true,
        }),
        { mode: 0o600 }
      );
      renameSync(tmp, this.discoveryPath);
    } catch {
      // fail-silent
    }
  }

  /** Trim checked files if exceeding max entries. Keep most recent. */
  private trimIfNeeded(): void {
    try {
      const content = readFileSync(this.checkedPath, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      if (lines.length > this.MAX_CHECKED_ENTRIES) {
        const trimmed = lines.slice(-this.TRIM_TO).join("\n") + "\n";
        const tmp = this.checkedPath + ".tmp";
        writeFileSync(tmp, trimmed);
        renameSync(tmp, this.checkedPath);
      }
    } catch {
      // fail-silent
    }
  }

  /** Expose paths for testing. */
  getPaths(): { checkedPath: string; contextPath: string; discoveryPath: string } {
    return {
      checkedPath: this.checkedPath,
      contextPath: this.contextPath,
      discoveryPath: this.discoveryPath,
    };
  }
}
