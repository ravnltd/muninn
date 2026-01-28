/**
 * Profile Synthesis
 * Aggregate developer preferences from conversation extraction
 */

import type { DatabaseAdapter } from "../database/adapter";
import type { ProfileSynthesis } from "../types";
import { outputJson } from "../utils/format";

// ============================================================================
// Category Grouping
// ============================================================================

interface PreferenceEntry {
  id: number;
  key: string;
  value: string;
  confidence: number;
  category: string;
  conversationCount: number;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Error Handling": ["error", "exception", "throw", "catch", "try", "fail", "handle"],
  "Code Style": ["style", "naming", "format", "indent", "convention", "case", "camel", "snake"],
  "Architecture": ["pattern", "structure", "layer", "module", "service", "component", "separation"],
  "Validation": ["validate", "input", "boundary", "schema", "zod", "check", "sanitize"],
  "Testing": ["test", "spec", "mock", "coverage", "unit", "integration", "e2e"],
  "State Management": ["state", "store", "redux", "context", "immutable", "mutation"],
  "Performance": ["performance", "cache", "optimize", "lazy", "bundle", "memory"],
  "Security": ["security", "auth", "token", "secret", "encrypt", "csrf", "xss"],
  "Tooling": ["tool", "cli", "build", "bundle", "lint", "prettier", "typescript"],
  "Workflow": ["workflow", "process", "commit", "pr", "review", "branch", "git"],
};

function categorizePreference(key: string, value: string): string {
  const text = `${key} ${value}`.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return category;
    }
  }

  return "General";
}

// ============================================================================
// Synthesis Functions
// ============================================================================

/**
 * Aggregate preferences from developer_profile
 */
export async function synthesizeProfile(
  db: DatabaseAdapter,
  projectId: number
): Promise<ProfileSynthesis> {
  // Get all preferences from conversations
  const preferences = await db.all<{
    id: number;
    key: string;
    value: string;
    confidence: number;
    category: string;
    times_confirmed: number;
  }>(
    `SELECT id, key, value, confidence, category, times_confirmed
     FROM developer_profile
     WHERE project_id = ? OR project_id IS NULL
     ORDER BY confidence DESC`,
    [projectId]
  );

  // Get related learnings that might be preferences
  const learnings = await db.all<{
    id: number;
    title: string;
    content: string;
    category: string;
  }>(
    `SELECT l.id, l.title, l.content, l.category
     FROM learnings l
     WHERE (l.project_id = ? OR l.project_id IS NULL)
       AND l.category IN ('preference', 'convention')`,
    [projectId]
  );

  // Group preferences by category
  const categoryMap: Map<string, PreferenceEntry[]> = new Map();

  for (const pref of preferences) {
    const cat = categorizePreference(pref.key, pref.value);

    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }

    categoryMap.get(cat)?.push({
      id: pref.id,
      key: pref.key,
      value: pref.value,
      confidence: pref.confidence,
      category: cat,
      conversationCount: pref.times_confirmed,
    });
  }

  // Add learnings as preferences
  for (const learn of learnings) {
    const cat = categorizePreference(learn.title, learn.content);

    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }

    categoryMap.get(cat)?.push({
      id: learn.id,
      key: learn.title,
      value: learn.content,
      confidence: 0.8, // Default confidence for learnings
      category: cat,
      conversationCount: 1,
    });
  }

  // Detect contradictions within categories
  const contradictions: ProfileSynthesis["contradictions"] = [];

  for (const [, entries] of categoryMap) {
    // Group by key
    const keyGroups: Map<string, typeof entries> = new Map();

    for (const entry of entries) {
      const normKey = entry.key.toLowerCase().replace(/[^a-z0-9]/g, "_");
      if (!keyGroups.has(normKey)) {
        keyGroups.set(normKey, []);
      }
      keyGroups.get(normKey)?.push(entry);
    }

    // Check for conflicting values
    for (const [, group] of keyGroups) {
      const uniqueValues = [...new Set(group.map((e) => e.value.toLowerCase()))];
      if (uniqueValues.length > 1) {
        contradictions.push({
          key: group[0].key,
          values: group.map((e) => ({
            value: e.value,
            confidence: e.confidence,
            conversationId: 0, // Would need to join with extracts to get this
          })),
        });
      }
    }
  }

  // Build synthesis result
  const categories: ProfileSynthesis["categories"] = [];

  for (const [name, entries] of categoryMap) {
    // Calculate category confidence as average
    const avgConfidence = entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length;

    // Sort entries by confidence
    const sortedEntries = entries.sort((a, b) => b.confidence - a.confidence);

    categories.push({
      name,
      confidence: avgConfidence,
      entries: sortedEntries.map((e) => ({
        key: e.key,
        value: e.value,
        confidence: e.confidence,
        mentions: e.conversationCount,
      })),
    });
  }

  // Sort categories by confidence
  categories.sort((a, b) => b.confidence - a.confidence);

  // Calculate summary
  const allEntries = [...categoryMap.values()].flat();
  const totalConfidence = allEntries.reduce((sum, e) => sum + e.confidence, 0);

  return {
    categories,
    contradictions,
    summary: {
      totalPreferences: allEntries.length,
      categoriesFound: categories.length,
      avgConfidence: allEntries.length > 0 ? totalConfidence / allEntries.length : 0,
    },
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatProfileOutput(profile: ProfileSynthesis, conversationCount: number): string {
  const lines: string[] = [];

  lines.push(`Developer Profile (from ${conversationCount} conversations)\n`);

  for (const cat of profile.categories) {
    const confidence = Math.round(cat.confidence * 100);
    lines.push(`${cat.name} (${confidence}% confidence)`);

    for (const entry of cat.entries.slice(0, 5)) {
      const entryConf = Math.round(entry.confidence * 100);
      const mentions = entry.mentions > 1 ? `, ${entry.mentions} mentions` : "";
      lines.push(`  - ${entry.key}: ${entry.value} (${entryConf}%${mentions})`);
    }

    if (cat.entries.length > 5) {
      lines.push(`  ... and ${cat.entries.length - 5} more`);
    }

    lines.push("");
  }

  if (profile.contradictions.length > 0) {
    lines.push("Contradictions:");
    for (const c of profile.contradictions) {
      lines.push(`  ⚠️ "${c.key}" has conflicting values:`);
      for (const v of c.values) {
        lines.push(`     - "${v.value}" (${Math.round(v.confidence * 100)}%)`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleProfileSynthesisCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[]
): Promise<void> {
  const jsonOutput = args.includes("--json");

  console.error("\n📊 Synthesizing developer profile...\n");

  // Get conversation count for context
  const convCount = await db.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM conversations WHERE extraction_status = 'extracted'`
  );

  const profile = await synthesizeProfile(db, projectId);

  if (profile.summary.totalPreferences === 0) {
    console.error("⚠️  No preferences found.");
    console.error("   Run `muninn convo extract --all` to extract from conversations.\n");
    return;
  }

  if (jsonOutput) {
    outputJson(profile);
    return;
  }

  const formatted = formatProfileOutput(profile, convCount?.count || 0);
  console.error(formatted);

  console.error("Summary:");
  console.error(`  Total Preferences: ${profile.summary.totalPreferences}`);
  console.error(`  Categories: ${profile.summary.categoriesFound}`);
  console.error(`  Avg Confidence: ${Math.round(profile.summary.avgConfidence * 100)}%`);
  console.error(`  Contradictions: ${profile.contradictions.length}`);
  console.error("");

  outputJson(profile);
}
