/**
 * Team Invitations
 *
 * Invite members to a tenant with a role. Token-based acceptance.
 */

import type { DatabaseAdapter } from "../types";
import type { Role } from "./permissions";
import { createUser, getUserByEmail } from "./users";

export interface Invitation {
  id: string;
  tenant_id: string;
  email: string;
  role: Role;
  invited_by_user_id: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Create an invitation. Returns the raw token (shown once).
 */
export async function createInvitation(
  db: DatabaseAdapter,
  tenantId: string,
  email: string,
  role: Role,
  invitedByUserId: string
): Promise<{ invitation: Invitation; token: string }> {
  // Check if user already exists in tenant
  const existing = await getUserByEmail(db, tenantId, email);
  if (existing) {
    throw new Error("User already exists in this team");
  }

  // Check for existing pending invitation
  const pending = await db.get<{ id: string }>(
    "SELECT id FROM invitations WHERE tenant_id = ? AND email = ? AND accepted_at IS NULL AND expires_at > datetime('now')",
    [tenantId, email]
  );
  if (pending) {
    throw new Error("Invitation already pending for this email");
  }

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const tokenHash = await hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  await db.run(
    `INSERT INTO invitations (id, tenant_id, email, role, invited_by_user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, tenantId, email, role, invitedByUserId, tokenHash, expiresAt]
  );

  const invitation: Invitation = {
    id,
    tenant_id: tenantId,
    email,
    role: role,
    invited_by_user_id: invitedByUserId,
    expires_at: expiresAt,
    accepted_at: null,
    created_at: new Date().toISOString(),
  };

  return { invitation, token };
}

/**
 * Accept an invitation by token. Creates the user.
 */
export async function acceptInvitation(
  db: DatabaseAdapter,
  token: string,
  passwordHash: string
): Promise<{ userId: string; tenantId: string; role: Role }> {
  const tokenHash = await hashInviteToken(token);

  const invite = await db.get<{
    id: string;
    tenant_id: string;
    email: string;
    role: Role;
    accepted_at: string | null;
    expires_at: string;
  }>(
    "SELECT id, tenant_id, email, role, accepted_at, expires_at FROM invitations WHERE token_hash = ?",
    [tokenHash]
  );

  if (!invite) throw new Error("Invalid invitation token");
  if (invite.accepted_at) throw new Error("Invitation already accepted");
  if (new Date(invite.expires_at) < new Date()) throw new Error("Invitation has expired");

  // Create user
  const user = await createUser(db, {
    tenantId: invite.tenant_id,
    email: invite.email,
    passwordHash,
    role: invite.role,
  });

  // Mark invitation as accepted
  await db.run(
    "UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?",
    [invite.id]
  );

  return { userId: user.id, tenantId: invite.tenant_id, role: invite.role };
}

export async function listInvitations(db: DatabaseAdapter, tenantId: string): Promise<Invitation[]> {
  return db.all<Invitation>(
    "SELECT id, tenant_id, email, role, invited_by_user_id, expires_at, accepted_at, created_at FROM invitations WHERE tenant_id = ? ORDER BY created_at DESC",
    [tenantId]
  );
}

export async function cancelInvitation(db: DatabaseAdapter, invitationId: string, tenantId: string): Promise<boolean> {
  const result = await db.run(
    "DELETE FROM invitations WHERE id = ? AND tenant_id = ? AND accepted_at IS NULL",
    [invitationId, tenantId]
  );
  return (result.changes ?? 0) > 0;
}

async function hashInviteToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
