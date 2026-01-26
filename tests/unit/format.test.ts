/**
 * Format utilities tests
 * Tests time formatting, table formatting, and status icons
 */

import { describe, expect, test } from "bun:test";
import {
  formatBrief,
  formatDuration,
  formatShipCheck,
  formatTable,
  getSeverityIcon,
  getStatusIcon,
  getTimeAgo,
} from "../../src/utils/format";

describe("Time Formatting", () => {
  describe("getTimeAgo", () => {
    test('returns "never" for null', () => {
      expect(getTimeAgo(null)).toBe("never");
    });

    test('returns "never" for undefined', () => {
      expect(getTimeAgo(undefined)).toBe("never");
    });

    test('returns "just now" for recent timestamps', () => {
      const now = new Date().toISOString();
      expect(getTimeAgo(now)).toBe("just now");
    });

    test("returns minutes ago for timestamps under 60 minutes", () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(getTimeAgo(fiveMinutesAgo)).toBe("5m ago");
    });

    test("returns hours ago for timestamps under 24 hours", () => {
      const threeHoursAgo = new Date(
        Date.now() - 3 * 60 * 60 * 1000
      ).toISOString();
      expect(getTimeAgo(threeHoursAgo)).toBe("3h ago");
    });

    test("returns days ago for timestamps under 7 days", () => {
      const twoDaysAgo = new Date(
        Date.now() - 2 * 24 * 60 * 60 * 1000
      ).toISOString();
      expect(getTimeAgo(twoDaysAgo)).toBe("2d ago");
    });

    test("returns weeks ago for timestamps over 7 days", () => {
      const twoWeeksAgo = new Date(
        Date.now() - 14 * 24 * 60 * 60 * 1000
      ).toISOString();
      expect(getTimeAgo(twoWeeksAgo)).toBe("2w ago");
    });

    test("handles edge case at 1 minute", () => {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      expect(getTimeAgo(oneMinuteAgo)).toBe("1m ago");
    });

    test("handles edge case at 59 minutes", () => {
      const fiftyNineMinutesAgo = new Date(
        Date.now() - 59 * 60 * 1000
      ).toISOString();
      expect(getTimeAgo(fiftyNineMinutesAgo)).toBe("59m ago");
    });

    test("handles edge case at 1 hour", () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      expect(getTimeAgo(oneHourAgo)).toBe("1h ago");
    });

    test("handles edge case at 23 hours", () => {
      const twentyThreeHoursAgo = new Date(
        Date.now() - 23 * 60 * 60 * 1000
      ).toISOString();
      expect(getTimeAgo(twentyThreeHoursAgo)).toBe("23h ago");
    });
  });

  describe("formatDuration", () => {
    test("formats seconds only", () => {
      expect(formatDuration(30)).toBe("30s");
      expect(formatDuration(59)).toBe("59s");
    });

    test("formats minutes only", () => {
      expect(formatDuration(60)).toBe("1m");
      expect(formatDuration(120)).toBe("2m");
    });

    test("formats minutes and seconds", () => {
      expect(formatDuration(90)).toBe("1m 30s");
      expect(formatDuration(125)).toBe("2m 5s");
    });

    test("formats hours only", () => {
      expect(formatDuration(3600)).toBe("1h");
      expect(formatDuration(7200)).toBe("2h");
    });

    test("formats hours and minutes", () => {
      expect(formatDuration(3660)).toBe("1h 1m");
      expect(formatDuration(5400)).toBe("1h 30m");
    });

    test("handles zero", () => {
      expect(formatDuration(0)).toBe("0s");
    });

    test("handles large values", () => {
      expect(formatDuration(86400)).toBe("24h");
    });
  });
});

describe("Status Icons", () => {
  describe("getStatusIcon", () => {
    test("returns green for positive statuses", () => {
      expect(getStatusIcon("online")).toBe("🟢");
      expect(getStatusIcon("healthy")).toBe("🟢");
      expect(getStatusIcon("running")).toBe("🟢");
      expect(getStatusIcon("success")).toBe("🟢");
      expect(getStatusIcon("pass")).toBe("🟢");
    });

    test("returns red for negative statuses", () => {
      expect(getStatusIcon("offline")).toBe("🔴");
      expect(getStatusIcon("unhealthy")).toBe("🔴");
      expect(getStatusIcon("stopped")).toBe("🔴");
      expect(getStatusIcon("failed")).toBe("🔴");
      expect(getStatusIcon("fail")).toBe("🔴");
      expect(getStatusIcon("critical")).toBe("🔴");
    });

    test("returns orange for warning statuses", () => {
      expect(getStatusIcon("degraded")).toBe("🟠");
      expect(getStatusIcon("warn")).toBe("🟠");
      expect(getStatusIcon("warning")).toBe("🟠");
      expect(getStatusIcon("error")).toBe("🟠");
    });

    test("returns blue for info status", () => {
      expect(getStatusIcon("info")).toBe("🔵");
    });

    test("returns white for unknown statuses", () => {
      expect(getStatusIcon("unknown")).toBe("⚪");
      expect(getStatusIcon("anything-else")).toBe("⚪");
    });
  });

  describe("getSeverityIcon", () => {
    test("returns red for critical", () => {
      expect(getSeverityIcon("critical")).toBe("🔴");
    });

    test("returns orange for high/error", () => {
      expect(getSeverityIcon("high")).toBe("🟠");
      expect(getSeverityIcon("error")).toBe("🟠");
    });

    test("returns yellow for medium/warning", () => {
      expect(getSeverityIcon("medium")).toBe("🟡");
      expect(getSeverityIcon("warning")).toBe("🟡");
    });

    test("returns blue for low/info", () => {
      expect(getSeverityIcon("low")).toBe("🔵");
      expect(getSeverityIcon("info")).toBe("🔵");
    });

    test("returns white for unknown", () => {
      expect(getSeverityIcon("unknown")).toBe("⚪");
    });
  });
});

describe("Table Formatting", () => {
  describe("formatTable", () => {
    test("formats simple table", () => {
      const result = formatTable(["Name", "Value"], [["foo", "bar"]]);
      expect(result).toContain("Name");
      expect(result).toContain("Value");
      expect(result).toContain("foo");
      expect(result).toContain("bar");
    });

    test("handles empty rows", () => {
      const result = formatTable(["Name", "Value"], []);
      expect(result).toContain("Name");
      expect(result).toContain("Value");
    });

    test("calculates column widths correctly", () => {
      const result = formatTable(
        ["A", "B"],
        [
          ["longer", "x"],
          ["y", "much longer"],
        ]
      );
      // Column widths should accommodate longest values
      expect(result).toContain("longer");
      expect(result).toContain("much longer");
    });

    test("handles cells with different lengths", () => {
      const result = formatTable(
        ["ID", "Name", "Status"],
        [
          ["1", "Short", "OK"],
          ["2", "Much longer name", "Failed"],
          ["3", "X", "Y"],
        ]
      );
      expect(result).toContain("Much longer name");
    });

    test("handles undefined/null cells", () => {
      const result = formatTable(
        ["A", "B"],
        [["value", undefined as unknown as string]]
      );
      expect(result).toContain("value");
    });

    test("uses box drawing characters", () => {
      const result = formatTable(["A"], [["B"]]);
      expect(result).toContain("┌");
      expect(result).toContain("┐");
      expect(result).toContain("└");
      expect(result).toContain("┘");
      expect(result).toContain("│");
      expect(result).toContain("─");
    });
  });
});

describe("Ship Check Formatting", () => {
  describe("formatShipCheck", () => {
    test("formats passing check", () => {
      const result = formatShipCheck({ name: "Tests", status: "pass" });
      expect(result).toBe("🟢 Tests");
    });

    test("formats failing check with message", () => {
      const result = formatShipCheck({
        name: "Lint",
        status: "fail",
        message: "3 errors",
      });
      expect(result).toBe("🔴 Lint: 3 errors");
    });

    test("formats warning check", () => {
      const result = formatShipCheck({
        name: "Coverage",
        status: "warning",
        message: "Below 80%",
      });
      expect(result).toBe("🟠 Coverage: Below 80%");
    });
  });
});

describe("Brief Formatting", () => {
  describe("formatBrief", () => {
    test("formats minimal project brief", () => {
      const result = formatBrief({
        project: { name: "test-project" },
        fragileFiles: [],
        openIssues: [],
        activeDecisions: [],
        patterns: [],
      });
      expect(result).toContain("# Project: test-project");
      expect(result).toContain("**Type:** unknown");
      expect(result).toContain("**Stack:** unknown");
    });

    test("formats project with type and stack", () => {
      const result = formatBrief({
        project: {
          name: "my-app",
          type: "web-app",
          stack: ["TypeScript", "React", "Node.js"],
        },
        fragileFiles: [],
        openIssues: [],
        activeDecisions: [],
        patterns: [],
      });
      expect(result).toContain("**Type:** web-app");
      expect(result).toContain("**Stack:** TypeScript, React, Node.js");
    });

    test("formats last session info", () => {
      const result = formatBrief({
        project: { name: "test" },
        lastSession: {
          goal: "Fix authentication bug",
          outcome: "Bug fixed successfully",
          next_steps: "Add tests",
          ended_at: new Date().toISOString(),
        },
        fragileFiles: [],
        openIssues: [],
        activeDecisions: [],
        patterns: [],
      });
      expect(result).toContain("## Last Session");
      expect(result).toContain("**Goal:** Fix authentication bug");
      expect(result).toContain("**Outcome:** Bug fixed successfully");
      expect(result).toContain("**Next:** Add tests");
    });

    test("formats fragile files section", () => {
      const result = formatBrief({
        project: { name: "test" },
        fragileFiles: [
          {
            path: "src/auth.ts",
            fragility: 9,
            fragility_reason: "Complex state",
          },
          { path: "src/db.ts", fragility: 7 },
        ],
        openIssues: [],
        activeDecisions: [],
        patterns: [],
      });
      expect(result).toContain("## ⚠️ Fragile Files");
      expect(result).toContain("`src/auth.ts` [9/10] - Complex state");
      expect(result).toContain("`src/db.ts` [7/10]");
    });

    test("formats open issues section", () => {
      const result = formatBrief({
        project: { name: "test" },
        fragileFiles: [],
        openIssues: [
          { id: 1, title: "Critical bug", severity: 9 },
          { id: 2, title: "Minor issue", severity: 3 },
        ],
        activeDecisions: [],
        patterns: [],
      });
      expect(result).toContain("## 🔴 Open Issues");
      expect(result).toContain("#1: Critical bug (sev 9)");
      expect(result).toContain("#2: Minor issue (sev 3)");
    });

    test("formats active decisions section", () => {
      const result = formatBrief({
        project: { name: "test" },
        fragileFiles: [],
        openIssues: [],
        activeDecisions: [
          {
            id: 1,
            title: "Use TypeScript",
            decision:
              "We will use TypeScript for type safety and better developer experience",
          },
        ],
        patterns: [],
      });
      expect(result).toContain("## 📋 Active Decisions");
      expect(result).toContain("D1: Use TypeScript");
    });

    test("formats patterns section", () => {
      const result = formatBrief({
        project: { name: "test" },
        fragileFiles: [],
        openIssues: [],
        activeDecisions: [],
        patterns: [
          {
            name: "Repository",
            description: "Use repository pattern for data access layer",
          },
        ],
      });
      expect(result).toContain("## 💡 Patterns Library");
      expect(result).toContain("Repository: Use repository pattern");
    });

    test("truncates long decision text", () => {
      const longDecision = "a".repeat(100);
      const result = formatBrief({
        project: { name: "test" },
        fragileFiles: [],
        openIssues: [],
        activeDecisions: [{ id: 1, title: "Decision", decision: longDecision }],
        patterns: [],
      });
      expect(result).toContain("...");
      expect(result).not.toContain(longDecision);
    });
  });
});
