/**
 * Predictive Context
 * Bundles all relevant context for a task in a single call.
 * Aggregates co-changers, dependencies, decisions, issues, learnings,
 * workflows, and profile entries.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import { outputJson } from "../../utils/format.js";
import { isNativeFormat, formatPredictBundle } from "../../output/formatter.js";

export { predictContext } from "./context-bundle.js";
export { generateAdvisory } from "./advisory.js";

// ============================================================================
// CLI Handler
// ============================================================================

export async function handlePredictCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const { predictContext } = await import("./context-bundle.js");

  const taskParts: string[] = [];
  const files: string[] = [];
  let mode: "task" | "files" = "task";
  let advise = false;

  for (const arg of args) {
    if (arg === "--files") {
      mode = "files";
      continue;
    }
    if (arg === "--advise") {
      advise = true;
      continue;
    }
    if (mode === "files") {
      files.push(arg);
    } else {
      taskParts.push(arg);
    }
  }

  const task = taskParts.join(" ") || undefined;

  if (!task && files.length === 0) {
    console.error("Usage: muninn predict <task description> [--files file1 file2 ...] [--advise]");
    return;
  }

  const bundle = await predictContext(db, projectId, { task, files, advise });

  if (isNativeFormat()) {
    // Native format: dense, token-efficient output
    console.error("Predict[bundle]");
    console.error(
      formatPredictBundle({
        relatedFiles: bundle.relatedFiles,
        cochangingFiles: bundle.cochangingFiles,
        relevantDecisions: bundle.relevantDecisions,
        openIssues: bundle.openIssues,
        applicableLearnings: bundle.applicableLearnings,
        testFiles: bundle.testFiles,
        workflowPattern: bundle.workflowPattern,
      })
    );

    // Profile entries in native format
    if (bundle.profileEntries.length > 0) {
      for (const p of bundle.profileEntries) {
        const pct = Math.round(p.confidence * 100);
        console.error(`P[${p.key}|val:${p.value.slice(0, 50)}|conf:${pct}]`);
      }
    }

    // Last session context in native format
    if (bundle.lastSessionContext) {
      const ctx = bundle.lastSessionContext;
      const parts = [`#${ctx.sessionId}`];
      if (ctx.goal) parts.push(`goal:${ctx.goal.slice(0, 40)}`);
      if (ctx.decisionsMade.length > 0) parts.push(`decisions:${ctx.decisionsMade.map((d) => d.id).join(",")}`);
      if (ctx.issuesResolved.length > 0) parts.push(`resolved:${ctx.issuesResolved.map((i) => i.id).join(",")}`);
      console.error(`S[${parts.join("|")}]`);
    }

    // Advisory in native format
    if (bundle.advisory) {
      const a = bundle.advisory;
      console.error(`A[risk:${a.riskLevel}|score:${a.riskScore}]`);
      for (const w of a.watchOut) {
        console.error(`!${w.severity === "critical" ? "CRIT" : "WARN"}: ${w.warning.slice(0, 60)}`);
      }
      if (a.suggestedSteps.length > 0) {
        console.error(`Steps: ${a.suggestedSteps.slice(0, 3).join(" | ")}`);
      }
    }
  } else {
    // Human format: emoji/prose output
    console.error("\n\u{1F52E} Predictive Context Bundle:\n");

    if (bundle.relatedFiles.length > 0) {
      console.error("  \u{1F4C1} Related Files:");
      for (const f of bundle.relatedFiles) {
        console.error(`     ${f.path} \u2014 ${f.reason}`);
      }
      console.error("");
    }

    if (bundle.cochangingFiles.length > 0) {
      console.error("  \u{1F517} Co-changing Files:");
      for (const f of bundle.cochangingFiles) {
        console.error(`     ${f.path} (${f.cochange_count}x together)`);
      }
      console.error("");
    }

    if (bundle.relevantDecisions.length > 0) {
      console.error("  \u{1F4CB} Relevant Decisions:");
      for (const d of bundle.relevantDecisions) {
        console.error(`     #${d.id}: ${d.title}`);
      }
      console.error("");
    }

    if (bundle.openIssues.length > 0) {
      console.error("  \u26A0\uFE0F  Open Issues:");
      for (const i of bundle.openIssues) {
        console.error(`     #${i.id} [sev ${i.severity}]: ${i.title}`);
      }
      console.error("");
    }

    if (bundle.applicableLearnings.length > 0) {
      console.error("  \u{1F4A1} Applicable Learnings:");
      for (const l of bundle.applicableLearnings) {
        if (l.native) {
          console.error(`     ${l.native}`);
        } else {
          console.error(`     ${l.title}: ${l.content.slice(0, 60)}`);
        }
      }
      console.error("");
    }

    if (bundle.workflowPattern) {
      console.error(`  \u{1F504} Workflow: ${bundle.workflowPattern.task_type}`);
      console.error(`     ${bundle.workflowPattern.approach.slice(0, 80)}`);
      console.error("");
    }

    if (bundle.profileEntries.length > 0) {
      console.error("  \u{1F464} Profile Hints:");
      for (const p of bundle.profileEntries) {
        console.error(`     [${p.category}] ${p.key}: ${p.value.slice(0, 50)}`);
      }
      console.error("");
    }

    if (bundle.lastSessionContext) {
      const ctx = bundle.lastSessionContext;
      console.error(`  \u{1F4CD} Last Session (#${ctx.sessionId}):`);
      if (ctx.goal) {
        console.error(`     Goal: ${ctx.goal.slice(0, 60)}`);
      }
      if (ctx.decisionsMade.length > 0) {
        console.error(`     Decisions made: ${ctx.decisionsMade.map((d) => `D${d.id}`).join(", ")}`);
      }
      if (ctx.issuesFound.length > 0) {
        console.error(`     Issues found: ${ctx.issuesFound.map((i) => `#${i.id}`).join(", ")}`);
      }
      if (ctx.issuesResolved.length > 0) {
        console.error(`     Issues resolved: ${ctx.issuesResolved.map((i) => `#${i.id}`).join(", ")}`);
      }
      if (ctx.learningsExtracted.length > 0) {
        console.error(`     Learnings: ${ctx.learningsExtracted.map((l) => l.title.slice(0, 30)).join(", ")}`);
      }
      console.error("");
    }

    if (bundle.testFiles.length > 0) {
      console.error("  \u{1F9EA} Test Coverage:");
      for (const t of bundle.testFiles) {
        console.error(`     ${t.testPath} \u2192 ${t.sourcePath}`);
      }
      console.error("");
    }

    if (bundle.advisory) {
      const a = bundle.advisory;
      const riskEmoji = a.riskLevel === "high" ? "\u{1F534}" : a.riskLevel === "medium" ? "\u{1F7E1}" : "\u{1F7E2}";

      console.error(`\n\u26A1 Advisory (${riskEmoji} ${a.riskLevel.toUpperCase()} risk, score: ${a.riskScore}/10):\n`);

      if (a.watchOut.length > 0) {
        console.error("  \u26A0\uFE0F  Watch Out:");
        for (const w of a.watchOut) {
          const icon = w.severity === "critical" ? "\u{1F534}" : w.severity === "warning" ? "\u{1F7E0}" : "\u{1F4A1}";
          console.error(`     ${icon} ${w.warning}`);
          console.error(`        Source: ${w.source}`);
        }
        console.error("");
      }

      if (a.suggestedApproach) {
        console.error(`  \u{1F4CB} Approach: ${a.suggestedApproach.slice(0, 80)}`);
        console.error("");
      }

      if (a.suggestedSteps.length > 0) {
        console.error("  \u{1F4DD} Suggested Steps:");
        for (let i = 0; i < a.suggestedSteps.length; i++) {
          console.error(`     ${i + 1}. ${a.suggestedSteps[i]}`);
        }
        console.error("");
      }

      if (a.decisionOutcomes.length > 0) {
        console.error("  \u{1F4CA} Past Decision Outcomes:");
        for (const d of a.decisionOutcomes) {
          const icon = d.outcome === "succeeded" ? "\u2705" : d.outcome === "failed" ? "\u274C" : "\u{1F504}";
          console.error(`     ${icon} D#${d.id}: ${d.title} (${d.outcome})`);
          if (d.notes) console.error(`        Notes: ${d.notes.slice(0, 60)}`);
        }
        console.error("");
      }
    }
  }

  outputJson(bundle);
}
