/**
 * Cline (VS Code Extension) Editor Adapter
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EditorAdapter, EditorConfig, ServerConfig } from "./types.js";

export const clineAdapter: EditorAdapter = {
  id: "cline",
  name: "Cline",
  supportsHooks: false,

  detect(): boolean {
    const home = process.env.HOME || "~";
    // Check for Cline extension settings
    const vscodeExtDir = join(home, ".vscode", "extensions");
    if (!existsSync(vscodeExtDir)) return false;

    try {
      const result = Bun.spawnSync(["ls", vscodeExtDir]);
      const output = result.stdout.toString();
      return output.includes("saoudrizwan.claude-dev");
    } catch {
      return false;
    }
  },

  generateMcpConfig(server: ServerConfig): EditorConfig {
    const home = process.env.HOME || "~";
    const configPath = join(home, ".vscode", "globalStorage",
      "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");

    const content = JSON.stringify({
      mcpServers: {
        muninn: {
          command: server.command,
          args: server.args,
          env: server.env ?? {},
          disabled: false,
          autoApprove: [],
        },
      },
    }, null, 2);

    return { configPath, content };
  },

  generateInstructions(core: string): string {
    return core;
  },
};
