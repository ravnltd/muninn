/**
 * Neovim Editor Adapter
 */
import type { EditorAdapter, EditorConfig, ServerConfig } from "./types.js";

export const neovimAdapter: EditorAdapter = {
  id: "neovim",
  name: "Neovim",
  supportsHooks: false,

  detect(): boolean {
    try {
      const result = Bun.spawnSync(["which", "nvim"]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },

  generateMcpConfig(server: ServerConfig): EditorConfig {
    // Neovim MCP integration varies (mcphub, avante, etc.)
    // Provide a generic config that users can adapt
    const envLine = server.env
      ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join(" ")
      : "";
    const cmdLine = envLine
      ? `${envLine} ${server.command} ${server.args.join(" ")}`
      : `${server.command} ${server.args.join(" ")}`;

    const content = JSON.stringify({
      muninn: {
        command: server.command,
        args: server.args,
        env: server.env ?? {},
      },
    }, null, 2);

    return {
      configPath: "~/.config/nvim/mcp-servers.json",
      content,
      instructions: {
        path: "INSTRUCTIONS.md",
        content: this.generateInstructions("") +
          `\n\n## Neovim Setup\n\nRun: \`${cmdLine}\`\n`,
      },
    };
  },

  generateInstructions(core: string): string {
    return `# Muninn Memory System\n\n${core}\n`;
  },
};
