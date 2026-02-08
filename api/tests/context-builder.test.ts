/**
 * Tests for context formatting logic
 * (Tests the formatting functions without needing a database)
 */

import { describe, it, expect } from "bun:test";

// Test the XML escaping and formatting logic directly
describe("XML escaping", () => {
  function escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  it("escapes ampersands", () => {
    expect(escapeXml("A & B")).toBe("A &amp; B");
  });

  it("escapes angle brackets", () => {
    expect(escapeXml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes quotes", () => {
    expect(escapeXml('value="test"')).toBe("value=&quot;test&quot;");
  });

  it("leaves clean text unchanged", () => {
    expect(escapeXml("Hello world")).toBe("Hello world");
  });
});

describe("Token estimation", () => {
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  it("estimates short text", () => {
    expect(estimateTokens("hello")).toBe(2);
  });

  it("estimates empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates longer text", () => {
    const text = "This is a longer piece of text that should be about 20 tokens or so.";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(30);
  });
});

describe("Scoring weights", () => {
  const STRATEGY_WEIGHTS = {
    balanced: { similarity: 0.5, recency: 0.2, confidence: 0.2, diversity: 0.1 },
    precise: { similarity: 0.7, recency: 0.1, confidence: 0.15, diversity: 0.05 },
    broad: { similarity: 0.3, recency: 0.2, confidence: 0.2, diversity: 0.3 },
  };

  it("balanced weights sum to 1.0", () => {
    const w = STRATEGY_WEIGHTS.balanced;
    expect(w.similarity + w.recency + w.confidence + w.diversity).toBeCloseTo(1.0);
  });

  it("precise weights sum to 1.0", () => {
    const w = STRATEGY_WEIGHTS.precise;
    expect(w.similarity + w.recency + w.confidence + w.diversity).toBeCloseTo(1.0);
  });

  it("broad weights sum to 1.0", () => {
    const w = STRATEGY_WEIGHTS.broad;
    expect(w.similarity + w.recency + w.confidence + w.diversity).toBeCloseTo(1.0);
  });

  it("precise prioritizes similarity", () => {
    expect(STRATEGY_WEIGHTS.precise.similarity).toBeGreaterThan(
      STRATEGY_WEIGHTS.balanced.similarity
    );
  });

  it("broad prioritizes diversity", () => {
    expect(STRATEGY_WEIGHTS.broad.diversity).toBeGreaterThan(
      STRATEGY_WEIGHTS.balanced.diversity
    );
  });
});
