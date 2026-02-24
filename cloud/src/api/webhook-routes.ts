/**
 * GitHub Webhook Routes — PR-Integrated Learning
 *
 * POST /webhooks/github
 *   Receives GitHub PR review events and extracts learning patterns
 *   from review comments. Stores as pr_review_extracts and optionally
 *   promotes recurring patterns to learnings.
 *
 * Security: Validates X-Hub-Signature-256 header using GITHUB_WEBHOOK_SECRET.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "./middleware";
import { getTenantDb } from "../tenants/pool";

const webhookRoutes = new Hono<AuthedEnv>();

// Validate GitHub webhook signature
async function verifyGitHubSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;
  const expected = signature.replace("sha256=", "");

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison to prevent timing oracle attacks
  if (computed.length !== expected.length) return false;
  const a = new TextEncoder().encode(computed);
  const b = new TextEncoder().encode(expected);
  const { timingSafeEqual } = await import("node:crypto");
  return timingSafeEqual(a, b);
}

// Schema for the parts of PR review we care about
const ReviewCommentSchema = z.object({
  body: z.string(),
  path: z.string().optional(),
  user: z.object({ login: z.string() }).optional(),
});

const PullRequestSchema = z.object({
  title: z.string(),
  number: z.number(),
  html_url: z.string().optional(),
});

/**
 * POST /webhooks/github
 *
 * Accepts: pull_request_review, pull_request_review_comment events
 * Extracts learning patterns from review feedback.
 */
webhookRoutes.post("/github", async (c) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("X-Hub-Signature-256");

  const valid = await verifyGitHubSignature(rawBody, signature, secret);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = c.req.header("X-GitHub-Event");
  if (!event) {
    return c.json({ error: "Missing event header" }, 400);
  }

  // Only process review-related events
  if (event !== "pull_request_review" && event !== "pull_request_review_comment") {
    return c.json({ accepted: false, reason: "Irrelevant event type" }, 200);
  }

  const payload = JSON.parse(rawBody);
  const action = payload.action;

  // Only care about submitted reviews and created comments
  if (action !== "submitted" && action !== "created") {
    return c.json({ accepted: false, reason: "Irrelevant action" }, 200);
  }

  // Extract tenant from custom header or installation mapping
  const tenantId = c.req.header("X-Muninn-Tenant");
  if (!tenantId) {
    return c.json({ error: "Missing X-Muninn-Tenant header" }, 400);
  }

  const db = await getTenantDb(tenantId);
  if (!db) {
    return c.json({ error: "Unknown tenant" }, 404);
  }

  try {
    const pr = PullRequestSchema.parse(payload.pull_request);
    const body = event === "pull_request_review"
      ? payload.review?.body
      : payload.comment?.body;
    const filePath = payload.comment?.path ?? null;
    const reviewer = payload.review?.user?.login ?? payload.comment?.user?.login ?? "unknown";

    if (!body || body.trim().length < 10) {
      return c.json({ accepted: false, reason: "Comment too short" }, 200);
    }

    // Extract learning patterns from review text
    const patterns = extractLearningPatterns(body);

    // Store the raw review extract
    await db.run(
      `INSERT INTO pr_review_extracts (project_id, reviewer, pr_number, category, content, file_path, created_at)
       VALUES ((SELECT id FROM projects LIMIT 1), ?, ?, ?, ?, ?, datetime('now'))`,
      [reviewer, pr.number, patterns.category, body.slice(0, 2000), filePath],
    );

    // If a strong pattern is detected, create a learning
    if (patterns.isActionable) {
      await db.run(
        `INSERT INTO learnings (project_id, title, content, category, context, confidence, created_at, updated_at)
         VALUES ((SELECT id FROM projects LIMIT 1), ?, ?, ?, ?, 5, datetime('now'), datetime('now'))`,
        [
          `PR #${pr.number}: ${patterns.title}`,
          patterns.content,
          patterns.category,
          `From PR review by ${reviewer} on ${pr.title}`,
        ],
      );
    }

    return c.json({
      accepted: true,
      pr: pr.number,
      category: patterns.category,
      learningCreated: patterns.isActionable,
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : "Failed to process webhook",
    }, 400);
  }
});

interface LearningPattern {
  category: string;
  title: string;
  content: string;
  isActionable: boolean;
}

/** Extract learning patterns from PR review text */
function extractLearningPatterns(text: string): LearningPattern {
  const lower = text.toLowerCase();

  // Detect pattern categories via keyword matching
  const patterns: Array<{ keywords: string[]; category: string }> = [
    { keywords: ["bug", "fix", "broken", "crash", "error", "null"], category: "bug-fix" },
    { keywords: ["performance", "slow", "optimize", "cache", "n+1"], category: "performance" },
    { keywords: ["security", "xss", "injection", "auth", "secret", "token"], category: "security" },
    { keywords: ["naming", "convention", "style", "format", "lint"], category: "style" },
    { keywords: ["architecture", "pattern", "design", "refactor", "abstract"], category: "architecture" },
    { keywords: ["test", "coverage", "assertion", "mock", "spec"], category: "testing" },
    { keywords: ["type", "interface", "generic", "any", "typescript"], category: "types" },
  ];

  let bestCategory = "general";
  let bestScore = 0;

  for (const pattern of patterns) {
    const score = pattern.keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = pattern.category;
    }
  }

  // Extract a title from the first sentence or line
  const firstLine = text.split(/[.\n]/)[0]?.trim() ?? "Review feedback";
  const title = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;

  // Actionable if: has suggestion keywords and is substantial
  const isActionable = text.length > 50 && (
    lower.includes("should") ||
    lower.includes("consider") ||
    lower.includes("instead") ||
    lower.includes("better to") ||
    lower.includes("prefer") ||
    lower.includes("always") ||
    lower.includes("never") ||
    lower.includes("pattern")
  );

  return {
    category: bestCategory,
    title,
    content: text.slice(0, 1000),
    isActionable,
  };
}

export { webhookRoutes };
