/**
 * Shared, side-effect-free helpers for the Keycloak onboarding scripts
 * (apply-user-profile.mjs, backfill-tenant-attribute.mjs). Pure so they are unit tested
 * (services/identity-service/tests/keycloak-user-profile-config.test.ts).
 */

/**
 * Attributes identity-service stamps on every federated realm user. Keycloak 24 runs a
 * declarative user profile with unmanaged attributes disabled, so any attribute not declared
 * here is silently dropped on create/update.
 *   tenantId          what the realm's tenant-id-mapper reads into the `tid` token claim
 *   tid               legacy name identity-service wrote alone (kept so both are accepted)
 *   identity_user_id  identity-service user id (backfill lookup key)
 *   email_addr        real email (the realm email field is not set, see SEC H3)
 * Admin-only edit: a user must never be able to change their own tenant.
 */
export const TENANT_ATTRIBUTES = ["tenantId", "tid", "identity_user_id", "email_addr"];

export function attributeDefinition(name) {
  return {
    name,
    displayName: name,
    validations: {},
    permissions: { view: ["admin"], edit: ["admin"] },
    multivalued: false,
  };
}

const ADMIN_ONLY = (list) => Array.isArray(list) && list.length === 1 && list[0] === "admin";

/** True when view AND edit are exactly ["admin"]: a user must never be able to read-write their own tenant. */
export function isAdminOnly(attr) {
  return ADMIN_ONLY(attr?.permissions?.view) && ADMIN_ONLY(attr?.permissions?.edit);
}

/**
 * Declare any missing CivitasOne attribute, and tighten any already-declared one whose
 * view/edit permissions are not exactly ["admin"], without touching anything else.
 * Idempotent: returns { profile, added, tightened }; both are [] when nothing needed doing.
 */
export function mergeProfile(current) {
  const attributes = Array.isArray(current?.attributes) ? current.attributes : [];
  const have = new Set(attributes.map((a) => a.name));
  const added = TENANT_ATTRIBUTES.filter((n) => !have.has(n));
  const tightened = [];
  const fixed = attributes.map((a) => {
    if (!TENANT_ATTRIBUTES.includes(a.name) || isAdminOnly(a)) return a;
    tightened.push(a.name);
    return { ...a, permissions: { ...(a.permissions ?? {}), view: ["admin"], edit: ["admin"] } };
  });
  return {
    profile: { ...current, attributes: [...fixed, ...added.map(attributeDefinition)] },
    added,
    tightened,
  };
}

/** Mask an email for logs: dm.nashik@maharashtra.gov.in -> d***@maharashtra.gov.in */
export function maskUsername(username) {
  const email = String(username ?? "").split("__").slice(1).join("__");
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

const NAMESPACED = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})__.+$/i;

/** identity-service creates realm users as `<tenantId>__<email>` (SEC H3); that prefix is the tenant binding. */
export function tenantFromUsername(username) {
  const m = NAMESPACED.exec(username ?? "");
  return m ? m[1].toLowerCase() : null;
}

/**
 * Decide what the backfill does for one realm user.
 *   skip      not a tenant-namespaced user (dev/admin users, other tenants' tooling)
 *   ok        already carries the right tenantId (and tid)
 *   conflict  carries a DIFFERENT tenant than its username says: never touched, needs a human
 *   update    missing tenantId and/or tid: set both to the username's tenant
 */
export function planUser(user) {
  const tenant = tenantFromUsername(user.username);
  if (!tenant) return { action: "skip" };
  const attrs = user.attributes ?? {};
  const have = [...(attrs.tenantId ?? []), ...(attrs.tid ?? [])].map((v) => String(v).toLowerCase());
  if (have.some((v) => v !== tenant)) return { action: "conflict", tenant };
  if ((attrs.tenantId ?? []).length > 0 && (attrs.tid ?? []).length > 0) return { action: "ok", tenant };
  return { action: "update", tenant };
}

/** The PUT body: the full representation with the tenant attributes merged in (PUT replaces attributes). */
export function withTenantAttributes(user, tenant) {
  return { ...user, attributes: { ...(user.attributes ?? {}), tenantId: [tenant], tid: [tenant] } };
}

/** Admin REST helpers shared by both scripts. Env: KEYCLOAK_ADMIN_URL|KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_USER|KEYCLOAK_ADMIN, KEYCLOAK_ADMIN_PASSWORD. */
export function readEnv(env = process.env) {
  const url = (env.KEYCLOAK_ADMIN_URL || env.KEYCLOAK_URL || "").replace(/\/+$/, "");
  const user = env.KEYCLOAK_ADMIN_USER ?? env.KEYCLOAK_ADMIN;
  const password = env.KEYCLOAK_ADMIN_PASSWORD;
  if (!url || !user || !password) {
    throw new Error("set KEYCLOAK_ADMIN_URL (or KEYCLOAK_URL), KEYCLOAK_ADMIN_USER and KEYCLOAK_ADMIN_PASSWORD");
  }
  return {
    url,
    realm: env.KEYCLOAK_REALM ?? "civitasone",
    adminRealm: env.KEYCLOAK_ADMIN_REALM ?? "master",
    clientId: env.KEYCLOAK_ADMIN_CLIENT_ID ?? "admin-cli",
    user,
    password,
  };
}

export async function adminToken(cfg) {
  const res = await fetch(`${cfg.url}/realms/${cfg.adminRealm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, username: cfg.user, password: cfg.password, grant_type: "password" }),
  });
  if (!res.ok) throw new Error(`admin token failed: ${res.status}`);
  return (await res.json()).access_token;
}
