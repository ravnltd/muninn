/**
 * Conversation types — Conversation, PatternInstance, Reflection, ProfileSynthesis
 */

// ============================================================================
// Conversation History Types
// ============================================================================

export type ConversationSource = "chatgpt" | "claude";
export type MessageRole = "user" | "assistant" | "system";
export type ExtractionStatus = "pending" | "extracted" | "skipped";

export interface Conversation {
  id: number;
  source: ConversationSource;
  external_id: string | null;
  title: string | null;
  started_at: string | null;
  ended_at: string | null;
  participant_model: string | null;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  total_chars: number;
  tags: string | null; // JSON array
  notes: string | null;
  extraction_status: ExtractionStatus;
  created_at: string;
}

export interface ConversationMessage {
  id: number;
  conversation_id: number;
  role: MessageRole;
  content: string;
  message_index: number;
  timestamp: string | null;
  model: string | null;
  char_count: number | null;
  created_at: string;
}

export interface ConversationImportResult {
  conversationId: number;
  title: string | null;
  messageCount: number;
  source: ConversationSource;
}

export type ExtractEntityType = "learning" | "decision" | "issue" | "preference";

export interface ConversationExtract {
  id: number;
  conversation_id: number;
  entity_type: ExtractEntityType;
  entity_id: number;
  confidence: number | null;
  excerpt: string | null;
  extracted_at: string;
}

export interface ExtractionResult {
  decisions: Array<{
    title: string;
    decision: string;
    reasoning: string;
    confidence: number;
    excerpt?: string;
  }>;
  learnings: Array<{
    title: string;
    content: string;
    category: "pattern" | "gotcha" | "preference" | "convention";
    confidence: number;
    excerpt?: string;
  }>;
  issues: Array<{
    title: string;
    description: string;
    resolution?: string;
    confidence: number;
    excerpt?: string;
  }>;
  preferences: Array<{
    key: string;
    value: string;
    confidence: number;
    excerpt?: string;
  }>;
  projects_mentioned: string[];
}

// ============================================================================
// Pattern & Reflection Types
// ============================================================================

export type PatternType = "preference" | "principle" | "pattern" | "gotcha" | "contradiction";
export type PatternStatus = "active" | "dismissed" | "confirmed";

export interface PatternInstance {
  id: number;
  project_id: number | null;
  pattern_type: PatternType;
  title: string;
  description: string | null;
  entity_refs: string | null; // JSON: [{entity_type, entity_id}, ...]
  conversation_ids: string | null; // JSON: [conv_id, ...]
  aggregate_confidence: number;
  frequency: number;
  status: PatternStatus;
  created_at: string;
  updated_at: string;
}

export interface EntityRef {
  entity_type: ExtractEntityType;
  entity_id: number;
}

export type ReflectionQuestionType = "pattern" | "contradiction" | "validation" | "synthesis";
export type ReflectionQuestionStatus = "open" | "answered" | "dismissed";

export interface ReflectionQuestion {
  id: number;
  project_id: number | null;
  pattern_id: number | null;
  question_type: ReflectionQuestionType;
  question: string;
  context: string | null;
  source_entities: string | null; // JSON: [{entity_type, entity_id}, ...]
  conversation_ids: string | null; // JSON: conversations involved
  confidence: number | null;
  status: ReflectionQuestionStatus;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
}

export interface ConversationAnalysisResult {
  patterns: PatternInstance[];
  contradictions: PatternInstance[];
  summary: {
    totalPatterns: number;
    strongPatterns: number;
    contradictionCount: number;
    unresolvedCount: number;
  };
}

export interface ProfileSynthesis {
  categories: Array<{
    name: string;
    confidence: number;
    entries: Array<{
      key: string;
      value: string;
      confidence: number;
      mentions: number;
      excerpt?: string;
    }>;
  }>;
  contradictions: Array<{
    key: string;
    values: Array<{ value: string; confidence: number; conversationId: number }>;
  }>;
  summary: {
    totalPreferences: number;
    categoriesFound: number;
    avgConfidence: number;
  };
}
