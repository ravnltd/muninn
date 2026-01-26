/**
 * Validation utilities tests
 * Tests Zod schemas and argument parsing functions
 */

import { describe, expect, test } from "bun:test";
import {
  DecisionAddInput,
  DebtAddInput,
  DebtEffortSchema,
  FileAddInput,
  FileStatusSchema,
  FileTypeSchema,
  FragilityScore,
  HealthStatusSchema,
  IssueAddInput,
  IssueTypeSchema,
  LearnAddInput,
  LearningCategorySchema,
  NonEmptyString,
  NonNegativeInt,
  OptionalString,
  PatternAddInput,
  PositiveInt,
  RouteAddInput,
  ServerAddInput,
  ServerRoleSchema,
  ServerStatusSchema,
  ServiceAddInput,
  ServiceStatusSchema,
  SessionEndInput,
  SessionStartInput,
  SeverityScore,
  parseDecisionArgs,
  parseDebtArgs,
  parseFileArgs,
  parseIssueArgs,
  parseLearnArgs,
  parsePatternArgs,
  parseRouteArgs,
  parseServerArgs,
  parseServiceArgs,
  parseSessionEndArgs,
} from "../../src/utils/validation";

describe("Reusable Schema Components", () => {
  describe("NonEmptyString", () => {
    test("accepts non-empty string", () => {
      expect(NonEmptyString.parse("hello")).toBe("hello");
    });

    test("rejects empty string", () => {
      expect(() => NonEmptyString.parse("")).toThrow();
    });

    test("rejects non-string types", () => {
      expect(() => NonEmptyString.parse(123)).toThrow();
      expect(() => NonEmptyString.parse(null)).toThrow();
    });
  });

  describe("OptionalString", () => {
    test("accepts string", () => {
      expect(OptionalString.parse("hello")).toBe("hello");
    });

    test("accepts undefined", () => {
      expect(OptionalString.parse(undefined)).toBeUndefined();
    });

    test("rejects non-string types", () => {
      expect(() => OptionalString.parse(123)).toThrow();
    });
  });

  describe("PositiveInt", () => {
    test("accepts positive integers", () => {
      expect(PositiveInt.parse(1)).toBe(1);
      expect(PositiveInt.parse(100)).toBe(100);
    });

    test("rejects zero", () => {
      expect(() => PositiveInt.parse(0)).toThrow();
    });

    test("rejects negative integers", () => {
      expect(() => PositiveInt.parse(-1)).toThrow();
    });

    test("rejects non-integers", () => {
      expect(() => PositiveInt.parse(1.5)).toThrow();
    });
  });

  describe("NonNegativeInt", () => {
    test("accepts zero", () => {
      expect(NonNegativeInt.parse(0)).toBe(0);
    });

    test("accepts positive integers", () => {
      expect(NonNegativeInt.parse(5)).toBe(5);
    });

    test("rejects negative integers", () => {
      expect(() => NonNegativeInt.parse(-1)).toThrow();
    });
  });

  describe("FragilityScore", () => {
    test("accepts values 0-10", () => {
      expect(FragilityScore.parse(0)).toBe(0);
      expect(FragilityScore.parse(5)).toBe(5);
      expect(FragilityScore.parse(10)).toBe(10);
    });

    test("rejects values below 0", () => {
      expect(() => FragilityScore.parse(-1)).toThrow();
    });

    test("rejects values above 10", () => {
      expect(() => FragilityScore.parse(11)).toThrow();
    });

    test("rejects non-integers", () => {
      expect(() => FragilityScore.parse(5.5)).toThrow();
    });
  });

  describe("SeverityScore", () => {
    test("accepts values 1-10", () => {
      expect(SeverityScore.parse(1)).toBe(1);
      expect(SeverityScore.parse(10)).toBe(10);
    });

    test("rejects zero", () => {
      expect(() => SeverityScore.parse(0)).toThrow();
    });

    test("rejects values above 10", () => {
      expect(() => SeverityScore.parse(11)).toThrow();
    });
  });
});

describe("Infrastructure Schemas", () => {
  describe("ServerRoleSchema", () => {
    test("accepts valid roles", () => {
      expect(ServerRoleSchema.parse("production")).toBe("production");
      expect(ServerRoleSchema.parse("staging")).toBe("staging");
      expect(ServerRoleSchema.parse("homelab")).toBe("homelab");
      expect(ServerRoleSchema.parse("development")).toBe("development");
    });

    test("rejects invalid roles", () => {
      expect(() => ServerRoleSchema.parse("invalid")).toThrow();
    });
  });

  describe("ServerStatusSchema", () => {
    test("accepts valid statuses", () => {
      expect(ServerStatusSchema.parse("online")).toBe("online");
      expect(ServerStatusSchema.parse("offline")).toBe("offline");
      expect(ServerStatusSchema.parse("degraded")).toBe("degraded");
      expect(ServerStatusSchema.parse("unknown")).toBe("unknown");
    });
  });

  describe("HealthStatusSchema", () => {
    test("accepts valid statuses", () => {
      expect(HealthStatusSchema.parse("healthy")).toBe("healthy");
      expect(HealthStatusSchema.parse("unhealthy")).toBe("unhealthy");
    });
  });

  describe("ServiceStatusSchema", () => {
    test("accepts valid statuses", () => {
      expect(ServiceStatusSchema.parse("running")).toBe("running");
      expect(ServiceStatusSchema.parse("stopped")).toBe("stopped");
      expect(ServiceStatusSchema.parse("error")).toBe("error");
    });
  });

  describe("ServerAddInput", () => {
    test("validates minimal server input", () => {
      const result = ServerAddInput.parse({ name: "prod-1" });
      expect(result.name).toBe("prod-1");
      expect(result.user).toBe("root");
      expect(result.port).toBe(22);
    });

    test("validates full server input", () => {
      const result = ServerAddInput.parse({
        name: "prod-1",
        ip: "192.168.1.10",
        hostname: "server.local",
        role: "production",
        user: "admin",
        port: 2222,
        key: "~/.ssh/id_rsa",
        jump: "bastion",
        os: "ubuntu",
        tags: "web,api",
        notes: "Main server",
      });
      expect(result.ip).toBe("192.168.1.10");
      expect(result.role).toBe("production");
      expect(result.port).toBe(2222);
    });

    test("validates IP address format", () => {
      expect(() =>
        ServerAddInput.parse({ name: "test", ip: "invalid" })
      ).toThrow();
    });

    test("validates port range", () => {
      expect(() =>
        ServerAddInput.parse({ name: "test", port: 0 })
      ).toThrow();
      expect(() =>
        ServerAddInput.parse({ name: "test", port: 70000 })
      ).toThrow();
    });

    test("coerces port from string", () => {
      const result = ServerAddInput.parse({ name: "test", port: "8080" });
      expect(result.port).toBe(8080);
    });
  });

  describe("ServiceAddInput", () => {
    test("validates minimal service input", () => {
      const result = ServiceAddInput.parse({
        name: "api",
        server: "prod-1",
      });
      expect(result.name).toBe("api");
      expect(result.branch).toBe("main");
    });

    test("validates service type", () => {
      const result = ServiceAddInput.parse({
        name: "api",
        server: "prod-1",
        type: "database",
      });
      expect(result.type).toBe("database");
    });

    test("rejects invalid service type", () => {
      expect(() =>
        ServiceAddInput.parse({
          name: "api",
          server: "prod-1",
          type: "invalid" as unknown,
        })
      ).toThrow();
    });
  });

  describe("RouteAddInput", () => {
    test("validates minimal route input", () => {
      const result = RouteAddInput.parse({
        domain: "api.example.com",
        service: "api",
      });
      expect(result.path).toBe("/");
    });

    test("validates SSL options", () => {
      const result = RouteAddInput.parse({
        domain: "api.example.com",
        service: "api",
        ssl: "letsencrypt",
      });
      expect(result.ssl).toBe("letsencrypt");
    });
  });
});

describe("File Schemas", () => {
  describe("FileTypeSchema", () => {
    test("accepts valid file types", () => {
      expect(FileTypeSchema.parse("component")).toBe("component");
      expect(FileTypeSchema.parse("route")).toBe("route");
      expect(FileTypeSchema.parse("util")).toBe("util");
      expect(FileTypeSchema.parse("config")).toBe("config");
      expect(FileTypeSchema.parse("schema")).toBe("schema");
      expect(FileTypeSchema.parse("service")).toBe("service");
      expect(FileTypeSchema.parse("hook")).toBe("hook");
      expect(FileTypeSchema.parse("middleware")).toBe("middleware");
      expect(FileTypeSchema.parse("test")).toBe("test");
      expect(FileTypeSchema.parse("other")).toBe("other");
    });
  });

  describe("FileStatusSchema", () => {
    test("accepts valid statuses", () => {
      expect(FileStatusSchema.parse("active")).toBe("active");
      expect(FileStatusSchema.parse("deprecated")).toBe("deprecated");
      expect(FileStatusSchema.parse("do-not-touch")).toBe("do-not-touch");
      expect(FileStatusSchema.parse("generated")).toBe("generated");
    });
  });

  describe("FileAddInput", () => {
    test("validates minimal input", () => {
      const result = FileAddInput.parse({ path: "src/index.ts" });
      expect(result.path).toBe("src/index.ts");
      expect(result.fragility).toBe(0);
      expect(result.status).toBe("active");
    });

    test("coerces fragility from string", () => {
      const result = FileAddInput.parse({
        path: "test.ts",
        fragility: "8",
      });
      expect(result.fragility).toBe(8);
    });
  });
});

describe("Decision Schemas", () => {
  describe("DecisionAddInput", () => {
    test("validates minimal input", () => {
      const result = DecisionAddInput.parse({
        title: "Use TypeScript",
        decision: "Type safety is important",
      });
      expect(result.title).toBe("Use TypeScript");
      expect(result.decision).toBe("Type safety is important");
    });

    test("validates full input", () => {
      const result = DecisionAddInput.parse({
        title: "Use TypeScript",
        decision: "Type safety is important",
        reasoning: "Catches bugs early",
        affects: "src/index.ts,src/utils.ts",
      });
      expect(result.reasoning).toBe("Catches bugs early");
      expect(result.affects).toBe("src/index.ts,src/utils.ts");
    });
  });
});

describe("Issue Schemas", () => {
  describe("IssueTypeSchema", () => {
    test("accepts valid types", () => {
      expect(IssueTypeSchema.parse("bug")).toBe("bug");
      expect(IssueTypeSchema.parse("tech-debt")).toBe("tech-debt");
      expect(IssueTypeSchema.parse("enhancement")).toBe("enhancement");
      expect(IssueTypeSchema.parse("question")).toBe("question");
      expect(IssueTypeSchema.parse("potential")).toBe("potential");
    });
  });

  describe("IssueAddInput", () => {
    test("validates minimal input", () => {
      const result = IssueAddInput.parse({ title: "Bug title" });
      expect(result.type).toBe("bug");
      expect(result.severity).toBe(5);
    });

    test("coerces severity from string", () => {
      const result = IssueAddInput.parse({
        title: "Bug",
        severity: "8",
      });
      expect(result.severity).toBe(8);
    });
  });
});

describe("Learning Schemas", () => {
  describe("LearningCategorySchema", () => {
    test("accepts valid categories", () => {
      expect(LearningCategorySchema.parse("pattern")).toBe("pattern");
      expect(LearningCategorySchema.parse("gotcha")).toBe("gotcha");
      expect(LearningCategorySchema.parse("preference")).toBe("preference");
      expect(LearningCategorySchema.parse("convention")).toBe("convention");
      expect(LearningCategorySchema.parse("architecture")).toBe("architecture");
    });
  });

  describe("LearnAddInput", () => {
    test("validates minimal input", () => {
      const result = LearnAddInput.parse({
        title: "Learning title",
        content: "Learning content",
      });
      expect(result.category).toBe("pattern");
      expect(result.global).toBe(false);
    });
  });
});

describe("Pattern Schemas", () => {
  describe("PatternAddInput", () => {
    test("validates minimal input", () => {
      const result = PatternAddInput.parse({
        name: "Repository Pattern",
        description: "Encapsulate data access",
      });
      expect(result.name).toBe("Repository Pattern");
    });
  });
});

describe("Tech Debt Schemas", () => {
  describe("DebtEffortSchema", () => {
    test("accepts valid effort levels", () => {
      expect(DebtEffortSchema.parse("small")).toBe("small");
      expect(DebtEffortSchema.parse("medium")).toBe("medium");
      expect(DebtEffortSchema.parse("large")).toBe("large");
    });
  });

  describe("DebtAddInput", () => {
    test("validates minimal input", () => {
      const result = DebtAddInput.parse({ title: "Refactor X" });
      expect(result.severity).toBe(5);
      expect(result.effort).toBe("medium");
    });
  });
});

describe("Session Schemas", () => {
  describe("SessionStartInput", () => {
    test("validates input with goal", () => {
      const result = SessionStartInput.parse({ goal: "Fix bug #123" });
      expect(result.goal).toBe("Fix bug #123");
    });

    test("rejects empty goal", () => {
      expect(() => SessionStartInput.parse({ goal: "" })).toThrow();
    });
  });

  describe("SessionEndInput", () => {
    test("validates minimal input", () => {
      const result = SessionEndInput.parse({ id: 1 });
      expect(result.id).toBe(1);
    });

    test("coerces values", () => {
      const result = SessionEndInput.parse({
        id: "5",
        success: "2",
      });
      expect(result.id).toBe(5);
      expect(result.success).toBe(2);
    });
  });
});

describe("CLI Argument Parsing", () => {
  describe("parseServerArgs", () => {
    test("parses positional name", () => {
      const result = parseServerArgs(["prod-1"]);
      expect(result.values.name).toBe("prod-1");
      expect(result.positionals).toEqual(["prod-1"]);
    });

    test("parses all options", () => {
      const result = parseServerArgs([
        "prod-1",
        "--ip",
        "192.168.1.1",
        "--hostname",
        "server.local",
        "--role",
        "production",
        "--user",
        "admin",
        "--port",
        "2222",
      ]);
      expect(result.values.name).toBe("prod-1");
      expect(result.values.ip).toBe("192.168.1.1");
      expect(result.values.hostname).toBe("server.local");
      expect(result.values.role).toBe("production");
      expect(result.values.user).toBe("admin");
      expect(result.values.port).toBe(2222);
    });

    test("uses default port and user", () => {
      const result = parseServerArgs(["test"]);
      expect(result.values.user).toBe("root");
      expect(result.values.port).toBe(22);
    });
  });

  describe("parseServiceArgs", () => {
    test("parses positional name", () => {
      const result = parseServiceArgs(["api"]);
      expect(result.values.name).toBe("api");
    });

    test("parses short options", () => {
      const result = parseServiceArgs([
        "api",
        "-s",
        "prod-1",
        "-t",
        "app",
        "-p",
        "3000",
      ]);
      expect(result.values.server).toBe("prod-1");
      expect(result.values.type).toBe("app");
      expect(result.values.port).toBe(3000);
    });

    test("uses default branch", () => {
      const result = parseServiceArgs(["api"]);
      expect(result.values.branch).toBe("main");
    });
  });

  describe("parseRouteArgs", () => {
    test("parses positional domain", () => {
      const result = parseRouteArgs(["api.example.com"]);
      expect(result.values.domain).toBe("api.example.com");
      expect(result.values.path).toBe("/");
    });

    test("parses all options", () => {
      const result = parseRouteArgs([
        "api.example.com",
        "-s",
        "api",
        "--path",
        "/v1",
        "--ssl",
        "letsencrypt",
      ]);
      expect(result.values.service).toBe("api");
      expect(result.values.path).toBe("/v1");
      expect(result.values.ssl).toBe("letsencrypt");
    });
  });

  describe("parseFileArgs", () => {
    test("parses positional path", () => {
      const result = parseFileArgs(["src/index.ts"]);
      expect(result.values.path).toBe("src/index.ts");
      expect(result.values.fragility).toBe(0);
    });

    test("parses short options", () => {
      const result = parseFileArgs([
        "src/index.ts",
        "-t",
        "component",
        "-p",
        "Entry point",
        "-f",
        "8",
        "-s",
        "active",
      ]);
      expect(result.values.type).toBe("component");
      expect(result.values.purpose).toBe("Entry point");
      expect(result.values.fragility).toBe(8);
      expect(result.values.status).toBe("active");
    });
  });

  describe("parseDecisionArgs", () => {
    test("parses all options", () => {
      const result = parseDecisionArgs([
        "-t",
        "Use TypeScript",
        "-d",
        "Better type safety",
        "-r",
        "Catches bugs",
        "-a",
        "src/index.ts",
      ]);
      expect(result.values.title).toBe("Use TypeScript");
      expect(result.values.decision).toBe("Better type safety");
      expect(result.values.reasoning).toBe("Catches bugs");
      expect(result.values.affects).toBe("src/index.ts");
    });
  });

  describe("parseIssueArgs", () => {
    test("parses all options", () => {
      const result = parseIssueArgs([
        "-t",
        "Bug title",
        "-d",
        "Description",
        "--type",
        "bug",
        "-s",
        "8",
        "-f",
        "src/bug.ts",
        "-w",
        "Restart service",
      ]);
      expect(result.values.title).toBe("Bug title");
      expect(result.values.description).toBe("Description");
      expect(result.values.type).toBe("bug");
      expect(result.values.severity).toBe(8);
      expect(result.values.files).toBe("src/bug.ts");
      expect(result.values.workaround).toBe("Restart service");
    });

    test("uses default severity", () => {
      const result = parseIssueArgs(["-t", "Bug"]);
      expect(result.values.severity).toBe(5);
    });
  });

  describe("parseLearnArgs", () => {
    test("parses all options", () => {
      const result = parseLearnArgs([
        "-c",
        "pattern",
        "-t",
        "Title",
        "--content",
        "Content",
        "--context",
        "When X happens",
        "-g",
        "-f",
        "src/index.ts",
      ]);
      expect(result.values.category).toBe("pattern");
      expect(result.values.title).toBe("Title");
      expect(result.values.content).toBe("Content");
      expect(result.values.context).toBe("When X happens");
      expect(result.values.global).toBe(true);
      expect(result.values.files).toBe("src/index.ts");
    });

    test("defaults global to false", () => {
      const result = parseLearnArgs(["-t", "Title"]);
      expect(result.values.global).toBe(false);
    });
  });

  describe("parsePatternArgs", () => {
    test("parses all options", () => {
      const result = parsePatternArgs([
        "-n",
        "Repository",
        "-d",
        "Data access",
        "-e",
        "class UserRepo {}",
        "-a",
        "Direct DB access",
        "--applies",
        "src/*.ts",
      ]);
      expect(result.values.name).toBe("Repository");
      expect(result.values.description).toBe("Data access");
      expect(result.values.example).toBe("class UserRepo {}");
      expect(result.values.anti).toBe("Direct DB access");
      expect(result.values.applies).toBe("src/*.ts");
    });
  });

  describe("parseDebtArgs", () => {
    test("parses all options", () => {
      const result = parseDebtArgs([
        "-t",
        "Refactor auth",
        "-d",
        "Auth is messy",
        "-s",
        "7",
        "-e",
        "large",
        "-f",
        "src/auth.ts",
      ]);
      expect(result.values.title).toBe("Refactor auth");
      expect(result.values.description).toBe("Auth is messy");
      expect(result.values.severity).toBe(7);
      expect(result.values.effort).toBe("large");
      expect(result.values.files).toBe("src/auth.ts");
    });
  });

  describe("parseSessionEndArgs", () => {
    test("parses positional id", () => {
      const result = parseSessionEndArgs(["5"]);
      expect(result.values.id).toBe(5);
    });

    test("parses all options", () => {
      const result = parseSessionEndArgs([
        "5",
        "-o",
        "Completed task",
        "-f",
        "src/index.ts",
        "-l",
        "Learned X",
        "-n",
        "Continue with Y",
        "-s",
        "2",
        "-a",
      ]);
      expect(result.values.id).toBe(5);
      expect(result.values.outcome).toBe("Completed task");
      expect(result.values.files).toBe("src/index.ts");
      expect(result.values.learnings).toBe("Learned X");
      expect(result.values.next).toBe("Continue with Y");
      expect(result.values.success).toBe(2);
      expect(result.values.analyze).toBe(true);
    });
  });
});
