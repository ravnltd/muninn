/**
 * Tool Input Parser
 *
 * Extracts file paths and other relevant information from tool inputs.
 */

import type { ToolType } from "./types";

// ============================================================================
// Parser Result
// ============================================================================

export interface ParsedInput {
  tool: ToolType;
  files: string[];
  command?: string;
  pattern?: string;
}

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse tool input to extract files and other metadata
 */
export function parseToolInput(tool: string, input: string): ParsedInput {
  const toolType = normalizeToolType(tool);

  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(input);
    return parseJsonInput(toolType, parsed);
  } catch {
    // Fall back to string parsing
    return parseStringInput(toolType, input);
  }
}

/**
 * Normalize tool name to ToolType
 */
function normalizeToolType(tool: string): ToolType {
  const normalized = tool.toLowerCase();

  switch (normalized) {
    case "read":
      return "Read";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "bash":
      return "Bash";
    case "glob":
      return "Glob";
    case "grep":
      return "Grep";
    default:
      return "*";
  }
}

/**
 * Parse JSON tool input
 */
function parseJsonInput(tool: ToolType, input: Record<string, unknown>): ParsedInput {
  const result: ParsedInput = {
    tool,
    files: [],
  };

  switch (tool) {
    case "Read":
      if (input.file_path && typeof input.file_path === "string") {
        result.files = [input.file_path];
      }
      break;

    case "Edit":
    case "Write":
      if (input.file_path && typeof input.file_path === "string") {
        result.files = [input.file_path];
      }
      break;

    case "Bash":
      if (input.command && typeof input.command === "string") {
        result.command = input.command;
        result.files = extractFilesFromCommand(input.command);
      }
      break;

    case "Glob":
      if (input.pattern && typeof input.pattern === "string") {
        result.pattern = input.pattern;
        // For glob, we don't know files until execution
      }
      if (input.path && typeof input.path === "string") {
        result.files = [input.path];
      }
      break;

    case "Grep":
      if (input.path && typeof input.path === "string") {
        result.files = [input.path];
      }
      if (input.pattern && typeof input.pattern === "string") {
        result.pattern = input.pattern;
      }
      break;
  }

  return result;
}

/**
 * Parse string tool input
 */
function parseStringInput(tool: ToolType, input: string): ParsedInput {
  const result: ParsedInput = {
    tool,
    files: [],
  };

  // Try to extract file paths from the input string
  const filePaths = extractFilePaths(input);
  if (filePaths.length > 0) {
    result.files = filePaths;
  }

  if (tool === "Bash") {
    result.command = input;
    result.files = extractFilesFromCommand(input);
  }

  return result;
}

/**
 * Extract file paths from a string
 */
function extractFilePaths(input: string): string[] {
  const paths: string[] = [];

  // Match common file path patterns
  // - Absolute paths: /foo/bar.ts
  // - Relative paths: ./foo/bar.ts, ../foo/bar.ts
  // - Simple paths: foo/bar.ts, src/index.ts
  const pathPattern = /(?:^|[\s"'])([./]?[\w\-./]+\.[a-zA-Z0-9]+)(?:[\s"']|$)/g;

  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(input)) !== null) {
    const path = match[1];
    // Filter out obvious non-files
    if (!isLikelyUrl(path) && !isVersionString(path)) {
      paths.push(path);
    }
  }

  return [...new Set(paths)]; // Dedupe
}

/**
 * Extract files from a bash command
 */
function extractFilesFromCommand(command: string): string[] {
  const files: string[] = [];

  // Common patterns that indicate file arguments
  const patterns = [
    // Direct file arguments after common commands
    /(?:cat|head|tail|less|more|vim|nano|code|edit)\s+["']?([^\s"'|&;]+)/g,
    // Output redirection
    />\s*["']?([^\s"'|&;]+)/g,
    // Input redirection
    /<\s*["']?([^\s"'|&;]+)/g,
    // Common file operations
    /(?:rm|cp|mv|touch|mkdir)\s+(?:-[^\s]+\s+)*["']?([^\s"'|&;]+)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(command)) !== null) {
      const path = match[1];
      if (looksLikeFilePath(path)) {
        files.push(path);
      }
    }
  }

  return [...new Set(files)];
}

/**
 * Check if a string looks like a file path
 */
function looksLikeFilePath(str: string): boolean {
  // Must contain at least one path separator or file extension
  if (!str.includes("/") && !str.includes(".")) {
    return false;
  }

  // Filter out URLs
  if (isLikelyUrl(str)) {
    return false;
  }

  // Filter out version strings
  if (isVersionString(str)) {
    return false;
  }

  // Filter out common non-file patterns
  const nonFilePatterns = [
    /^-/, // Flags
    /^\$/, // Variables
    /^[0-9]+$/, // Pure numbers
  ];

  for (const pattern of nonFilePatterns) {
    if (pattern.test(str)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if string is likely a URL
 */
function isLikelyUrl(str: string): boolean {
  return /^https?:\/\//.test(str) || /^www\./.test(str);
}

/**
 * Check if string is a version string
 */
function isVersionString(str: string): boolean {
  return /^v?\d+\.\d+\.\d+/.test(str);
}

/**
 * Check if a file path should be skipped based on patterns
 */
export function shouldSkipPath(path: string, skipPatterns: string[]): boolean {
  for (const pattern of skipPatterns) {
    if (pattern.startsWith("*.")) {
      // Extension pattern
      const ext = pattern.slice(1);
      if (path.endsWith(ext)) {
        return true;
      }
    } else if (path.includes(pattern)) {
      // Contains pattern
      return true;
    }
  }
  return false;
}
