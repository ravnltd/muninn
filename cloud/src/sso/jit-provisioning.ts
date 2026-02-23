/**
 * Just-In-Time User Provisioning
 *
 * Creates or updates users from SAML assertions or OIDC claims.
 * Idempotent: creates if not exists, updates last_login if exists.
 */

import type { DatabaseAdapter } from "../types";
import { createUser, getUserByEmail, updateLastLogin } from "../rbac/users";

export interface SsoUserAttributes {
  email: string;
  name?: string;
}

/**
 * Provision or update a user from SSO assertion.
 * Returns the user_id (existing or newly created).
 */
export async function provisionOrUpdateUser(
  db: DatabaseAdapter,
  tenantId: string,
  attrs: SsoUserAttributes
): Promise<string> {
  const existing = await getUserByEmail(db, tenantId, attrs.email);

  if (existing) {
    // Update last login
    await updateLastLogin(db, existing.id);

    // Update name if provided and different
    if (attrs.name && attrs.name !== existing.name) {
      await db.run(
        "UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?",
        [attrs.name, existing.id]
      );
    }

    return existing.id;
  }

  // Create new user as member (SSO-provisioned users default to member)
  const user = await createUser(db, {
    tenantId,
    email: attrs.email,
    name: attrs.name,
    role: "member",
  });

  return user.id;
}
