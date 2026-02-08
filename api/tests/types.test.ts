/**
 * Tests for Zod validation schemas
 */

import { describe, it, expect } from "bun:test";
import {
  MemoryInputSchema,
  MemoryUpdateSchema,
  SearchRequestSchema,
  ContextRequestSchema,
  BatchOperationSchema,
  AppInputSchema,
  AppTypeInputSchema,
  GrantInputSchema,
} from "../src/types";

describe("MemoryInputSchema", () => {
  it("validates a valid memory input", () => {
    const input = {
      scope: "household:testuser",
      type: "fact",
      title: "Climate zone",
      content: "Climate zone is 5b, Colorado Front Range",
    };
    const result = MemoryInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("validates with all optional fields", () => {
    const input = {
      scope: "household:testuser",
      type: "entity",
      subtype: "pet",
      title: "Bear the dog",
      content: "Golden retriever puppy named Bear",
      metadata: { breed: "golden_retriever" },
      confidence: 0.95,
      source: "user" as const,
      tags: ["pet", "dog"],
      related_to: ["550e8400-e29b-41d4-a716-446655440000"],
    };
    const result = MemoryInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const input = { scope: "test" };
    const result = MemoryInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid type", () => {
    const input = {
      scope: "test",
      type: "invalid_type",
      title: "Test",
      content: "Test content",
    };
    const result = MemoryInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects confidence out of range", () => {
    const input = {
      scope: "test",
      type: "fact",
      title: "Test",
      content: "Test content",
      confidence: 1.5,
    };
    const result = MemoryInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid source", () => {
    const input = {
      scope: "test",
      type: "fact",
      title: "Test",
      content: "Test content",
      source: "magic",
    };
    const result = MemoryInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const input = {
      scope: "test",
      type: "fact",
      title: "",
      content: "Test content",
    };
    const result = MemoryInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("MemoryUpdateSchema", () => {
  it("validates a partial update", () => {
    const update = { title: "Updated title" };
    const result = MemoryUpdateSchema.safeParse(update);
    expect(result.success).toBe(true);
  });

  it("validates empty object (no fields to update)", () => {
    const result = MemoryUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("allows nullable subtype", () => {
    const result = MemoryUpdateSchema.safeParse({ subtype: null });
    expect(result.success).toBe(true);
  });
});

describe("SearchRequestSchema", () => {
  it("validates a minimal search", () => {
    const request = { query: "garden maintenance" };
    const result = SearchRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
      expect(result.data.mode).toBe("hybrid");
    }
  });

  it("validates a full search request", () => {
    const request = {
      query: "veterinary appointments",
      scopes: ["household:testuser"],
      types: ["entity", "event"],
      tags: ["pet", "medical"],
      min_confidence: 0.5,
      limit: 50,
      offset: 10,
      mode: "semantic" as const,
    };
    const result = SearchRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it("rejects limit over 100", () => {
    const result = SearchRequestSchema.safeParse({ query: "test", limit: 101 });
    expect(result.success).toBe(false);
  });
});

describe("ContextRequestSchema", () => {
  it("validates a minimal context request", () => {
    const request = { prompt: "What are the upcoming vet appointments?" };
    const result = ContextRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_tokens).toBe(2000);
      expect(result.data.format).toBe("xml");
      expect(result.data.strategy).toBe("balanced");
    }
  });

  it("validates a full context request", () => {
    const request = {
      prompt: "User asking about dog care",
      scopes: ["household:testuser"],
      max_tokens: 1500,
      format: "markdown" as const,
      filters: {
        types: ["entity", "procedure"],
        tags: ["pet"],
        min_confidence: 0.7,
      },
      strategy: "precise" as const,
    };
    const result = ContextRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });
});

describe("BatchOperationSchema", () => {
  it("validates batch with mixed operations", () => {
    const batch = {
      operations: [
        {
          action: "create" as const,
          data: {
            scope: "test",
            type: "fact" as const,
            title: "New fact",
            content: "Something true",
          },
        },
        {
          action: "update" as const,
          id: "550e8400-e29b-41d4-a716-446655440000",
          data: { title: "Updated" },
        },
        {
          action: "delete" as const,
          id: "550e8400-e29b-41d4-a716-446655440001",
        },
      ],
    };
    const result = BatchOperationSchema.safeParse(batch);
    expect(result.success).toBe(true);
  });

  it("rejects empty operations", () => {
    const result = BatchOperationSchema.safeParse({ operations: [] });
    expect(result.success).toBe(false);
  });

  it("rejects over 100 operations", () => {
    const ops = Array.from({ length: 101 }, () => ({
      action: "delete" as const,
      id: "550e8400-e29b-41d4-a716-446655440000",
    }));
    const result = BatchOperationSchema.safeParse({ operations: ops });
    expect(result.success).toBe(false);
  });
});

describe("AppInputSchema", () => {
  it("validates a valid app", () => {
    const result = AppInputSchema.safeParse({
      id: "huginn",
      name: "Huginn Household Manager",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid app ID characters", () => {
    const result = AppInputSchema.safeParse({
      id: "My App!",
      name: "Test",
    });
    expect(result.success).toBe(false);
  });
});

describe("AppTypeInputSchema", () => {
  it("validates a type registration", () => {
    const result = AppTypeInputSchema.safeParse({
      id: "pet",
      base_type: "entity",
      description: "A household pet",
    });
    expect(result.success).toBe(true);
  });
});

describe("GrantInputSchema", () => {
  it("validates a grant", () => {
    const result = GrantInputSchema.safeParse({
      granted_app: "studio",
      permission: "read",
      scopes: ["household:testuser"],
    });
    expect(result.success).toBe(true);
  });

  it("defaults permission to read", () => {
    const result = GrantInputSchema.safeParse({ granted_app: "studio" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permission).toBe("read");
    }
  });
});
