/**
 * Conversation Analysis Engine
 * Detect patterns and contradictions across extracted conversation knowledge
 */

import type { DatabaseAdapter } from "../database/adapter";
import type {
  ConversationAnalysisResult,
  EntityRef,
  ExtractEntityType,
  PatternInstance,
  PatternType,
} from "../types";
import { outputJson } from "../utils/format";

// ============================================================================
// Configuration
// ============================================================================

const MIN_FREQUENCY_FOR_PATTERN = 2;
const STRONG_PATTERN_CONFIDENCE = 0.85;

// ============================================================================
// Pattern Detection
// ============================================================================

interface ExtractedEntity {
  id: number;
  type: ExtractEntityType;
  title: string;
  content: string;
  confidence: number;
  conversationId: number;
  category?: string;
}

/**
 * Get all extracted entities from conversations
 */
async function getExtractedEntities(
  db: DatabaseAdapter,
  projectId: number
): Promise<ExtractedEntity[]> {
  const entities: ExtractedEntity[] = [];

  // Get decisions
  const decisions = await db.all<{
    id: number;
    title: string;
    decision: string;
    conversation_id: number;
    confidence: number;
  }>(
    `SELECT d.id, d.title, d.decision, ce.conversation_id, ce.confidence
     FROM decisions d
     JOIN conversation_extracts ce ON ce.entity_type = 'decision' AND ce.entity_id = d.id
     WHERE d.project_id = ?`,
    [projectId]
  );

  for (const d of decisions) {
    entities.push({
      id: d.id,
      type: "decision",
      title: d.title,
      content: d.decision,
      confidence: d.confidence,
      conversationId: d.conversation_id,
    });
  }

  // Get learnings
  const learnings = await db.all<{
    id: number;
    title: string;
    content: string;
    category: string;
    conversation_id: number;
    confidence: number;
  }>(
    `SELECT l.id, l.title, l.content, l.category, ce.conversation_id, ce.confidence
     FROM learnings l
     JOIN conversation_extracts ce ON ce.entity_type = 'learning' AND ce.entity_id = l.id
     WHERE l.project_id = ?`,
    [projectId]
  );

  for (const l of learnings) {
    entities.push({
      id: l.id,
      type: "learning",
      title: l.title,
      content: l.content,
      confidence: l.confidence,
      conversationId: l.conversation_id,
      category: l.category,
    });
  }

  // Get preferences from developer_profile
  const preferences = await db.all<{
    id: number;
    key: string;
    value: string;
    confidence: number;
  }>(
    `SELECT id, key, value, confidence
     FROM developer_profile
     WHERE project_id = ? AND source = 'conversation'`,
    [projectId]
  );

  for (const p of preferences) {
    entities.push({
      id: p.id,
      type: "preference",
      title: p.key,
      content: p.value,
      confidence: p.confidence,
      conversationId: 0, // Preferences are aggregated, no single conversation
    });
  }

  return entities;
}

/**
 * Normalize text for comparison (lowercase, trim, remove extra whitespace)
 */
function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Check if two texts are similar (simple fuzzy match)
 */
function areSimilar(a: string, b: string, threshold = 0.8): boolean {
  const normA = normalizeText(a);
  const normB = normalizeText(b);

  // Exact match
  if (normA === normB) return true;

  // One contains the other
  if (normA.includes(normB) || normB.includes(normA)) return true;

  // Simple word overlap
  const wordsA = new Set(normA.split(" ").filter((w) => w.length > 3));
  const wordsB = new Set(normB.split(" ").filter((w) => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return false;

  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const overlap = intersection.size / Math.min(wordsA.size, wordsB.size);

  return overlap >= threshold;
}

/**
 * Detect recurring patterns across conversations
 */
export async function detectPatterns(
  db: DatabaseAdapter,
  projectId: number
): Promise<PatternInstance[]> {
  const entities = await getExtractedEntities(db, projectId);
  const patterns: PatternInstance[] = [];

  // Group entities by similar titles
  const titleGroups: Map<string, ExtractedEntity[]> = new Map();

  for (const entity of entities) {
    let foundGroup = false;

    for (const [key, group] of titleGroups) {
      if (areSimilar(entity.title, key, 0.7)) {
        group.push(entity);
        foundGroup = true;
        break;
      }
    }

    if (!foundGroup) {
      titleGroups.set(entity.title, [entity]);
    }
  }

  // Convert groups with 2+ items into patterns
  for (const [title, group] of titleGroups) {
    if (group.length < MIN_FREQUENCY_FOR_PATTERN) continue;

    const entityRefs: EntityRef[] = group.map((e) => ({
      entity_type: e.type,
      entity_id: e.id,
    }));

    const conversationIds = [...new Set(group.map((e) => e.conversationId).filter((id) => id > 0))];

    // Calculate aggregate confidence
    const avgConfidence = group.reduce((sum, e) => sum + e.confidence, 0) / group.length;
    const frequencyBoost = Math.log10(group.length + 1);
    const aggregateConfidence = Math.min(avgConfidence * (1 + frequencyBoost * 0.1), 1.0);

    // Determine pattern type
    let patternType: PatternType = "pattern";
    const firstEntity = group[0];

    if (firstEntity.type === "preference") {
      patternType = "preference";
    } else if (firstEntity.category === "gotcha") {
      patternType = "gotcha";
    } else if (
      firstEntity.content.toLowerCase().includes("always") ||
      firstEntity.content.toLowerCase().includes("never")
    ) {
      patternType = "principle";
    }

    // Build description from content
    const description = group
      .slice(0, 3)
      .map((e) => e.content.slice(0, 100))
      .join(" | ");

    patterns.push({
      id: 0, // Will be assigned on insert
      project_id: projectId,
      pattern_type: patternType,
      title: title,
      description: description.slice(0, 500),
      entity_refs: JSON.stringify(entityRefs),
      conversation_ids: JSON.stringify(conversationIds),
      aggregate_confidence: aggregateConfidence,
      frequency: group.length,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return patterns.sort((a, b) => b.frequency - a.frequency);
}

/**
 * Detect contradictions in extracted knowledge
 */
export async function detectContradictions(
  db: DatabaseAdapter,
  projectId: number
): Promise<PatternInstance[]> {
  const contradictions: PatternInstance[] = [];

  // 1. Find preferences with same key but different values
  const preferenceConflicts = await db.all<{
    key: string;
    distinct_values: string;
    value_count: number;
  }>(
    `SELECT key, GROUP_CONCAT(DISTINCT value) as distinct_values, COUNT(DISTINCT value) as value_count
     FROM developer_profile
     WHERE project_id = ?
     GROUP BY key
     HAVING value_count > 1`,
    [projectId]
  );

  for (const conflict of preferenceConflicts) {
    contradictions.push({
      id: 0,
      project_id: projectId,
      pattern_type: "contradiction",
      title: `Conflicting preference: ${conflict.key}`,
      description: `Multiple values found: ${conflict.distinct_values}`,
      entity_refs: null,
      conversation_ids: null,
      aggregate_confidence: 0.9,
      frequency: conflict.value_count,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  // 2. Find learnings with opposing language patterns
  const learnings = await db.all<{
    id: number;
    title: string;
    content: string;
    conversation_id: number;
  }>(
    `SELECT l.id, l.title, l.content, ce.conversation_id
     FROM learnings l
     JOIN conversation_extracts ce ON ce.entity_type = 'learning' AND ce.entity_id = l.id
     WHERE l.project_id = ?`,
    [projectId]
  );

  // Look for "always X" vs "sometimes don't X" patterns
  const alwaysPatterns = learnings.filter(
    (l) => l.content.toLowerCase().includes("always") || l.content.toLowerCase().includes("never")
  );

  const sometimesPatterns = learnings.filter(
    (l) =>
      l.content.toLowerCase().includes("sometimes") ||
      l.content.toLowerCase().includes("depending")
  );

  // Check for potential conflicts between always and sometimes
  for (const always of alwaysPatterns) {
    for (const sometimes of sometimesPatterns) {
      if (areSimilar(always.title, sometimes.title, 0.6)) {
        contradictions.push({
          id: 0,
          project_id: projectId,
          pattern_type: "contradiction",
          title: `Conflicting advice: ${always.title}`,
          description: `"${always.content.slice(0, 100)}..." vs "${sometimes.content.slice(0, 100)}..."`,
          entity_refs: JSON.stringify([
            { entity_type: "learning", entity_id: always.id },
            { entity_type: "learning", entity_id: sometimes.id },
          ]),
          conversation_ids: JSON.stringify(
            [always.conversation_id, sometimes.conversation_id].filter((id) => id > 0)
          ),
          aggregate_confidence: 0.7,
          frequency: 2,
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  // 3. Find decisions with similar titles but different decisions
  const decisions = await db.all<{
    id: number;
    title: string;
    decision: string;
    conversation_id: number;
  }>(
    `SELECT d.id, d.title, d.decision, ce.conversation_id
     FROM decisions d
     JOIN conversation_extracts ce ON ce.entity_type = 'decision' AND ce.entity_id = d.id
     WHERE d.project_id = ?`,
    [projectId]
  );

  // Group by similar titles
  const decisionGroups: Map<string, typeof decisions> = new Map();

  for (const decision of decisions) {
    let foundGroup = false;

    for (const [key, group] of decisionGroups) {
      if (areSimilar(decision.title, key, 0.7)) {
        group.push(decision);
        foundGroup = true;
        break;
      }
    }

    if (!foundGroup) {
      decisionGroups.set(decision.title, [decision]);
    }
  }

  // Check for contradicting decisions in each group
  for (const [title, group] of decisionGroups) {
    if (group.length < 2) continue;

    // Check if decisions in group are different
    const uniqueDecisions = new Set(group.map((d) => normalizeText(d.decision)));
    if (uniqueDecisions.size > 1) {
      contradictions.push({
        id: 0,
        project_id: projectId,
        pattern_type: "contradiction",
        title: `Conflicting decisions: ${title}`,
        description: group.map((d) => d.decision.slice(0, 80)).join(" vs "),
        entity_refs: JSON.stringify(
          group.map((d) => ({ entity_type: "decision", entity_id: d.id }))
        ),
        conversation_ids: JSON.stringify(
          [...new Set(group.map((d) => d.conversation_id))].filter((id) => id > 0)
        ),
        aggregate_confidence: 0.8,
        frequency: group.length,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  return contradictions;
}

/**
 * Store patterns in the database
 */
export async function storePatterns(
  db: DatabaseAdapter,
  patterns: PatternInstance[]
): Promise<number> {
  let stored = 0;

  for (const pattern of patterns) {
    // Check if pattern already exists (by title and type)
    const existing = await db.get<{ id: number }>(
      `SELECT id FROM pattern_instances
       WHERE project_id = ? AND pattern_type = ? AND title = ?`,
      [pattern.project_id, pattern.pattern_type, pattern.title]
    );

    if (existing) {
      // Update existing pattern
      await db.run(
        `UPDATE pattern_instances
         SET frequency = ?, aggregate_confidence = ?, entity_refs = ?,
             conversation_ids = ?, description = ?, updated_at = ?
         WHERE id = ?`,
        [
          pattern.frequency,
          pattern.aggregate_confidence,
          pattern.entity_refs,
          pattern.conversation_ids,
          pattern.description,
          new Date().toISOString(),
          existing.id,
        ]
      );
    } else {
      // Insert new pattern
      await db.run(
        `INSERT INTO pattern_instances
         (project_id, pattern_type, title, description, entity_refs, conversation_ids,
          aggregate_confidence, frequency, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pattern.project_id,
          pattern.pattern_type,
          pattern.title,
          pattern.description,
          pattern.entity_refs,
          pattern.conversation_ids,
          pattern.aggregate_confidence,
          pattern.frequency,
          pattern.status,
          pattern.created_at,
          pattern.updated_at,
        ]
      );
      stored++;
    }
  }

  return stored;
}

/**
 * Run full analysis (patterns + contradictions)
 */
export async function runFullAnalysis(
  db: DatabaseAdapter,
  projectId: number
): Promise<ConversationAnalysisResult> {
  const patterns = await detectPatterns(db, projectId);
  const contradictions = await detectContradictions(db, projectId);

  // Store patterns and contradictions
  await storePatterns(db, [...patterns, ...contradictions]);

  return {
    patterns: patterns.filter((p) => p.frequency >= MIN_FREQUENCY_FOR_PATTERN),
    contradictions,
    summary: {
      totalPatterns: patterns.length,
      strongPatterns: patterns.filter((p) => p.aggregate_confidence >= STRONG_PATTERN_CONFIDENCE)
        .length,
      contradictionCount: contradictions.length,
      unresolvedCount: contradictions.filter((c) => c.status === "active").length,
    },
  };
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleAnalysisCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[]
): Promise<void> {
  const patternsOnly = args.includes("--patterns");
  const contradictionsOnly = args.includes("--contradictions");

  console.error("\n🔬 Analyzing extracted knowledge...\n");

  if (patternsOnly) {
    const patterns = await detectPatterns(db, projectId);
    await storePatterns(db, patterns);

    console.error(`📊 Patterns Detected: ${patterns.length}\n`);

    for (const p of patterns.slice(0, 10)) {
      const confidence = Math.round(p.aggregate_confidence * 100);
      console.error(`  [${p.pattern_type}] ${p.title}`);
      console.error(`    Frequency: ${p.frequency}x, Confidence: ${confidence}%`);
      if (p.description) {
        console.error(`    ${p.description.slice(0, 80)}...`);
      }
      console.error("");
    }

    outputJson({ patterns });
    return;
  }

  if (contradictionsOnly) {
    const contradictions = await detectContradictions(db, projectId);
    await storePatterns(db, contradictions);

    console.error(`⚠️  Contradictions Found: ${contradictions.length}\n`);

    for (const c of contradictions) {
      console.error(`  ${c.title}`);
      if (c.description) {
        console.error(`    ${c.description.slice(0, 100)}...`);
      }
      console.error("");
    }

    outputJson({ contradictions });
    return;
  }

  // Full analysis
  const result = await runFullAnalysis(db, projectId);

  console.error("📊 Analysis Summary:");
  console.error(`   Total Patterns: ${result.summary.totalPatterns}`);
  console.error(`   Strong Patterns (≥85%): ${result.summary.strongPatterns}`);
  console.error(`   Contradictions: ${result.summary.contradictionCount}`);
  console.error(`   Unresolved: ${result.summary.unresolvedCount}`);
  console.error("");

  if (result.patterns.length > 0) {
    console.error("Top Patterns:");
    for (const p of result.patterns.slice(0, 5)) {
      const confidence = Math.round(p.aggregate_confidence * 100);
      console.error(`  • ${p.title} (${p.frequency}x, ${confidence}%)`);
    }
    console.error("");
  }

  if (result.contradictions.length > 0) {
    console.error("Contradictions:");
    for (const c of result.contradictions.slice(0, 5)) {
      console.error(`  ⚠️ ${c.title}`);
    }
    console.error("");
  }

  outputJson(result);
}
