/**
 * MCP Server Startup Smoke Test
 *
 * Verifies the MCP server module can be imported without throwing,
 * and that tool registration is correctly wired.
 */
import { describe, expect, test } from "bun:test";

describe("MCP Server Startup", () => {
  test("mcp-server.ts imports without throwing", async () => {
    // This verifies all static imports resolve and no top-level code throws
    const mod = await import("../../src/mcp-server");
    expect(mod).toBeDefined();
  });

  test("mcp-tool-definitions.ts has valid tool schemas", async () => {
    const { TOOL_DEFINITIONS } = await import("../../src/mcp-tool-definitions");

    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toMatch(/^muninn/);
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("mcp-handlers.ts imports without throwing", async () => {
    const mod = await import("../../src/mcp-handlers");
    expect(mod).toBeDefined();
    expect(typeof mod.handlePassthrough).toBe("function");
  });
});
