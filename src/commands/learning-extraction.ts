/**
 * Learning Extraction
 * Extract learnings from sessions using LLM analysis
 */

import type { DatabaseAdapter } from "../database/adapter";
import { getApiKey, redactApiKeys } from "../utils/api-keys";
import { logError } from "../utils/errors";

export interface ExtractedLearning {
  title: string;
  content: string;
  category: string;
  confidence: number;
}

export interface TranscriptAnalysis {
  goal: string;
  outcome: string;
  learnings: ExtractedLearning[];
  nextSteps: string | null;
}

/**
 * Extract learnings from a completed session using LLM
 */
export async function extractSessionLearnings(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
  context: {
    goal: string;
    outcome: string;
    files: string[];
    success: number;
  }
): Promise<ExtractedLearning[]> {
  const keyResult = getApiKey("anthropic");
  if (!keyResult.ok) {
    return []; // No API key, skip extraction
  }

  // Don't extract from failed sessions with no useful info
  if (context.success === 0 && context.files.length === 0) {
    return [];
  }

  try {
    const prompt = buildExtractionPrompt(context);
    const response = await callLLMForExtraction(keyResult.value, prompt);
    const learnings = parseExtractedLearnings(response);

    // Record the extractions
    for (const learning of learnings) {
      if (learning.confidence >= 0.7) {
        // High confidence - auto-save
        const result = await db.run(
          `INSERT INTO learnings (project_id, category, title, content, source, confidence)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            projectId,
            learning.category,
            learning.title,
            learning.content,
            `session:${sessionId}`,
            Math.round(learning.confidence * 10),
          ]
        );

        try {
          await db.run(
            `INSERT INTO session_learnings (session_id, learning_id, confidence, auto_applied)
             VALUES (?, ?, ?, 1)`,
            [sessionId, Number(result.lastInsertRowid), learning.confidence]
          );
        } catch {
          // Table might not exist
        }
      } else {
        // Lower confidence - record but don't auto-save
        try {
          await db.run(
            `INSERT INTO session_learnings (session_id, confidence, auto_applied)
             VALUES (?, ?, 0)`,
            [sessionId, learning.confidence]
          );
        } catch {
          // Table might not exist
        }
      }
    }

    return learnings;
  } catch (error) {
    logError("extractSessionLearnings", error);
    return [];
  }
}

export function buildExtractionPrompt(context: {
  goal: string;
  outcome: string;
  files: string[];
  success: number;
}): string {
  const successLabel = context.success === 0 ? "failed" : context.success === 1 ? "partial" : "success";

  return `Analyze this coding session and extract reusable learnings.

SESSION:
- Goal: ${context.goal}
- Outcome: ${context.outcome}
- Status: ${successLabel}
- Files Modified: ${context.files.slice(0, 20).join(", ")}${context.files.length > 20 ? ` (+${context.files.length - 20} more)` : ""}

Extract 0-3 learnings that would be useful for future sessions. Focus on:
1. Patterns that worked well
2. Gotchas or pitfalls discovered
3. Conventions or preferences established

Return ONLY a JSON array (no markdown, no explanation):
[
  {
    "title": "Short title (max 50 chars)",
    "content": "The learning itself (1-2 sentences)",
    "category": "pattern|gotcha|preference|convention",
    "confidence": 0.0-1.0
  }
]

If no meaningful learnings, return empty array: []`;
}

export async function callLLMForExtraction(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${redactApiKeys(errorText)}`);
  }

  const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
  return data.content[0]?.text || "[]";
}

export function parseExtractedLearnings(response: string): ExtractedLearning[] {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;

    const parsed = JSON.parse(jsonStr.trim());

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is ExtractedLearning =>
        typeof item === "object" &&
        typeof item.title === "string" &&
        typeof item.content === "string" &&
        typeof item.category === "string" &&
        typeof item.confidence === "number"
    );
  } catch {
    return [];
  }
}

// Import the captured stdin from index.ts
import { getCapturedStdin } from "../index";

export function getStdinContent(): string {
  // Use pre-captured stdin from main() to avoid race conditions
  return getCapturedStdin() || "";
}

export async function analyzeTranscript(
  apiKey: string,
  transcript: string,
  _goal: string,
  files: string[]
): Promise<TranscriptAnalysis> {
  const prompt = `Analyze this coding session transcript and extract what was done.

RULES:
- ONLY report what is explicitly shown in the transcript
- Do NOT infer, assume, or make up details not present
- If the transcript is unclear, say "Session completed" for outcome
- If no clear learnings, return empty array
- Be concise and factual

FILES MODIFIED: ${files.slice(0, 20).join(", ")}${files.length > 20 ? ` (+${files.length - 20} more)` : ""}

TRANSCRIPT (last portion):
${transcript}

Return ONLY valid JSON:
{
  "goal": "Short phrase describing what user worked on (e.g., 'Fix auth bug', 'Add search feature')",
  "outcome": "1-2 sentence summary of what was actually done",
  "learnings": [
    {
      "title": "Short title (max 50 chars)",
      "content": "The learning (1-2 sentences)",
      "category": "pattern|gotcha|preference|convention",
      "confidence": 0.0-1.0
    }
  ],
  "next_steps": "What to do next (or null if none obvious)"
}`;

  const response = await callLLMForExtraction(apiKey, prompt);
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : response;
  const parsed = JSON.parse(jsonStr.trim());

  return {
    goal: parsed.goal || "Session",
    outcome: parsed.outcome || "Session completed",
    learnings: parseExtractedLearnings(JSON.stringify(parsed.learnings || [])),
    nextSteps: parsed.next_steps || null,
  };
}
