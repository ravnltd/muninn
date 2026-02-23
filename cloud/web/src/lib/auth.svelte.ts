import { api } from './api';
import type { Tenant } from './types';

let tenant = $state<Tenant | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);

const isAuthenticated = $derived(tenant !== null);

async function initialize(): Promise<void> {
  if (!api.isAuthenticated()) {
    loading = false;
    return;
  }

  try {
    const account = await api.getAccount();
    tenant = account.tenant;
  } catch {
    tenant = null;
  } finally {
    loading = false;
  }
}

function setTenant(t: Tenant): void {
  tenant = t;
  loading = false;
  error = null;
}

function setError(msg: string): void {
  error = msg;
}

function clearError(): void {
  error = null;
}

function logout(): void {
  tenant = null;
  api.logout();
}

export function getAuth() {
  return {
    get tenant() { return tenant; },
    get loading() { return loading; },
    get error() { return error; },
    get isAuthenticated() { return isAuthenticated; },
    initialize,
    setTenant,
    setError,
    clearError,
    logout
  };
}
