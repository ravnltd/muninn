/**
 * VS Code Editor Adapter
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorAdapter, EditorConfig, ServerConfig } from "./types.js";

export const vscodeAdapter: EditorAdapter = {
  id: "vscode",
  name: "VS Code",
  supportsHooks: false,

  detect(): boolean {
    try {
      const result = Bun.spawnSync(["which", "code"]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },

  generateMcpConfig(server: ServerConfig): EditorConfig {
    const home = process.env.HOME || "~";
    const configPath = join(home, ".vscode", "mcp.json");
    let existing: Record<string, unknown> = {};

    if (existsSync(configPath)) {
      try {
        existing = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch { /* start fresh */ }
    }

    const servers = (existing.servers as Record<string, unknown>) ?? {};
    servers.muninn = {
      command: server.command,
      args: server.args,
      env: server.env ?? {},
    };

    const content = JSON.stringify({ ...existing, servers }, null, 2);
    return { configPath, content };
  },

  generateInstructions(core: string): string {
    return `# Muninn Memory System\n\n${core}\n`;
  },
};
