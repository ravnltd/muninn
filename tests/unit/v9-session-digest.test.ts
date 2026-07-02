/**
 * v10 Session Digest tests — transcript parsing for PreCompact forever memory.
 */

import { describe, expect, test } from "bun:test";
import { parseTranscript, composeDigest } from "../../src/v9/session-digest";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

function makeTranscript(): string {
  return [
    line({
      type: "user",
      message: { role: "user", content: "fix the login session expiry handling in the auth module" },
    }),
    line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Looking at the auth module." },
          { type: "tool_use", name: "Edit", input: { file_path: "/repo/src/auth/session.ts" } },
        ],
      },
    }),
    line({ type: "user", message: { role: "user", content: "yes" } }),
    line({ type: "user", message: { role: "user", content: "/compact" } }),
    line({
      type: "user",
      message: { role: "user", content: "<system-reminder>hook noise</system-reminder>" },
    }),
    line({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Write", input: { file_path: "/repo/src/auth/session.test.ts" } }],
      },
    }),
    line({
      type: "user",
      message: { role: "user", content: "now make the expiry configurable per tenant" },
    }),
    "not json at all",
  ].join("\n");
}

describe("parseTranscript", () => {
  test("extracts real user goals, skipping confirmations, commands, and reminders", () => {
    const digest = parseTranscript(makeTranscript());
    expect(digest.userGoals).toEqual([
      "fix the login session expiry handling in the auth module",
      "now make the expiry configurable per tenant",
    ]);
  });

  test("collects edited files from Edit and Write tool calls", () => {
    const digest = parseTranscript(makeTranscript());
    expect(digest.filesEdited).toEqual(["/repo/src/auth/session.ts", "/repo/src/auth/session.test.ts"]);
  });

  test("caps goals at first + most recent", () => {
    const goals = Array.from({ length: 12 }, (_, i) =>
      line({ type: "user", message: { role: "user", content: `long enough user goal number ${i} for the parser` } }),
    ).join("\n");
    const digest = parseTranscript(goals);
    expect(digest.userGoals.length).toBe(6);
    expect(digest.userGoals[0]).toContain("number 0");
    expect(digest.userGoals[5]).toContain("number 11");
  });

  test("tolerates malformed lines and empty input", () => {
    expect(parseTranscript("").userGoals).toEqual([]);
    expect(parseTranscript("garbage\n{broken").filesEdited).toEqual([]);
  });
});

describe("composeDigest", () => {
  test("produces compact digest text", () => {
    const text = composeDigest(parseTranscript(makeTranscript()));
    expect(text).toContain("Compaction digest");
    expect(text).toContain("- fix the login session expiry handling in the auth module");
    expect(text).toContain("Files edited: /repo/src/auth/session.ts");
  });

  test("empty digest produces empty string", () => {
    expect(composeDigest({ userGoals: [], filesEdited: [], messageCount: 0 })).toBe("");
  });
});
