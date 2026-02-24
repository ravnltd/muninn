/**
 * MCP Server State Machine
 *
 * Discriminated union for server lifecycle phases.
 * Replaces global mutable state with typed transitions.
 */
import type { DatabaseAdapter } from "../database/adapter";

export type McpPhase =
  | { status: "uninitialized" }
  | { status: "ready"; db: DatabaseAdapter; projectCache: Map<string, number> };

let phase: McpPhase = { status: "uninitialized" };

export function getPhase(): McpPhase {
  return phase;
}

export function transitionToReady(db: DatabaseAdapter): void {
  phase = { status: "ready", db, projectCache: new Map() };
}

export function resetPhase(): void {
  phase = { status: "uninitialized" };
}

export function isReady(): boolean {
  return phase.status === "ready";
}

export function getReadyPhase(): { status: "ready"; db: DatabaseAdapter; projectCache: Map<string, number> } | null {
  return phase.status === "ready" ? phase : null;
}
