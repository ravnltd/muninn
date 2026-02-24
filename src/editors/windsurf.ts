/**
 * Windsurf (Codeium) Editor Adapter
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorAdapter, EditorConfig, ServerConfig } from "./types.js";

export const windsurfAdapter: EditorAdapter = {
  id: "windsurf",
  name: "Windsurf",
  supportsHooks: false,

  detect(): boolean {
    const home = process.env.HOME || "~";
    return existsSync(join(home, ".codeium"));
  },

  generateMcpConfig(server: ServerConfig): EditorConfig {
    const home = process.env.HOME || "~";
    const configPath = join(home, ".codeium", "windsurf", "mcp_config.json");
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
    return `# Muninn Memory System\n\n${core}\n`;
  },
};
