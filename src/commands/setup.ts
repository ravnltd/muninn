/**
 * Setup Command — Configure Muninn for detected editors
 *
 * Usage:
 *   muninn setup              — Interactive: detect and configure all editors
 *   muninn setup --list       — Show detected editors
 *   muninn setup cursor       — Configure specific editor
 *   muninn setup --all        — Non-interactive: configure all detected
 *   muninn setup claude-code --hooks  — Include hook installation
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { detectInstalledEditors, getAdapter, getAllAdapters } from "../editors/registry.js";
import { CORE_INSTRUCTIONS } from "../editors/instructions/core.js";
import type { EditorAdapter, EditorId, ServerConfig } from "../editors/types.js";
// getMuninnHome available if needed for future hook path resolution

function buildServerConfig(): ServerConfig {
  const mode = process.env.MUNINN_MODE || "http";
  const primaryUrl = process.env.MUNINN_PRIMARY_URL || "";

  const env: Record<string, string> = {};
  if (mode) env.MUNINN_MODE = mode;
  if (primaryUrl) env.MUNINN_PRIMARY_URL = primaryUrl;

  return {
    command: "muninn-mcp",
    args: [],
    env: Object.keys(env).length > 0 ? env : undefined,
  };
}

function configureEditor(adapter: EditorAdapter, server: ServerConfig): void {
  const config = adapter.generateMcpConfig(server);

  // Ensure directory exists
  const dir = dirname(config.configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(config.configPath, config.content, "utf-8");
  console.log(`  Wrote MCP config: ${config.configPath}`);

  // Write instructions file if adapter provides one
  if (config.instructions) {
    const instrDir = dirname(config.instructions.path);
    if (instrDir !== "." && !existsSync(instrDir)) {
      mkdirSync(instrDir, { recursive: true });
    }
    const instrContent = adapter.generateInstructions(CORE_INSTRUCTIONS);
    writeFileSync(config.instructions.path, instrContent, "utf-8");
    console.log(`  Wrote instructions: ${config.instructions.path}`);
  }
}

export function handleSetup(args: string[]): void {
  const server = buildServerConfig();

  // --list: Show detected editors
  if (args.includes("--list")) {
    const all = getAllAdapters();
    console.log("\nDetected editors:");
    for (const adapter of all) {
      const installed = adapter.detect();
      const status = installed ? "installed" : "not found";
      const hooks = adapter.supportsHooks ? " (hooks supported)" : "";
      console.log(`  ${installed ? "+" : "-"} ${adapter.name}: ${status}${hooks}`);
    }
    console.log();
    return;
  }

  // --all: Configure all detected editors
  if (args.includes("--all")) {
    const detected = detectInstalledEditors();
    if (detected.length === 0) {
      console.log("No supported editors detected.");
      return;
    }

    console.log(`\nConfiguring ${detected.length} detected editor(s):\n`);
    for (const adapter of detected) {
      console.log(`${adapter.name}:`);
      configureEditor(adapter, server);
      console.log();
    }
    console.log("Done.");
    return;
  }

  // Specific editor: muninn setup cursor
  const editorArg = args.find((a) => !a.startsWith("--"));
  if (editorArg) {
    const adapter = getAdapter(editorArg as EditorId);
    if (!adapter) {
      console.error(`Unknown editor: ${editorArg}`);
      console.error(`Available: claude-code, cursor, windsurf, cline, vscode, neovim`);
      process.exit(1);
    }

    console.log(`\nConfiguring ${adapter.name}:\n`);
    configureEditor(adapter, server);

    if (args.includes("--hooks") && adapter.supportsHooks) {
      console.log("  Installing hooks...");
      // Hook installation is Claude Code-specific
      try {
        Bun.spawnSync(["muninn", "install-hook"], { stdout: "inherit", stderr: "inherit" });
      } catch {
        console.error("  Failed to install hooks (run manually: muninn install-hook)");
      }
    }

    console.log("\nDone.");
    return;
  }

  // Default: interactive detection
  const detected = detectInstalledEditors();
  if (detected.length === 0) {
    console.log("\nNo supported editors detected.");
    console.log("Muninn supports: Claude Code, Cursor, Windsurf, Cline, VS Code, Neovim");
    console.log("\nRun 'muninn setup <editor>' to configure manually.");
    return;
  }

  console.log(`\nDetected ${detected.length} editor(s):\n`);
  for (const adapter of detected) {
    console.log(`  ${adapter.name}`);
  }

  console.log("\nConfiguring all detected editors:\n");
  for (const adapter of detected) {
    console.log(`${adapter.name}:`);
    configureEditor(adapter, server);
    console.log();
  }
  console.log("Done.");
}
