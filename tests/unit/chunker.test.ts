/**
 * Code chunker tests
 * Tests language detection, TypeScript/JavaScript parsing, and chunk extraction
 */

import { describe, expect, test } from "bun:test";
import {
  chunkToSearchText,
  detectLanguage,
  parseGo,
  parseTypeScript,
} from "../../src/analysis/chunker";

describe("Language Detection", () => {
  describe("detectLanguage", () => {
    test("detects TypeScript files", () => {
      expect(detectLanguage("src/index.ts")).toBe("typescript");
      expect(detectLanguage("Component.tsx")).toBe("typescript");
    });

    test("detects JavaScript files", () => {
      expect(detectLanguage("index.js")).toBe("javascript");
      expect(detectLanguage("App.jsx")).toBe("javascript");
      expect(detectLanguage("module.mjs")).toBe("javascript");
      expect(detectLanguage("common.cjs")).toBe("javascript");
    });

    test("detects Go files", () => {
      expect(detectLanguage("main.go")).toBe("go");
    });

    test("detects Python files", () => {
      expect(detectLanguage("script.py")).toBe("python");
    });

    test("detects Rust files", () => {
      expect(detectLanguage("lib.rs")).toBe("rust");
    });

    test("detects Svelte files", () => {
      expect(detectLanguage("Component.svelte")).toBe("svelte");
    });

    test("detects Vue files", () => {
      expect(detectLanguage("Component.vue")).toBe("vue");
    });

    test("returns null for unknown extensions", () => {
      expect(detectLanguage("file.unknown")).toBeNull();
      expect(detectLanguage("file.txt")).toBeNull();
      expect(detectLanguage("file.md")).toBeNull();
    });

    test("handles files with multiple dots", () => {
      expect(detectLanguage("file.test.ts")).toBe("typescript");
      expect(detectLanguage("file.spec.tsx")).toBe("typescript");
    });

    test("handles case insensitivity", () => {
      expect(detectLanguage("FILE.TS")).toBe("typescript");
      expect(detectLanguage("file.JS")).toBe("javascript");
    });

    test("handles files without extension", () => {
      expect(detectLanguage("Makefile")).toBeNull();
      expect(detectLanguage("README")).toBeNull();
    });
  });
});

describe("TypeScript/JavaScript Parser", () => {
  describe("parseTypeScript", () => {
    test("parses exported function", () => {
      const code = `export function greet(name: string): string {
  return "Hello, " + name;
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("greet");
      expect(result.chunks[0].type).toBe("function");
      expect(result.chunks[0].exported).toBe(true);
      expect(result.chunks[0].parameters).toEqual(["name"]);
      expect(result.chunks[0].returnType).toBe("string");
    });

    test("parses async function", () => {
      const code = `export async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("fetchData");
      expect(result.chunks[0].signature).toContain("async");
    });

    test("parses non-exported function", () => {
      const code = `function helper() {
  return 42;
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("helper");
      expect(result.chunks[0].exported).toBe(false);
    });

    test("parses arrow function", () => {
      const code = `export const add = (a: number, b: number): number => {
  return a + b;
};`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("add");
      expect(result.chunks[0].type).toBe("function");
    });

    test("parses class", () => {
      const code = `export class UserService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  getUser(id: string) {
    return this.db.find(id);
  }
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("UserService");
      expect(result.chunks[0].type).toBe("class");
      expect(result.chunks[0].exported).toBe(true);
    });

    test("parses abstract class", () => {
      const code = `export abstract class BaseHandler {
  abstract handle(): void;
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("BaseHandler");
      expect(result.chunks[0].type).toBe("class");
    });

    test("parses interface", () => {
      const code = `export interface User {
  id: string;
  name: string;
  email: string;
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("User");
      expect(result.chunks[0].type).toBe("interface");
    });

    test("parses interface with extends", () => {
      const code = `interface Admin extends User {
  role: string;
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("Admin");
      expect(result.chunks[0].exported).toBe(false);
    });

    test("parses type alias", () => {
      const code = `export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("Result");
      expect(result.chunks[0].type).toBe("type");
    });

    test("parses exported const", () => {
      const code = `export const MAX_RETRIES = 3;`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("MAX_RETRIES");
      expect(result.chunks[0].type).toBe("constant");
    });

    test("PascalCase arrow function detected as function", () => {
      // Arrow functions are detected as type "function" regardless of React usage
      // Component detection requires different patterns
      const code = `export const UserCard = () => {
  return <div>User</div>;
};`;
      const result = parseTypeScript(code, "test.tsx");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("UserCard");
      expect(result.chunks[0].type).toBe("function");
      expect(result.chunks[0].exported).toBe(true);
    });

    test("extracts purpose from JSDoc comment", () => {
      const code = `/**
 * Validates user input against schema
 * @param input The input to validate
 */
export function validate(input: unknown) {
  return true;
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].purpose).toBe("Validates user input against schema");
    });

    test("handles nested braces in strings", () => {
      const code = `export function format(value: string): string {
  return "{" + value + "}";
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].endLine).toBeGreaterThan(result.chunks[0].startLine);
    });

    test("handles multiple chunks", () => {
      const code = `export function first() {
  return 1;
}

export function second() {
  return 2;
}

export interface Config {
  value: string;
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks.length).toBeGreaterThanOrEqual(3);
    });

    test("handles empty file", () => {
      const result = parseTypeScript("", "test.ts");
      expect(result.chunks).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    test("handles comments only", () => {
      const code = `// This is a comment
/* Multi-line
   comment */`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(0);
    });

    test("handles generic functions", () => {
      const code = `export function identity<T>(value: T): T {
  return value;
}`;
      const result = parseTypeScript(code, "test.ts");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("identity");
    });

    test("returns correct file path and language", () => {
      const result = parseTypeScript("", "src/utils.ts");
      expect(result.file).toBe("src/utils.ts");
      expect(result.language).toBe("typescript");
    });
  });
});

describe("Go Parser", () => {
  describe("parseGo", () => {
    test("parses exported function (PascalCase)", () => {
      const code = `func GetUser(id string) *User {
	return nil
}`;
      const result = parseGo(code, "main.go");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("GetUser");
      expect(result.chunks[0].type).toBe("function");
      expect(result.chunks[0].exported).toBe(true);
    });

    test("parses unexported function (camelCase)", () => {
      const code = `func helper() int {
	return 42
}`;
      const result = parseGo(code, "main.go");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("helper");
      expect(result.chunks[0].exported).toBe(false);
    });

    test("parses method with receiver", () => {
      const code = `func (s *Service) DoWork() error {
	return nil
}`;
      const result = parseGo(code, "main.go");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("DoWork");
    });

    test("parses struct", () => {
      const code = `type User struct {
	ID   string
	Name string
}`;
      const result = parseGo(code, "main.go");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("User");
      expect(result.chunks[0].type).toBe("class"); // structs mapped to class
    });

    test("parses interface", () => {
      const code = `type Repository interface {
	Find(id string) (*User, error)
	Save(user *User) error
}`;
      const result = parseGo(code, "main.go");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe("Repository");
      expect(result.chunks[0].type).toBe("interface");
    });

    test("clears comment when hitting function line", () => {
      // Go parser clears pendingComment when it starts parsing a function
      const code = `// ProcessData handles data processing
func ProcessData(data []byte) error {
	return nil
}`;
      const result = parseGo(code, "main.go");
      expect(result.chunks).toHaveLength(1);
      // Comment is trimmed/cleared before being associated with the function
      // because pendingComment is cleared on function match
      expect(result.chunks[0].purpose).toBeUndefined();
    });

    test("returns correct language", () => {
      const result = parseGo("", "main.go");
      expect(result.language).toBe("go");
    });
  });
});

describe("Chunk Utilities", () => {
  describe("chunkToSearchText", () => {
    test("combines chunk properties into searchable text", () => {
      const text = chunkToSearchText({
        name: "validateUser",
        type: "function",
        signature: "function validateUser(user: User): boolean",
        body: "return user.valid;",
        startLine: 1,
        endLine: 3,
        purpose: "Validates user object",
        parameters: ["user"],
        returnType: "boolean",
        exported: true,
      });
      expect(text).toContain("validateUser");
      expect(text).toContain("function");
      expect(text).toContain("Validates user object");
      expect(text).toContain("user");
      expect(text).toContain("boolean");
    });

    test("handles missing optional fields", () => {
      const text = chunkToSearchText({
        name: "helper",
        type: "function",
        signature: "function helper()",
        body: "{}",
        startLine: 1,
        endLine: 1,
        exported: false,
      });
      expect(text).toContain("helper");
      expect(text).toContain("function");
    });
  });
});
