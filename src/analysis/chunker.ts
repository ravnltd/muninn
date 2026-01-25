/**
 * Code Chunker
 *
 * Extracts semantic chunks from source files:
 * - Functions and methods
 * - Classes and interfaces
 * - Type definitions
 * - Exported constants
 * - React components
 *
 * Uses regex-based parsing (lightweight, no external deps)
 * for TypeScript/JavaScript. Can be extended for other languages.
 */

import { readFileSync } from "fs";

// ============================================================================
// Types
// ============================================================================

export type ChunkType =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'constant'
  | 'component'
  | 'method'
  | 'export';

export interface CodeChunk {
  name: string;
  type: ChunkType;
  signature: string;        // Full signature/declaration line
  body: string;             // The actual code
  startLine: number;
  endLine: number;
  purpose?: string;         // Extracted from JSDoc/comments
  parameters?: string[];    // For functions
  returnType?: string;      // For functions
  exported: boolean;
}

export interface ChunkResult {
  file: string;
  language: string;
  chunks: CodeChunk[];
  errors: string[];
}

// ============================================================================
// Language Detection
// ============================================================================

export function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'go':
      return 'go';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'svelte':
      return 'svelte';
    case 'vue':
      return 'vue';
    default:
      return null;
  }
}

// ============================================================================
// TypeScript/JavaScript Parser
// ============================================================================

/**
 * Parse TypeScript/JavaScript file and extract chunks
 */
export function parseTypeScript(content: string, filePath: string): ChunkResult {
  const chunks: CodeChunk[] = [];
  const errors: string[] = [];
  const lines = content.split('\n');

  // Track braces for block detection
  let braceDepth = 0;
  let currentChunk: Partial<CodeChunk> | null = null;
  let chunkStartLine = 0;
  let chunkLines: string[] = [];
  let pendingComment = '';
  let foundFirstBrace = false; // Track when we've found the function body start

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Capture JSDoc comments
    if (trimmed.startsWith('/**')) {
      pendingComment = '';
      let j = i;
      while (j < lines.length && !lines[j].includes('*/')) {
        pendingComment += lines[j] + '\n';
        j++;
      }
      if (j < lines.length) {
        pendingComment += lines[j];
      }
    }

    // Skip if we're inside a chunk
    if (currentChunk) {
      chunkLines.push(line);

      // For functions/classes, we need to find the opening brace of the body
      // (not braces in the return type annotation)
      if (!foundFirstBrace) {
        // Look for opening brace that starts a block (usually at end of line or on its own line)
        if (trimmed === '{' || trimmed.endsWith('{')) {
          foundFirstBrace = true;
          braceDepth = 1;
        }
        continue;
      }

      braceDepth += countBraces(line);

      // Check if chunk is complete
      if (braceDepth === 0) {
        currentChunk.endLine = lineNum;
        currentChunk.body = chunkLines.join('\n');
        currentChunk.purpose = extractPurpose(pendingComment);
        chunks.push(currentChunk as CodeChunk);
        currentChunk = null;
        chunkLines = [];
        pendingComment = '';
        foundFirstBrace = false;
      }
      continue;
    }

    // Try to match chunk patterns
    const chunk = matchChunkStart(trimmed, lineNum, pendingComment);

    if (chunk) {
      currentChunk = chunk;
      chunkStartLine = lineNum;
      chunkLines = [line];
      foundFirstBrace = false;

      // Check if opening brace is on this line
      if (trimmed.endsWith('{')) {
        foundFirstBrace = true;
        braceDepth = 1;
      } else if (chunk.type === 'type' || chunk.type === 'constant') {
        // Type aliases and consts don't need brace tracking
        // Just find the semicolon
        let j = i;
        while (j < lines.length) {
          const checkLine = lines[j].trim();
          chunkLines.push(lines[j]);
          if (checkLine.endsWith(';')) {
            currentChunk.endLine = j + 1;
            currentChunk.body = chunkLines.join('\n');
            currentChunk.purpose = extractPurpose(pendingComment);
            chunks.push(currentChunk as CodeChunk);
            currentChunk = null;
            chunkLines = [];
            pendingComment = '';
            i = j; // Skip ahead
            break;
          }
          j++;
        }
      }
    } else if (!trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
      // Clear pending comment if we hit non-comment, non-chunk line
      if (trimmed.length > 0 && !trimmed.startsWith('import') && !trimmed.startsWith('from')) {
        pendingComment = '';
      }
    }
  }

  // Handle unclosed chunk - save partial if we have enough lines
  if (currentChunk && chunkLines.length > 1) {
    currentChunk.endLine = chunkStartLine + chunkLines.length - 1;
    currentChunk.body = chunkLines.join('\n');
    currentChunk.purpose = extractPurpose(pendingComment);
    chunks.push(currentChunk as CodeChunk);
  } else if (currentChunk) {
    errors.push(`Unclosed chunk starting at line ${chunkStartLine}: ${currentChunk.name}`);
  }

  return {
    file: filePath,
    language: 'typescript',
    chunks,
    errors
  };
}

/**
 * Match the start of a code chunk
 */
function matchChunkStart(line: string, lineNum: number, _comment: string): Partial<CodeChunk> | null {
  // Exported function
  let match = line.match(/^export\s+(async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/);
  if (match) {
    return {
      name: match[2],
      type: 'function',
      signature: line.split('{')[0].trim(),
      startLine: lineNum,
      parameters: parseParams(match[4]),
      returnType: match[5]?.trim(),
      exported: true
    };
  }

  // Regular function
  match = line.match(/^(async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/);
  if (match) {
    return {
      name: match[2],
      type: 'function',
      signature: line.split('{')[0].trim(),
      startLine: lineNum,
      parameters: parseParams(match[4]),
      returnType: match[5]?.trim(),
      exported: false
    };
  }

  // Arrow function (const x = () => or const x = async () =>)
  match = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\(?([^)=]*)\)?\s*(?::\s*([^=]+))?\s*=>/);
  if (match) {
    return {
      name: match[1],
      type: 'function',
      signature: line.split('=>')[0].trim() + ' =>',
      startLine: lineNum,
      parameters: parseParams(match[3]),
      returnType: match[4]?.trim(),
      exported: line.startsWith('export')
    };
  }

  // Class
  match = line.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/);
  if (match) {
    return {
      name: match[1],
      type: 'class',
      signature: line.split('{')[0].trim(),
      startLine: lineNum,
      exported: line.startsWith('export')
    };
  }

  // Interface
  match = line.match(/^(?:export\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+[\w,\s<>]+)?/);
  if (match) {
    return {
      name: match[1],
      type: 'interface',
      signature: line.split('{')[0].trim(),
      startLine: lineNum,
      exported: line.startsWith('export')
    };
  }

  // Type alias
  match = line.match(/^(?:export\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=/);
  if (match) {
    return {
      name: match[1],
      type: 'type',
      signature: line,
      startLine: lineNum,
      exported: line.startsWith('export')
    };
  }

  // Exported const (likely a component or config)
  match = line.match(/^export\s+const\s+(\w+)\s*(?::\s*([^=]+))?\s*=/);
  if (match) {
    const name = match[1];
    // Detect React component (PascalCase)
    const isComponent = /^[A-Z]/.test(name) &&
      (line.includes('React') || line.includes('=>') || line.includes('function'));

    return {
      name,
      type: isComponent ? 'component' : 'constant',
      signature: line.split('=')[0].trim() + ' =',
      startLine: lineNum,
      exported: true
    };
  }

  return null;
}

/**
 * Count net brace change in a line
 */
function countBraces(line: string): number {
  // Remove strings and comments
  const cleaned = line
    .replace(/"(?:[^"\\]|\\.)*"/g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, '')
    .replace(/`(?:[^`\\]|\\.)*`/g, '')
    .replace(/\/\/.*/g, '')
    .replace(/\/\*.*?\*\//g, '');

  let count = 0;
  for (const char of cleaned) {
    if (char === '{') count++;
    else if (char === '}') count--;
  }
  return count;
}

/**
 * Parse function parameters
 */
function parseParams(paramStr: string): string[] {
  if (!paramStr?.trim()) return [];

  return paramStr
    .split(',')
    .map(p => p.trim().split(':')[0].trim())
    .filter(p => p.length > 0);
}

/**
 * Extract purpose from JSDoc comment
 */
function extractPurpose(comment: string): string | undefined {
  if (!comment) return undefined;

  // Extract first line after /** or @description
  const descMatch = comment.match(/@description\s+(.+?)(?:\n|$)/);
  if (descMatch) return descMatch[1].trim();

  // Get first non-empty, non-tag line
  const lines = comment.split('\n');
  for (const line of lines) {
    const cleaned = line.replace(/^\s*\*\s?/, '').trim();
    if (cleaned && !cleaned.startsWith('@') && !cleaned.startsWith('/*') && !cleaned.startsWith('*/')) {
      return cleaned;
    }
  }

  return undefined;
}

// ============================================================================
// Go Parser (basic)
// ============================================================================

export function parseGo(content: string, filePath: string): ChunkResult {
  const chunks: CodeChunk[] = [];
  const errors: string[] = [];
  const lines = content.split('\n');

  let braceDepth = 0;
  let currentChunk: Partial<CodeChunk> | null = null;
  let chunkLines: string[] = [];
  let pendingComment = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Capture comments
    if (trimmed.startsWith('//')) {
      pendingComment += trimmed.slice(2).trim() + ' ';
      continue;
    }

    if (currentChunk) {
      chunkLines.push(line);
      braceDepth += countBraces(line);

      if (braceDepth === 0) {
        currentChunk.endLine = lineNum;
        currentChunk.body = chunkLines.join('\n');
        currentChunk.purpose = pendingComment.trim() || undefined;
        chunks.push(currentChunk as CodeChunk);
        currentChunk = null;
        chunkLines = [];
        pendingComment = '';
      }
      continue;
    }

    // Function
    let match = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\(([^)]*)\)|\s+(\w+))?/);
    if (match) {
      currentChunk = {
        name: match[1],
        type: 'function',
        signature: trimmed.split('{')[0].trim(),
        startLine: lineNum,
        parameters: match[2] ? match[2].split(',').map(p => p.trim().split(' ')[0]) : [],
        returnType: match[3] || match[4],
        exported: /^[A-Z]/.test(match[1])
      };
      chunkLines = [line];
      braceDepth = countBraces(line);
      pendingComment = '';
      continue;
    }

    // Type/struct
    match = trimmed.match(/^type\s+(\w+)\s+(struct|interface)/);
    if (match) {
      currentChunk = {
        name: match[1],
        type: match[2] === 'struct' ? 'class' : 'interface',
        signature: trimmed.split('{')[0].trim(),
        startLine: lineNum,
        exported: /^[A-Z]/.test(match[1])
      };
      chunkLines = [line];
      braceDepth = countBraces(line);
      pendingComment = '';
      continue;
    }

    pendingComment = '';
  }

  return { file: filePath, language: 'go', chunks, errors };
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse a file and extract code chunks
 */
export function parseFile(filePath: string): ChunkResult | null {
  const language = detectLanguage(filePath);

  if (!language) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');

    switch (language) {
      case 'typescript':
      case 'javascript':
      case 'svelte':
      case 'vue':
        return parseTypeScript(content, filePath);
      case 'go':
        return parseGo(content, filePath);
      default:
        return null;
    }
  } catch (error) {
    return {
      file: filePath,
      language,
      chunks: [],
      errors: [`Failed to read file: ${error}`]
    };
  }
}

/**
 * Generate a searchable text representation of a chunk
 */
export function chunkToSearchText(chunk: CodeChunk): string {
  const parts = [
    chunk.name,
    chunk.type,
    chunk.signature,
    chunk.purpose || '',
    chunk.parameters?.join(' ') || '',
    chunk.returnType || ''
  ];

  return parts.filter(Boolean).join(' ');
}
