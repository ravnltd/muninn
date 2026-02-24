/**
 * Editor Registry — Detect and enumerate installed editors
 */
import type { EditorAdapter, EditorId } from "./types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { cursorAdapter } from "./cursor.js";
import { windsurfAdapter } from "./windsurf.js";
import { vscodeAdapter } from "./vscode.js";
import { neovimAdapter } from "./neovim.js";
import { clineAdapter } from "./cline.js";

const ALL_ADAPTERS: EditorAdapter[] = [
  claudeCodeAdapter,
  cursorAdapter,
  windsurfAdapter,
  clineAdapter,
  vscodeAdapter,
  neovimAdapter,
];

export function getAllAdapters(): EditorAdapter[] {
  return ALL_ADAPTERS;
}

export function getAdapter(id: EditorId): EditorAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}

export function detectInstalledEditors(): EditorAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.detect());
}
