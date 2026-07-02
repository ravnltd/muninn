/**
 * v10 Prompt Map tests — task-scoped map matching for UserPromptSubmit.
 */

import { describe, expect, test } from "bun:test";
import { matchPrompt, formatTaskMap, tokenize, shouldSkipPrompt } from "../../src/v9/prompt-map";
import type { PromptMap } from "../../src/v9/context-cache";

function makeMap(): PromptMap {
  return {
    version: 1,
    generatedAt: "2026-07-01T00:00:00Z",
    files: [
      {
        p: "src/auth/login.ts",
        purpose: "Handles user login and session token issuance",
        t: "route",
        frag: 7,
        sym: ["loginUser", "issueToken"],
      },
      {
        p: "src/auth/session.ts",
        purpose: "Session storage and expiry",
        t: "module",
        frag: 4,
        sym: ["SessionStore"],
      },
      {
        p: "src/billing/invoice.ts",
        purpose: "Generates PDF invoices",
        t: "module",
        frag: 2,
        sym: ["renderInvoice"],
      },
      { p: "src/utils/strings.ts", purpose: null, t: "util", frag: 1, sym: ["capitalize"] },
    ],
    rel: [["src/auth/login.ts", "src/auth/session.ts", 9]],
  };
}

describe("tokenize", () => {
  test("splits camelCase, kebab, and paths; drops stopwords", () => {
    expect(tokenize("fix the loginUser token-refresh in src/auth")).toEqual([
      "login", "user", "token", "refresh", "src", "auth",
    ]);
  });
});

describe("matchPrompt", () => {
  test("finds files by domain words in prompt", () => {
    const matches = matchPrompt("the login session token flow is broken after expiry", makeMap());
    const paths = matches.map((m) => m.path);
    expect(paths).toContain("src/auth/login.ts");
    expect(paths).toContain("src/auth/session.ts");
    expect(paths).not.toContain("src/billing/invoice.ts");
  });

  test("returns nothing for prompts with no code-locating words", () => {
    expect(matchPrompt("yes do it now thanks", makeMap())).toEqual([]);
  });

  test("returns nothing for unrelated domains", () => {
    expect(matchPrompt("refactor the kubernetes deployment manifests", makeMap())).toEqual([]);
  });

  test("ranks filename matches above purpose-only matches", () => {
    const matches = matchPrompt("invoice rendering produces corrupt PDF invoices", makeMap());
    expect(matches[0]?.path).toBe("src/billing/invoice.ts");
  });
});

describe("formatTaskMap", () => {
  test("includes purposes, fragility warnings, and relationships", () => {
    const map = makeMap();
    const matches = matchPrompt("login session token expiry bug", map);
    const output = formatTaskMap(matches, map);

    expect(output).toContain("[muninn task map — likely relevant files]");
    expect(output).toContain("src/auth/login.ts — Handles user login and session token issuance");
    expect(output).toContain("fragility 7/10");
    expect(output).toContain("src/auth/login.ts + src/auth/session.ts (9x)");
  });

  test("empty matches produce empty output", () => {
    expect(formatTaskMap([], makeMap())).toBe("");
  });
});

describe("shouldSkipPrompt", () => {
  test("skips short prompts, slash commands, and shell escapes", () => {
    expect(shouldSkipPrompt("yes")).toBe(true);
    expect(shouldSkipPrompt("/code-review")).toBe(true);
    expect(shouldSkipPrompt("! git status")).toBe(true);
    expect(shouldSkipPrompt("fix the login session expiry handling")).toBe(false);
  });
});
