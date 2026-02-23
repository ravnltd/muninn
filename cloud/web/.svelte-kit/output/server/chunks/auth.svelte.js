import { i as derived } from "./index2.js";
import { a as api } from "./api.js";
let tenant = null;
let loading = true;
let error = null;
const isAuthenticated = derived(() => tenant !== null);
async function initialize() {
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
function setTenant(t) {
  tenant = t;
  loading = false;
  error = null;
}
function setError(msg) {
  error = msg;
}
function clearError() {
  error = null;
}
function logout() {
  tenant = null;
  api.logout();
}
function getAuth() {
  return {
    get tenant() {
      return tenant;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get isAuthenticated() {
      return isAuthenticated();
    },
    initialize,
    setTenant,
    setError,
    clearError,
    logout
  };
}
export {
  getAuth as g
};
