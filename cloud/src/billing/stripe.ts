/**
 * Stripe Integration
 *
 * Checkout sessions, webhook handling, billing portal, subscription management.
 */

import Stripe from "stripe";
import type { DatabaseAdapter } from "../types";

// ============================================================================
// Stripe Client (lazy init)
// ============================================================================

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

// ============================================================================
// Checkout
// ============================================================================

/**
 * Create a Stripe Checkout session for upgrading to a paid plan.
 */
export async function createCheckoutSession(
  db: DatabaseAdapter,
  tenantId: string,
  plan: string
): Promise<{ url: string }> {
  const stripe = getStripe();
  const priceId = getPriceId(plan);
  if (!priceId) throw new Error(`Unknown plan: ${plan}`);

  // Get or create Stripe customer
  const tenant = await db.get<{ email: string; stripe_customer_id: string | null }>(
    "SELECT email, stripe_customer_id FROM tenants WHERE id = ?",
    [tenantId]
  );
  if (!tenant) throw new Error("Tenant not found");

  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: tenant.email,
      metadata: { tenantId },
    });
    customerId = customer.id;
    await db.run("UPDATE tenants SET stripe_customer_id = ? WHERE id = ?", [customerId, tenantId]);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `https://muninn.pro/billing?success=true`,
    cancel_url: `https://muninn.pro/billing?canceled=true`,
    metadata: { tenantId },
  });

  if (!session.url) throw new Error("Failed to create checkout session");
  return { url: session.url };
}

// ============================================================================
// Billing Portal
// ============================================================================

/**
 * Create a Stripe Billing Portal session for self-serve subscription management.
 */
export async function createBillingPortalSession(
  db: DatabaseAdapter,
  tenantId: string
): Promise<{ url: string }> {
  const stripe = getStripe();

  const tenant = await db.get<{ stripe_customer_id: string | null }>(
    "SELECT stripe_customer_id FROM tenants WHERE id = ?",
    [tenantId]
  );
  if (!tenant?.stripe_customer_id) {
    throw new Error("No billing account found. Subscribe to a plan first.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripe_customer_id,
    return_url: "https://muninn.pro/billing",
  });

  return { url: session.url };
}

// ============================================================================
// Webhook Handler
// ============================================================================

/**
 * Handle a Stripe webhook event. Verifies signature and processes event.
 */
export async function handleStripeWebhook(
  db: DatabaseAdapter,
  payload: string,
  signature: string
): Promise<void> {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

  const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenantId;
      if (!tenantId) break;

      await db.run(
        `UPDATE tenants SET plan = 'pro', stripe_customer_id = ?, stripe_subscription_id = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [session.customer as string, session.subscription as string, tenantId]
      );
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const plan = subscription.status === "active" ? planFromPriceId(subscription) : "free";

      await db.run(
        "UPDATE tenants SET plan = ?, updated_at = datetime('now') WHERE stripe_customer_id = ?",
        [plan, customerId]
      );
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      await db.run(
        "UPDATE tenants SET plan = 'free', stripe_subscription_id = NULL, updated_at = datetime('now') WHERE stripe_customer_id = ?",
        [customerId]
      );
      break;
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getPriceId(plan: string): string | null {
  if (plan === "pro") return process.env.STRIPE_PRO_PRICE_ID ?? null;
  return null;
}

function planFromPriceId(subscription: Stripe.Subscription): string {
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  const item = subscription.items.data[0];
  if (item?.price.id === proPriceId) return "pro";
  return "free";
}
