/**
 * Claude Code Editor Adapter
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorAdapter, EditorConfig, ServerConfig } from "./types.js";

export const claudeCodeAdapter: EditorAdapter = {
  id: "claude-code",
  name: "Claude Code",
  supportsHooks: true,

  detect(): boolean {
    try {
      const result = Bun.spawnSync(["which", "claude"]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },

  generateMcpConfig(server: ServerConfig): EditorConfig {
    const home = process.env.HOME || "~";
    const configPath = join(home, ".claude.json");
    let existing: Record<string, unknown> = {};

    if (existsSync(configPath)) {
      try {
        existing = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch { /* start fresh */ }
    }

    const mcpServers = (existing.mcpServers as Record<string, unknown>) ?? {};
    mcpServers.muninn = {
      command: server.command,
      args: server.args,
      env: server.env ?? {},
    };

    const content = JSON.stringify({ ...existing, mcpServers }, null, 2);
    return { configPath, content };
  },

  generateInstructions(core: string): string {
    return `<!-- MUNINN:START -->\n${core}\n<!-- MUNINN:END -->`;
  },
};
