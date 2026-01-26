/**
 * Error handling utilities tests
 * Tests error classes, factory functions, and safe wrappers
 */

import { describe, expect, test } from "bun:test";
import {
  ContextError,
  apiError,
  dbError,
  err,
  fileNotFoundError,
  invalidArgumentError,
  isErr,
  isOk,
  missingArgumentError,
  ok,
  parseError,
  safeJsonParse,
  safeParseInt,
  sshError,
  tryCatch,
  tryCatchSync,
  unwrap,
  unwrapOr,
  validationError,
} from "../../src/utils/errors";

describe("ContextError", () => {
  test("creates error with message and code", () => {
    const error = new ContextError("Something went wrong", "DB_QUERY_ERROR");
    expect(error.message).toBe("Something went wrong");
    expect(error.code).toBe("DB_QUERY_ERROR");
    expect(error.name).toBe("ContextError");
  });

  test("creates error with context", () => {
    const error = new ContextError("File error", "FILE_NOT_FOUND", {
      path: "/test.ts",
    });
    expect(error.context).toEqual({ path: "/test.ts" });
  });

  test("serializes to JSON correctly", () => {
    const error = new ContextError("Test error", "INVALID_ARGUMENT", {
      field: "name",
    });
    const json = error.toJSON();
    expect(json).toEqual({
      success: false,
      error: "Test error",
      code: "INVALID_ARGUMENT",
      context: { field: "name" },
    });
  });

  test("is instanceof Error", () => {
    const error = new ContextError("Test", "UNKNOWN_ERROR");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof ContextError).toBe(true);
  });
});

describe("Error Factory Functions", () => {
  describe("dbError", () => {
    test("creates DB_QUERY_ERROR", () => {
      const error = dbError("Query failed");
      expect(error.code).toBe("DB_QUERY_ERROR");
      expect(error.message).toBe("Query failed");
    });

    test("includes context", () => {
      const error = dbError("Query failed", { table: "users" });
      expect(error.context).toEqual({ table: "users" });
    });
  });

  describe("fileNotFoundError", () => {
    test("creates FILE_NOT_FOUND error", () => {
      const error = fileNotFoundError("/path/to/file.ts");
      expect(error.code).toBe("FILE_NOT_FOUND");
      expect(error.message).toBe("File not found: /path/to/file.ts");
      expect(error.context).toEqual({ path: "/path/to/file.ts" });
    });
  });

  describe("invalidArgumentError", () => {
    test("creates INVALID_ARGUMENT error", () => {
      const error = invalidArgumentError("Invalid value");
      expect(error.code).toBe("INVALID_ARGUMENT");
      expect(error.message).toBe("Invalid value");
    });

    test("includes context", () => {
      const error = invalidArgumentError("Invalid", { field: "age" });
      expect(error.context).toEqual({ field: "age" });
    });
  });

  describe("missingArgumentError", () => {
    test("creates MISSING_REQUIRED_ARGUMENT error", () => {
      const error = missingArgumentError("name");
      expect(error.code).toBe("MISSING_REQUIRED_ARGUMENT");
      expect(error.message).toBe("Missing required argument: name");
      expect(error.context).toEqual({ argument: "name" });
    });
  });

  describe("apiError", () => {
    test("creates API_ERROR", () => {
      const error = apiError("Request failed");
      expect(error.code).toBe("API_ERROR");
    });

    test("includes status code", () => {
      const error = apiError("Not found", 404);
      expect(error.context).toEqual({ status: 404 });
    });
  });

  describe("sshError", () => {
    test("creates SSH_ERROR", () => {
      const error = sshError("Connection refused");
      expect(error.code).toBe("SSH_ERROR");
    });

    test("includes server name", () => {
      const error = sshError("Connection refused", "prod-1");
      expect(error.context).toEqual({ server: "prod-1" });
    });
  });

  describe("validationError", () => {
    test("creates VALIDATION_ERROR", () => {
      const error = validationError("Invalid email");
      expect(error.code).toBe("VALIDATION_ERROR");
    });

    test("includes field name", () => {
      const error = validationError("Invalid email", "email");
      expect(error.context).toEqual({ field: "email" });
    });
  });

  describe("parseError", () => {
    test("creates PARSE_ERROR", () => {
      const error = parseError("Invalid JSON");
      expect(error.code).toBe("PARSE_ERROR");
    });

    test("includes source", () => {
      const error = parseError("Invalid JSON", "config.json");
      expect(error.context).toEqual({ source: "config.json" });
    });
  });
});

describe("Safe Wrappers", () => {
  describe("safeJsonParse", () => {
    test("parses valid JSON", () => {
      const result = safeJsonParse('{"name": "test"}', {});
      expect(result).toEqual({ name: "test" });
    });

    test("returns default for invalid JSON", () => {
      const result = safeJsonParse("not json", { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    test("returns default for empty string", () => {
      const result = safeJsonParse("", []);
      expect(result).toEqual([]);
    });

    test("parses arrays", () => {
      const result = safeJsonParse("[1, 2, 3]", []);
      expect(result).toEqual([1, 2, 3]);
    });

    test("parses primitives", () => {
      expect(safeJsonParse("123", 0)).toBe(123);
      expect(safeJsonParse('"hello"', "")).toBe("hello");
      expect(safeJsonParse("true", false)).toBe(true);
      expect(safeJsonParse("null", "default")).toBe(null);
    });
  });

  describe("safeParseInt", () => {
    test("parses valid integer string", () => {
      expect(safeParseInt("42", 0)).toBe(42);
      expect(safeParseInt("0", 10)).toBe(0);
      expect(safeParseInt("-5", 0)).toBe(-5);
    });

    test("returns default for undefined", () => {
      expect(safeParseInt(undefined, 10)).toBe(10);
    });

    test("returns default for empty string", () => {
      expect(safeParseInt("", 5)).toBe(5);
    });

    test("returns default for non-numeric string", () => {
      expect(safeParseInt("abc", 0)).toBe(0);
      expect(safeParseInt("12abc", 0)).toBe(12); // parseInt behavior
    });

    test("returns default for NaN", () => {
      expect(safeParseInt("NaN", 100)).toBe(100);
    });
  });

  describe("tryCatch", () => {
    test("returns ok for successful async function", async () => {
      const result = await tryCatch(async () => "success", "test");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("success");
      }
    });

    test("returns error for throwing async function", async () => {
      const result = await tryCatch(async () => {
        throw new Error("Failed");
      }, "test");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Failed");
      }
    });

    test("preserves ContextError type", async () => {
      const contextError = new ContextError("Test", "API_ERROR");
      const result = await tryCatch(async () => {
        throw contextError;
      }, "test");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(contextError);
      }
    });

    test("wraps non-Error throws", async () => {
      const result = await tryCatch(async () => {
        throw "string error";
      }, "test");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNKNOWN_ERROR");
      }
    });
  });

  describe("tryCatchSync", () => {
    test("returns ok for successful function", () => {
      const result = tryCatchSync(() => 42, "test");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    test("returns error for throwing function", () => {
      const result = tryCatchSync(() => {
        throw new Error("Sync fail");
      }, "test");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Sync fail");
      }
    });

    test("preserves ContextError type", () => {
      const contextError = new ContextError("Test", "VALIDATION_ERROR");
      const result = tryCatchSync(() => {
        throw contextError;
      }, "test");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(contextError);
      }
    });
  });
});

describe("Result Type Helpers", () => {
  describe("ok", () => {
    test("creates successful result", () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    test("works with any type", () => {
      expect(ok("string")).toEqual({ ok: true, value: "string" });
      expect(ok({ foo: "bar" })).toEqual({ ok: true, value: { foo: "bar" } });
      expect(ok([1, 2, 3])).toEqual({ ok: true, value: [1, 2, 3] });
      expect(ok(null)).toEqual({ ok: true, value: null });
    });
  });

  describe("err", () => {
    test("creates error result", () => {
      const error = new Error("Failed");
      const result = err(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });

    test("works with any error type", () => {
      const contextError = new ContextError("Test", "API_ERROR");
      const result = err(contextError);
      expect(result).toEqual({ ok: false, error: contextError });
    });
  });

  describe("isOk", () => {
    test("returns true for ok result", () => {
      const result = ok(42);
      expect(isOk(result)).toBe(true);
    });

    test("returns false for err result", () => {
      const result = err(new Error("Failed"));
      expect(isOk(result)).toBe(false);
    });
  });

  describe("isErr", () => {
    test("returns true for err result", () => {
      const result = err(new Error("Failed"));
      expect(isErr(result)).toBe(true);
    });

    test("returns false for ok result", () => {
      const result = ok(42);
      expect(isErr(result)).toBe(false);
    });
  });

  describe("unwrap", () => {
    test("returns value for ok result", () => {
      const result = ok(42);
      expect(unwrap(result)).toBe(42);
    });

    test("throws for err result", () => {
      const error = new Error("Failed");
      const result = err(error);
      expect(() => unwrap(result)).toThrow(error);
    });
  });

  describe("unwrapOr", () => {
    test("returns value for ok result", () => {
      const result = ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    test("returns default for err result", () => {
      const result = err(new Error("Failed"));
      expect(unwrapOr(result, 100)).toBe(100);
    });
  });
});
