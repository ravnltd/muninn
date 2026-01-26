/**
 * Embeddings utilities tests
 * Tests serialization, similarity calculations, and text representations
 */

import { describe, expect, test } from "bun:test";
import {
  cosineSimilarity,
  cosineSimilarityRaw,
  decisionToText,
  deserializeEmbedding,
  fileToText,
  getDimensions,
  getProvider,
  isEmbeddingAvailable,
  issueToText,
  learningToText,
  observationToText,
  questionToText,
  serializeEmbedding,
} from "../../src/embeddings/index";

describe("Provider Selection", () => {
  describe("getProvider", () => {
    test("returns valid provider", () => {
      const provider = getProvider();
      expect(["voyage", "local"]).toContain(provider);
    });
  });

  describe("isEmbeddingAvailable", () => {
    test("returns true (local always available)", () => {
      expect(isEmbeddingAvailable()).toBe(true);
    });
  });

  describe("getDimensions", () => {
    test("returns positive number", () => {
      const dims = getDimensions();
      expect(dims).toBeGreaterThan(0);
      // Local uses 384, Voyage uses 512
      expect([384, 512]).toContain(dims);
    });
  });
});

describe("Serialization", () => {
  describe("serializeEmbedding", () => {
    test("serializes Float32Array to Buffer", () => {
      const embedding = new Float32Array([1.0, 2.0, 3.0, 4.0]);
      const buffer = serializeEmbedding(embedding);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(16); // 4 floats * 4 bytes
    });

    test("preserves values through serialization", () => {
      const original = new Float32Array([0.5, -0.5, 1.0, -1.0]);
      const buffer = serializeEmbedding(original);
      const restored = deserializeEmbedding(buffer);
      expect(restored.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });

    test("handles empty array", () => {
      const embedding = new Float32Array([]);
      const buffer = serializeEmbedding(embedding);
      expect(buffer.length).toBe(0);
    });
  });

  describe("deserializeEmbedding", () => {
    test("deserializes Buffer to Float32Array", () => {
      const original = new Float32Array([1.5, 2.5, 3.5]);
      const buffer = serializeEmbedding(original);
      const result = deserializeEmbedding(buffer);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(3);
    });

    test("handles Uint8Array input", () => {
      const original = new Float32Array([1.0, 2.0]);
      const buffer = serializeEmbedding(original);
      const uint8 = new Uint8Array(buffer);
      const result = deserializeEmbedding(uint8);
      expect(result.length).toBe(2);
    });

    test("roundtrip preserves precision", () => {
      const values = [0.123456789, -0.987654321, 0.000001, 1000000.0];
      const original = new Float32Array(values);
      const buffer = serializeEmbedding(original);
      const restored = deserializeEmbedding(buffer);
      // Float32 has ~7 digits of precision
      for (let i = 0; i < values.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });
  });
});

describe("Similarity Functions", () => {
  describe("cosineSimilarity", () => {
    test("returns 1 for identical vectors", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    test("returns -1 for opposite vectors", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    test("returns 0 for orthogonal vectors", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    test("returns 0 for dimension mismatch", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    test("returns 0 for zero vectors", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    test("handles normalized vectors", () => {
      // Pre-normalized unit vectors
      const a = new Float32Array([1 / Math.sqrt(2), 1 / Math.sqrt(2), 0]);
      const b = new Float32Array([1, 0, 0]);
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(1 / Math.sqrt(2), 5);
    });

    test("is symmetric", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([5, 6, 7, 8]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
    });

    test("handles large vectors", () => {
      const size = 384; // Local embedding size
      const a = new Float32Array(size).fill(0.1);
      const b = new Float32Array(size).fill(0.1);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    test("handles negative values", () => {
      const a = new Float32Array([-1, -2, -3]);
      const b = new Float32Array([-1, -2, -3]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });
  });

  describe("cosineSimilarityRaw", () => {
    test("converts number arrays and calculates similarity", () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      expect(cosineSimilarityRaw(a, b)).toBeCloseTo(1, 5);
    });

    test("handles regular arrays", () => {
      const a = [0.5, 0.5, 0.5];
      const b = [0.5, 0.5, 0.5];
      expect(cosineSimilarityRaw(a, b)).toBeCloseTo(1, 5);
    });
  });
});

describe("Text Representations", () => {
  describe("fileToText", () => {
    test("combines path and purpose", () => {
      const result = fileToText("src/utils.ts", "Utility functions");
      expect(result).toBe("src/utils.ts Utility functions");
    });

    test("handles null purpose", () => {
      const result = fileToText("src/index.ts", null);
      expect(result).toBe("src/index.ts");
    });

    test("handles empty purpose", () => {
      const result = fileToText("test.ts", "");
      expect(result).toBe("test.ts");
    });
  });

  describe("decisionToText", () => {
    test("combines all fields", () => {
      const result = decisionToText(
        "Use TypeScript",
        "Better type safety",
        "Catches bugs early"
      );
      expect(result).toBe("Use TypeScript Better type safety Catches bugs early");
    });

    test("handles null reasoning", () => {
      const result = decisionToText("Title", "Decision", null);
      expect(result).toBe("Title Decision");
    });
  });

  describe("issueToText", () => {
    test("combines all fields", () => {
      const result = issueToText(
        "Bug in auth",
        "Users cannot login",
        "Restart server"
      );
      expect(result).toBe("Bug in auth Users cannot login Restart server");
    });

    test("handles null description and workaround", () => {
      const result = issueToText("Bug title", null, null);
      expect(result).toBe("Bug title");
    });

    test("handles partial nulls", () => {
      const result = issueToText("Bug", "Description", null);
      expect(result).toBe("Bug Description");
    });
  });

  describe("learningToText", () => {
    test("combines all fields", () => {
      const result = learningToText(
        "Pattern name",
        "Pattern content",
        "When to use"
      );
      expect(result).toBe("Pattern name Pattern content When to use");
    });

    test("handles null context", () => {
      const result = learningToText("Title", "Content", null);
      expect(result).toBe("Title Content");
    });
  });

  describe("observationToText", () => {
    test("combines type and content", () => {
      const result = observationToText("User clicked button", "action");
      expect(result).toBe("action: User clicked button");
    });
  });

  describe("questionToText", () => {
    test("combines question and context", () => {
      const result = questionToText(
        "How does auth work?",
        "Investigating login flow"
      );
      expect(result).toBe("How does auth work? Investigating login flow");
    });

    test("handles null context", () => {
      const result = questionToText("What is the API?", null);
      expect(result).toBe("What is the API?");
    });
  });
});
