/**
 * Stripe Integration (Stub)
 *
 * Placeholder for Phase 3. Checkout sessions, webhooks, subscription management.
 */

import type { DatabaseAdapter } from "../../../src/database/adapter";

export async function createCheckoutSession(
  _db: DatabaseAdapter,
  _tenantId: string,
  _plan: string
): Promise<{ url: string }> {
  // TODO: Phase 3 - Stripe Checkout
  throw new Error("Stripe integration not yet implemented");
}

export async function handleStripeWebhook(
  _db: DatabaseAdapter,
  _payload: string,
  _signature: string
): Promise<void> {
  // TODO: Phase 3 - Stripe webhook handler
  throw new Error("Stripe integration not yet implemented");
}
