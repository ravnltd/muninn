/**
 * User Management
 *
 * CRUD operations for users within a tenant.
 */

import type { DatabaseAdapter } from "../types";
import type { Role } from "./permissions";

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  name: string | null;
  role: Role;
  status: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  tenantId: string;
  email: string;
  name?: string;
  passwordHash?: string;
  role: Role;
}

export async function createUser(db: DatabaseAdapter, input: CreateUserInput): Promise<User> {
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO users (id, tenant_id, email, name, password_hash, role, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [id, input.tenantId, input.email, input.name ?? null, input.passwordHash ?? null, input.role]
  );

  return {
    id,
    tenant_id: input.tenantId,
    email: input.email,
    name: input.name ?? null,
    role: input.role,
    status: "active",
    last_login_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function getUserById(db: DatabaseAdapter, userId: string): Promise<User | null> {
  return db.get<User>(
    "SELECT id, tenant_id, email, name, role, status, last_login_at, created_at, updated_at FROM users WHERE id = ?",
    [userId]
  );
}

export async function getUserByEmail(db: DatabaseAdapter, tenantId: string, email: string): Promise<User | null> {
  return db.get<User>(
    "SELECT id, tenant_id, email, name, role, status, last_login_at, created_at, updated_at FROM users WHERE tenant_id = ? AND email = ?",
    [tenantId, email]
  );
}

export async function listUsers(db: DatabaseAdapter, tenantId: string): Promise<User[]> {
  return db.all<User>(
    "SELECT id, tenant_id, email, name, role, status, last_login_at, created_at, updated_at FROM users WHERE tenant_id = ? AND status != 'deleted' ORDER BY created_at",
    [tenantId]
  );
}

export async function updateRole(db: DatabaseAdapter, userId: string, tenantId: string, newRole: Role): Promise<boolean> {
  const result = await db.run(
    "UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?",
    [newRole, userId, tenantId]
  );
  return (result.changes ?? 0) > 0;
}

export async function suspendUser(db: DatabaseAdapter, userId: string, tenantId: string): Promise<boolean> {
  const result = await db.run(
    "UPDATE users SET status = 'suspended', updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND role != 'owner'",
    [userId, tenantId]
  );
  return (result.changes ?? 0) > 0;
}

export async function deleteUser(db: DatabaseAdapter, userId: string, tenantId: string): Promise<boolean> {
  const result = await db.run(
    "UPDATE users SET status = 'deleted', updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND role != 'owner'",
    [userId, tenantId]
  );
  return (result.changes ?? 0) > 0;
}

export async function updateLastLogin(db: DatabaseAdapter, userId: string): Promise<void> {
  await db.run(
    "UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [userId]
  );
}

export async function getTenantOwner(db: DatabaseAdapter, tenantId: string): Promise<User | null> {
  return db.get<User>(
    "SELECT id, tenant_id, email, name, role, status, last_login_at, created_at, updated_at FROM users WHERE tenant_id = ? AND role = 'owner' LIMIT 1",
    [tenantId]
  );
}
