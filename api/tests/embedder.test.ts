/**
 * Tests for embedder service
 */

import { describe, it, expect } from "bun:test";
import { toVectorLiteral, EMBEDDING_DIMENSIONS } from "../src/services/embedder";

describe("toVectorLiteral", () => {
  it("formats a vector for pgvector", () => {
    const embedding = [0.1, 0.2, 0.3];
    expect(toVectorLiteral(embedding)).toBe("[0.1,0.2,0.3]");
  });

  it("handles empty vector", () => {
    expect(toVectorLiteral([])).toBe("[]");
  });

  it("handles single element", () => {
    expect(toVectorLiteral([1.0])).toBe("[1]");
  });

  it("preserves precision", () => {
    const embedding = [0.123456789, -0.987654321];
    const literal = toVectorLiteral(embedding);
    expect(literal).toBe("[0.123456789,-0.987654321]");
  });
});

describe("EMBEDDING_DIMENSIONS", () => {
  it("is 512 for voyage-3-lite", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(512);
  });
});
