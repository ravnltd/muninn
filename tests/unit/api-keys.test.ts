/**
 * API Key utilities tests
 * Tests key validation, redaction, and status checking
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  checkApiKey,
  getApiKey,
  getApiKeysSummary,
  getMaskedKey,
  isApiKeyAvailable,
  redactApiKeys,
} from "../../src/utils/api-keys";

describe("redactApiKeys", () => {
  test("redacts Anthropic API keys", () => {
    const text = "API key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456";
    const result = redactApiKeys(text);
    expect(result).toBe("API key is [ANTHROPIC_KEY_REDACTED]");
  });

  test("redacts Voyage API keys", () => {
    const text = "Voyage key: pa-abcdefghijklmnopqrstuvwxyz";
    const result = redactApiKeys(text);
    expect(result).toBe("Voyage key: [VOYAGE_KEY_REDACTED]");
  });

  test("redacts Bearer tokens", () => {
    const text = "Authorization: Bearer abc123xyz456";
    const result = redactApiKeys(text);
    expect(result).toBe("Authorization: Bearer [REDACTED]");
  });

  test("redacts x-api-key headers (case insensitive)", () => {
    const text = "x-api-key: secret123abc";
    const result = redactApiKeys(text);
    expect(result).toBe("x-api-key: [REDACTED]");

    // Uppercase version - regex replaces with lowercase pattern
    const textUpper = "X-API-KEY: secret123abc";
    const resultUpper = redactApiKeys(textUpper);
    expect(resultUpper).toBe("x-api-key: [REDACTED]");
  });

  test("redacts multiple keys in same text", () => {
    const text =
      "Keys: sk-ant-api03-abc123456789012345678901 and pa-xyz987654321098765432109";
    const result = redactApiKeys(text);
    expect(result).toBe(
      "Keys: [ANTHROPIC_KEY_REDACTED] and [VOYAGE_KEY_REDACTED]"
    );
  });

  test("preserves text without keys", () => {
    const text = "No API keys here, just regular text.";
    const result = redactApiKeys(text);
    expect(result).toBe(text);
  });

  test("handles empty string", () => {
    expect(redactApiKeys("")).toBe("");
  });

  test("redacts even short key-like patterns", () => {
    // The regex pattern /sk-ant-[a-zA-Z0-9-_]+/ matches any length after prefix
    const text = "sk-ant-short";
    const result = redactApiKeys(text);
    expect(result).toBe("[ANTHROPIC_KEY_REDACTED]");
  });
});

describe("API Key Status (with mocked env)", () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // Clear API keys for testing
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.VOYAGE_API_KEY;
  });

  afterAll(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe("checkApiKey", () => {
    test("returns unavailable when key not set", () => {
      const status = checkApiKey("anthropic");
      expect(status.available).toBe(false);
      expect(status.valid).toBe(false);
      expect(status.error).toContain("not set");
    });

    test("detects whitespace in key", () => {
      process.env.ANTHROPIC_API_KEY =
        " sk-ant-api03-abcdefghijklmnopqrstuvwxyz ";
      const status = checkApiKey("anthropic");
      expect(status.available).toBe(true);
      expect(status.valid).toBe(false);
      expect(status.error).toContain("whitespace");
      delete process.env.ANTHROPIC_API_KEY;
    });

    test("detects truncated key", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-short";
      const status = checkApiKey("anthropic");
      expect(status.available).toBe(true);
      expect(status.valid).toBe(false);
      expect(status.error).toContain("truncated");
      delete process.env.ANTHROPIC_API_KEY;
    });

    test("validates correct Anthropic key format", () => {
      process.env.ANTHROPIC_API_KEY =
        "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
      const status = checkApiKey("anthropic");
      expect(status.available).toBe(true);
      expect(status.valid).toBe(true);
      expect(status.error).toBeUndefined();
      delete process.env.ANTHROPIC_API_KEY;
    });

    test("validates correct Voyage key format", () => {
      process.env.VOYAGE_API_KEY = "pa-abcdefghijklmnopqrstuvwxyz";
      const status = checkApiKey("voyage");
      expect(status.available).toBe(true);
      expect(status.valid).toBe(true);
      expect(status.error).toBeUndefined();
      delete process.env.VOYAGE_API_KEY;
    });

    test("warns about invalid format but allows key", () => {
      process.env.ANTHROPIC_API_KEY = "invalid-format-but-long-enough-key-12345";
      const status = checkApiKey("anthropic");
      expect(status.available).toBe(true);
      expect(status.valid).toBe(true); // Allows through
      expect(status.error).toContain("format may be invalid");
      delete process.env.ANTHROPIC_API_KEY;
    });
  });

  describe("isApiKeyAvailable", () => {
    test("returns false when key not set", () => {
      expect(isApiKeyAvailable("anthropic")).toBe(false);
    });

    test("returns true when key is set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-api03-test1234567890123456";
      expect(isApiKeyAvailable("anthropic")).toBe(true);
      delete process.env.ANTHROPIC_API_KEY;
    });
  });

  describe("getApiKey", () => {
    test("returns error when key not available", () => {
      const result = getApiKey("anthropic");
      expect(result.ok).toBe(false);
    });

    test("returns key when valid", () => {
      const testKey = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
      process.env.ANTHROPIC_API_KEY = testKey;
      const result = getApiKey("anthropic");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(testKey);
      }
      delete process.env.ANTHROPIC_API_KEY;
    });
  });

  describe("getMaskedKey", () => {
    test("returns null when key not set", () => {
      expect(getMaskedKey("anthropic")).toBeNull();
    });

    test("returns null for short key", () => {
      process.env.ANTHROPIC_API_KEY = "short";
      expect(getMaskedKey("anthropic")).toBeNull();
      delete process.env.ANTHROPIC_API_KEY;
    });

    test("returns masked key for valid key", () => {
      process.env.ANTHROPIC_API_KEY =
        "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
      const masked = getMaskedKey("anthropic");
      expect(masked).not.toBeNull();
      expect(masked).toMatch(/^sk-ant-a\.\.\.wxyz$/);
      delete process.env.ANTHROPIC_API_KEY;
    });
  });

  describe("getApiKeysSummary", () => {
    test("returns status for all key types", () => {
      const summary = getApiKeysSummary();
      expect(summary).toHaveProperty("anthropic");
      expect(summary).toHaveProperty("voyage");
      expect(summary.anthropic).toHaveProperty("available");
      expect(summary.anthropic).toHaveProperty("valid");
    });
  });
});
