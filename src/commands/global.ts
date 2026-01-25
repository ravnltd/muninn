/**
 * Global commands
 * Commands that use global DB without requiring a project:
 * - pattern (add, search, list)
 * - debt (add, list, resolve)
 * - stack
 */

import type { Database } from "bun:sqlite";
import { closeAll } from "../database/connection";
import { patternAdd, patternSearch, patternList, debtList, debtAdd, debtResolve } from "./memory";
import { showStack } from "./analysis";

/**
 * Handle pattern commands (uses global DB only)
 */
export function handlePatternCommand(globalDb: Database, subArgs: string[]): void {
  const subCmd = subArgs[0];

  try {
    if (subCmd === "add") {
      patternAdd(globalDb, subArgs.slice(1));
    } else if (subCmd === "search" || subCmd === "find") {
      const query = subArgs.slice(1).join(" ");
      patternSearch(globalDb, query);
    } else if (subCmd === "list") {
      patternList();
    } else {
      console.error("Usage: muninn pattern <add|search|list>");
    }
  } finally {
    closeAll();
  }
}

/**
 * Handle debt commands (uses global DB)
 */
export function handleDebtCommand(subArgs: string[]): void {
  const subCmd = subArgs[0];

  if (subCmd === "list") {
    debtList(subArgs.includes("--project"));
  } else if (subCmd === "add") {
    debtAdd(subArgs.slice(1));
  } else if (subCmd === "resolve") {
    debtResolve(parseInt(subArgs[1]));
  } else {
    console.error("Usage: muninn debt <list|add|resolve>");
  }
  closeAll();
}

/**
 * Handle stack command
 */
export function handleStackCommand(): void {
  showStack();
}
