/**
 * Secure API Key Management
 *
 * Centralized handling of API keys with:
 * - Validation (format checking)
 * - Secure access (never logged/exposed)
 * - Consistent error handling
 * - Graceful degradation
 */

import { Result, ok, err, ContextError } from "./errors";

// ============================================================================
// Types
// ============================================================================

export type ApiKeyType = "anthropic" | "voyage";

export interface ApiKeyStatus {
  available: boolean;
  valid: boolean;
  error?: string;
}

// ============================================================================
// Key Validation Patterns
// ============================================================================

// Anthropic keys start with "sk-ant-" followed by alphanumeric chars
const ANTHROPIC_KEY_PATTERN = /^sk-ant-[a-zA-Z0-9-_]{20,}$/;

// Voyage keys are typically "pa-" followed by alphanumeric chars
const VOYAGE_KEY_PATTERN = /^pa-[a-zA-Z0-9-_]{20,}$/;

// ============================================================================
// Internal Key Access
// ============================================================================

/**
 * Get raw API key from environment (internal use only)
 * NEVER log or expose the return value
 */
function getRawKey(type: ApiKeyType): string | undefined {
  switch (type) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "voyage":
      return process.env.VOYAGE_API_KEY;
  }
}

/**
 * Validate key format without exposing the key
 */
function validateKeyFormat(type: ApiKeyType, key: string): boolean {
  switch (type) {
    case "anthropic":
      return ANTHROPIC_KEY_PATTERN.test(key);
    case "voyage":
      return VOYAGE_KEY_PATTERN.test(key);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if an API key is available and valid
 * Does NOT expose the key itself
 */
export function checkApiKey(type: ApiKeyType): ApiKeyStatus {
  const key = getRawKey(type);

  if (!key) {
    return {
      available: false,
      valid: false,
      error: `${type.toUpperCase()}_API_KEY not set`,
    };
  }

  if (key.trim() !== key) {
    return {
      available: true,
      valid: false,
      error: `${type.toUpperCase()}_API_KEY has leading/trailing whitespace`,
    };
  }

  if (key.length < 20) {
    return {
      available: true,
      valid: false,
      error: `${type.toUpperCase()}_API_KEY appears to be truncated`,
    };
  }

  // Format validation (warn but don't block - patterns may change)
  const formatValid = validateKeyFormat(type, key);
  if (!formatValid) {
    // Don't block, just note it may be invalid
    return {
      available: true,
      valid: true, // Allow it to proceed
      error: `${type.toUpperCase()}_API_KEY format may be invalid (proceeding anyway)`,
    };
  }

  return {
    available: true,
    valid: true,
  };
}

/**
 * Check if API key is available (simple boolean check)
 */
export function isApiKeyAvailable(type: ApiKeyType): boolean {
  return !!getRawKey(type);
}

/**
 * Get API key for use in requests
 * Returns Result to force proper error handling
 * NEVER log the returned key
 */
export function getApiKey(type: ApiKeyType): Result<string> {
  const status = checkApiKey(type);

  if (!status.available) {
    return err(
      new ContextError(
        status.error || `${type.toUpperCase()}_API_KEY not set`,
        "API_ERROR",
        { keyType: type }
      )
    );
  }

  if (!status.valid) {
    return err(
      new ContextError(
        status.error || `${type.toUpperCase()}_API_KEY is invalid`,
        "API_ERROR",
        { keyType: type }
      )
    );
  }

  // We know the key exists at this point
  const key = getRawKey(type)!;
  return ok(key);
}

/**
 * Execute a function that requires an API key
 * Handles missing/invalid keys gracefully with fallback
 */
export async function withApiKey<T>(
  type: ApiKeyType,
  fn: (key: string) => Promise<T>,
  fallback: T
): Promise<T> {
  const keyResult = getApiKey(type);

  if (!keyResult.ok) {
    return fallback;
  }

  try {
    return await fn(keyResult.value);
  } catch (error) {
    // Don't expose key in error messages
    const message = error instanceof Error ? error.message : String(error);
    // Sanitize any accidental key exposure
    const sanitized = message.replace(/sk-ant-[a-zA-Z0-9-_]+/g, "[REDACTED]")
                             .replace(/pa-[a-zA-Z0-9-_]+/g, "[REDACTED]");
    throw new Error(sanitized);
  }
}

/**
 * Redact any API keys from a string (for safe logging)
 */
export function redactApiKeys(text: string): string {
  return text
    .replace(/sk-ant-[a-zA-Z0-9-_]+/g, "[ANTHROPIC_KEY_REDACTED]")
    .replace(/pa-[a-zA-Z0-9-_]+/g, "[VOYAGE_KEY_REDACTED]")
    .replace(/Bearer\s+[a-zA-Z0-9-_]+/g, "Bearer [REDACTED]")
    .replace(/x-api-key:\s*[a-zA-Z0-9-_]+/gi, "x-api-key: [REDACTED]");
}

/**
 * Get a masked version of the key for display (first 8 chars + ...)
 */
export function getMaskedKey(type: ApiKeyType): string | null {
  const key = getRawKey(type);
  if (!key || key.length < 12) return null;
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
}

// ============================================================================
// Environment Helpers
// ============================================================================

/**
 * Get summary of all API key statuses (for diagnostics)
 */
export function getApiKeysSummary(): Record<ApiKeyType, ApiKeyStatus> {
  return {
    anthropic: checkApiKey("anthropic"),
    voyage: checkApiKey("voyage"),
  };
}

/**
 * Print API key status (for CLI diagnostics)
 */
export function printApiKeyStatus(): void {
  const summary = getApiKeysSummary();

  console.error("\n🔑 API Key Status:\n");

  for (const [type, status] of Object.entries(summary)) {
    const icon = status.available && status.valid ? "✅" : status.available ? "⚠️" : "❌";
    const masked = getMaskedKey(type as ApiKeyType);
    const display = masked ? ` (${masked})` : "";

    console.error(`  ${icon} ${type.toUpperCase()}_API_KEY${display}`);
    if (status.error) {
      console.error(`     ${status.error}`);
    }
  }
  console.error("");
}
