import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "../../hooks/block-attribution.sh");

function run(payload: Record<string, unknown>): number {
  const proc = Bun.spawnSync(["bash", HOOK], { stdin: Buffer.from(JSON.stringify(payload)) });
  return proc.exitCode;
}

const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });

describe("block-attribution hook", () => {
  test("blocks git commit with Co-Authored-By: Claude", () => {
    const msg = "fix: thing\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
    expect(run(bash(`git commit -m "$(cat <<'EOF'\n${msg}\nEOF\n)"`))).toBe(2);
  });

  test("blocks gh pr create with Generated with Claude Code", () => {
    expect(run(bash('gh pr create --body "Summary\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"'))).toBe(2);
  });

  test("blocks attribution in a GitHub MCP pull request", () => {
    const payload = { tool_name: "mcp__github__create_pull_request", tool_input: { body: "Generated with Claude Code" } };
    expect(run(payload)).toBe(2);
  });

  test("allows a clean commit", () => {
    expect(run(bash('git commit -m "fix: thing"'))).toBe(0);
  });

  test("allows non-git commands and non-git tools that mention the pattern", () => {
    expect(run(bash('echo "Co-Authored-By: Claude" > notes.txt'))).toBe(0);
    expect(run({ tool_name: "Write", tool_input: { content: "Generated with Claude Code" } })).toBe(0);
  });

  describe("git commit -F / --file", () => {
    const dir = mkdtempSync(join(tmpdir(), "attr-"));
    const attributed = "fix: thing\n\n" + "Co-Authored-By" + ": Claude <noreply@" + "anthropic.com>";
    writeFileSync(join(dir, "bad.txt"), attributed);
    writeFileSync(join(dir, "good.txt"), "fix: thing\n");

    test("blocks -F with an attributed file", () => {
      expect(run(bash(`git commit -F ${join(dir, "bad.txt")}`))).toBe(2);
    });

    test("blocks --file= with a relative path resolved via cwd", () => {
      expect(run({ ...bash("git commit --file=bad.txt"), cwd: dir })).toBe(2);
    });

    test("allows -F with a clean file", () => {
      expect(run(bash(`git commit -F ${join(dir, "good.txt")}`))).toBe(0);
    });

    test("allows a missing file", () => {
      expect(run({ ...bash("git commit -F nope.txt"), cwd: dir })).toBe(0);
    });
  });
});
