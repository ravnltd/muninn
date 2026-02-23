/**
 * Team Management API Routes
 *
 * CRUD for team members and invitations.
 * All routes require manage_team permission (owner or admin).
 */

import { Hono } from "hono";
import { z } from "zod";
import { getManagementDb } from "../db/management";
import { requirePermission } from "../rbac/permissions";
import { listUsers, updateRole, deleteUser } from "../rbac/users";
import { createInvitation, listInvitations, cancelInvitation, acceptInvitation } from "../rbac/invitations";
import { isValidRole } from "../rbac/permissions";
import { logAudit } from "../compliance/audit-log";
import type { AuthedEnv } from "./middleware";

const team = new Hono<AuthedEnv>();

// All team management routes require manage_team permission
team.use("/*", requirePermission("manage_team"));

// List team members
team.get("/members", async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();
  const members = await listUsers(mgmtDb, tenantId);

  return c.json({
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name,
      role: m.role,
      status: m.status,
      lastLoginAt: m.last_login_at,
      createdAt: m.created_at,
    })),
  });
});

// Update member role
const UpdateRoleInput = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});

team.patch("/members/:userId", async (c) => {
  const tenantId = c.get("tenantId");
  const targetUserId = c.req.param("userId");
  const currentUserId = c.get("userId") as string;

  if (targetUserId === currentUserId) {
    return c.json({ error: "Cannot change your own role" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateRoleInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message ?? "Invalid role" }, 400);
  }

  const mgmtDb = await getManagementDb();
  const updated = await updateRole(mgmtDb, targetUserId, tenantId, parsed.data.role);
  if (!updated) {
    return c.json({ error: "User not found or cannot change owner role" }, 404);
  }

  await logAudit(tenantId, "update_role", "user", targetUserId, {
    metadata: { newRole: parsed.data.role, updatedBy: currentUserId },
  });

  return c.json({ success: true });
});

// Remove member
team.delete("/members/:userId", async (c) => {
  const tenantId = c.get("tenantId");
  const targetUserId = c.req.param("userId");
  const currentUserId = c.get("userId") as string;

  if (targetUserId === currentUserId) {
    return c.json({ error: "Cannot remove yourself" }, 400);
  }

  const mgmtDb = await getManagementDb();
  const deleted = await deleteUser(mgmtDb, targetUserId, tenantId);
  if (!deleted) {
    return c.json({ error: "User not found or cannot remove owner" }, 404);
  }

  await logAudit(tenantId, "remove_member", "user", targetUserId, {
    metadata: { removedBy: currentUserId },
  });

  return c.json({ success: true });
});

// Invite member
const InviteInput = z.object({
  email: z.string().email().max(254),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});

team.post("/invite", async (c) => {
  const tenantId = c.get("tenantId");
  const currentUserId = c.get("userId") as string;

  const body = await c.req.json().catch(() => ({}));
  const parsed = InviteInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message ?? "Validation failed" }, 400);
  }

  try {
    const mgmtDb = await getManagementDb();
    const { invitation, token } = await createInvitation(
      mgmtDb,
      tenantId,
      parsed.data.email,
      parsed.data.role,
      currentUserId
    );

    await logAudit(tenantId, "invite_member", "invitation", invitation.id, {
      metadata: { email: parsed.data.email, role: parsed.data.role, invitedBy: currentUserId },
    });

    return c.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expires_at,
      },
      inviteToken: token,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create invitation";
    return c.json({ error: message }, 400);
  }
});

// List invitations
team.get("/invitations", async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();
  const invitations = await listInvitations(mgmtDb, tenantId);

  return c.json({
    invitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expires_at,
      acceptedAt: inv.accepted_at,
      createdAt: inv.created_at,
    })),
  });
});

// Cancel invitation
team.delete("/invitations/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const invitationId = c.req.param("id");
  const mgmtDb = await getManagementDb();

  const cancelled = await cancelInvitation(mgmtDb, invitationId, tenantId);
  if (!cancelled) {
    return c.json({ error: "Invitation not found or already accepted" }, 404);
  }

  return c.json({ success: true });
});

export { team as teamRoutes };

// ============================================================================
// Public invite acceptance route (mounted separately, no auth required)
// ============================================================================

const inviteAccept = new Hono();

const AcceptInput = z.object({
  token: z.string().uuid(),
  password: z.string().min(8).max(128),
});

inviteAccept.post("/accept", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = AcceptInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message ?? "Validation failed" }, 400);
  }

  try {
    const passwordHash = await Bun.password.hash(parsed.data.password, { algorithm: "bcrypt", cost: 12 });
    const mgmtDb = await getManagementDb();
    const result = await acceptInvitation(mgmtDb, parsed.data.token, passwordHash);

    await logAudit(result.tenantId, "accept_invitation", "user", result.userId);

    return c.json({
      userId: result.userId,
      tenantId: result.tenantId,
      role: result.role,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to accept invitation";
    return c.json({ error: message }, 400);
  }
});

export { inviteAccept as inviteAcceptRoutes };
