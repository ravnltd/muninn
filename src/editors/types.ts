/**
 * Editor Adapter Types
 */

export type EditorId = "claude-code" | "cursor" | "windsurf" | "cline" | "vscode" | "neovim";

export interface ServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface EditorConfig {
  configPath: string;
  content: string;
  instructions?: { path: string; content: string };
}

export interface EditorAdapter {
  readonly id: EditorId;
  readonly name: string;
  readonly supportsHooks: boolean;
  detect(): boolean;
  generateMcpConfig(server: ServerConfig): EditorConfig;
  generateInstructions(core: string): string;
}
