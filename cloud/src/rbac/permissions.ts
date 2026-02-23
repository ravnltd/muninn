/**
 * RBAC Permission Model
 *
 * Fixed roles with predefined permissions. No custom roles.
 */

import type { Context, Next } from "hono";

export type Role = "owner" | "admin" | "member" | "viewer";

export type Permission =
  | "mcp:tools"
  | "mcp:read"
  | "manage_keys"
  | "manage_team"
  | "manage_billing"
  | "manage_sso"
  | "delete_account";

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(["mcp:tools", "mcp:read", "manage_keys", "manage_team", "manage_billing", "manage_sso", "delete_account"]),
  admin: new Set(["mcp:tools", "mcp:read", "manage_keys", "manage_team"]),
  member: new Set(["mcp:tools", "mcp:read"]),
  viewer: new Set(["mcp:read"]),
};

const VALID_ROLES = new Set<string>(Object.keys(ROLE_PERMISSIONS));

export function isValidRole(role: string): role is Role {
  return VALID_ROLES.has(role);
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/**
 * Hono middleware that checks the current user's role for a required permission.
 * Expects `userId` and `role` to be set on context by auth middleware.
 */
export function requirePermission(permission: Permission) {
  return async (c: Context, next: Next) => {
    const role = c.get("role") as string | undefined;
    if (!role || !isValidRole(role)) {
      return c.json({ error: "Forbidden: no role assigned" }, 403);
    }

    if (!hasPermission(role, permission)) {
      return c.json({ error: `Forbidden: requires ${permission} permission` }, 403);
    }

    return next();
  };
}
