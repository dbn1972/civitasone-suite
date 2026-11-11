/**
 * Keycloak Admin provisioning client (wave 2).
 *
 * Federates identity-service users into the Keycloak realm so they can
 * authenticate via OIDC. Operations:
 *   - provisionUser:    create (or no-op if exists) the realm user on user create
 *   - assignRealmRoles: map existing REALM roles (by name) onto a federated user —
 *                        the piece provisionUser deliberately does NOT do (see below)
 *   - deactivateUser:   disable the user + revoke/logout all sessions on deactivate
 *   - reconcileUser:    drift-repair — ensure realm state matches identity-service
 *
 * FEATURE FLAG / GRACEFUL DEGRADATION:
 *   This client is ENABLED only when admin credentials are present in env
 *   (KEYCLOAK_ADMIN_USER + KEYCLOAK_ADMIN_PASSWORD, or KEYCLOAK_ADMIN +
 *   KEYCLOAK_ADMIN_PASSWORD). When credentials are absent the client is
 *   DISABLED: every call is a logged no-op that returns { skipped: true }.
 *   User creation/deactivation in identity-service MUST NOT fail because
 *   Keycloak is unconfigured or unreachable — provisioning is best-effort and
 *   its failures are logged + captured, never propagated to the caller.
 *
 *   ADMIN ENDPOINT (FQ17): KEYCLOAK_ADMIN_URL (optional) is the base URL used
 *   for EVERY call this client makes -- the admin token endpoint
 *   (/realms/<adminRealm>/protocol/openid-connect/token) and the Admin REST
 *   API (/admin/realms/...). Set it to an internal/private Keycloak URL when
 *   KEYCLOAK_URL is the PUBLIC URL: packages/auth uses KEYCLOAK_URL for the
 *   JWKS URI and the JWT issuer check, so it must stay public, while the
 *   public reverse proxy does not expose /auth/admin/*. When KEYCLOAK_ADMIN_URL
 *   is unset (or empty) it falls back to KEYCLOAK_URL (previous behaviour).
 */
import { captureError } from "@civitasone/observability";

// tenantVerified (FQ14): the realm user carries a tenant attribute (`tenantId`, the one
// the realm's tenant-id-mapper turns into the `tid` claim; `tid` is accepted too) equal to
// the target tenant. Only then may kcUserId be recorded as the identity user's
// Keycloak id (users.users.keycloak_user_id).
export type KcResult = { ok: boolean; skipped?: boolean; reason?: string; kcUserId?: string; tenantVerified?: boolean };

type KcConfig = {
  /** Base URL for admin token + Admin REST API calls (KEYCLOAK_ADMIN_URL, else KEYCLOAK_URL). */
  url: string;
  realm: string;
  adminRealm: string;
  adminUser: string;
  adminPassword: string;
  adminClientId: string;
};

function readConfig(): KcConfig | null {
  // FQ17: admin token + Admin REST API go to KEYCLOAK_ADMIN_URL when set;
  // KEYCLOAK_URL (public, also used by packages/auth) is only the fallback.
  const url = process.env.KEYCLOAK_ADMIN_URL || process.env.KEYCLOAK_URL;
  const realm = process.env.KEYCLOAK_REALM ?? "civitasone";
  const adminUser = process.env.KEYCLOAK_ADMIN_USER ?? process.env.KEYCLOAK_ADMIN;
  const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
  if (!url || !adminUser || !adminPassword) return null;
  return {
    url: url.replace(/\/+$/, ""),
    realm,
    adminRealm: process.env.KEYCLOAK_ADMIN_REALM ?? "master",
    adminUser,
    adminPassword,
    adminClientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? "admin-cli",
  };
}

export function isKeycloakEnabled(): boolean {
  return readConfig() !== null;
}

const DEFAULT_KC_TIMEOUT_MS = 10_000;

/** Per-request timeout so a hung Keycloak cannot stall provisioning or the reconciler tick (CLOS3-S5-12). */
function kcTimeoutMs(): number {
  const n = Number(process.env.KEYCLOAK_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_KC_TIMEOUT_MS;
}

/** fetch with an AbortSignal timeout; the aborts surface as rejections the callers' try/catch already map to { ok:false }. */
function kcFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(kcTimeoutMs()) });
}

// Cached admin token (Keycloak access tokens are short-lived; cache with margin).
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAdminToken(cfg: KcConfig): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 5000) return tokenCache.token;
  const res = await kcFetch(`${cfg.url}/realms/${cfg.adminRealm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.adminClientId,
      username: cfg.adminUser,
      password: cfg.adminPassword,
      grant_type: "password",
    }),
  });
  if (!res.ok) throw new Error(`keycloak admin token failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return body.access_token;
}

/**
 * SEC H3 — the Keycloak username is namespaced by tenant so two tenants that
 * share an email address map to TWO distinct realm users. Without this, an
 * email-only lookup collapses both tenants onto one KC user and deactivating
 * one tenant's user would disable the other's.
 */
function kcUsername(tenantId: string, email: string): string {
  // Keycloak's default username policy rejects ':' (error-username-invalid-character)
  // but allows letters, digits, and `. _ - @`. Use a double-underscore separator
  // so the tenant-namespaced username is realm-valid. The tenant UUID + email both
  // consist only of allowed characters.
  return `${tenantId}__${email.toLowerCase()}`;
}

/**
 * SEC H3 — look up a realm user by the tenant-namespaced username (exact). We
 * never resolve by realm-wide email, and we defensively confirm the `tid`
 * attribute matches the tenant so a cross-tenant match can never be acted on.
 */
async function findUser(cfg: KcConfig, token: string, tenantId: string, email: string): Promise<{ id: string; enabled: boolean; tenantVerified: boolean } | null> {
  const username = kcUsername(tenantId, email);
  const res = await kcFetch(
    `${cfg.url}/admin/realms/${cfg.realm}/users?username=${encodeURIComponent(username)}&exact=true&briefRepresentation=false`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`keycloak user lookup failed: ${res.status}`);
  const arr = (await res.json()) as Array<{ id: string; enabled: boolean; username?: string; attributes?: KcAttrs }>;
  // Exact-username match, and (when present) tid must match the tenant. Never
  // fall back to a different tenant's record.
  // (Lifecycle actions -- disable, enable, reset -- keep accepting a realm user
  // with no tid, as before: the username is tenant-namespaced. Recording a
  // Keycloak id as an identity mapping additionally requires tenantVerified.)
  const hit = arr.find((u) => u.username === username && (tenantValues(u.attributes).length === 0 || tenantValues(u.attributes).every((t) => t === tenantId)));
  return hit ? { id: hit.id, enabled: hit.enabled, tenantVerified: hasTenantTid(hit.attributes, tenantId) } : null;
}

type KcAttrs = { tid?: string[]; tenantId?: string[]; identity_user_id?: string[] };

/**
 * Every tenant value a realm user carries. `tenantId` is the attribute the realm's user
 * profile declares and the tenant-id-mapper reads; `tid` is what identity-service used to
 * write alone, and Keycloak's declarative user profile silently dropped it (UAT onboarding gap).
 */
function tenantValues(attrs: KcAttrs | undefined): string[] {
  return [...(attrs?.tenantId ?? []), ...(attrs?.tid ?? [])];
}

/** FQ14: a tenant attribute is present and ALL values equal the tenant (fail closed when absent or disagreeing). */
function hasTenantTid(attrs: KcAttrs | undefined, tenantId: string): boolean {
  const v = tenantValues(attrs);
  return v.length > 0 && v.every((t) => t === tenantId);
}

/**
 * Create the federated realm user (idempotent). Stores the identity-service
 * user id + tenant id as Keycloak attributes (tid mapper) so issued tokens
 * carry the right tenant claim. Best-effort: never throws.
 */
export async function provisionUser(u: { id: string; tenantId: string; email: string; name: string }, log?: { warn: (o: unknown, m: string) => void }): Promise<KcResult> {
  const cfg = readConfig();
  if (!cfg) {
    log?.warn({ userId: u.id }, "keycloak provisioning skipped (no admin creds)");
    return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  }
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, u.tenantId, u.email);
    if (existing) return { ok: true, kcUserId: existing.id, tenantVerified: existing.tenantVerified, reason: "already exists" };
    const [firstName, ...rest] = u.name.trim().split(/\s+/);
    const res = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        // SEC H3: tenant-namespaced username is the SOLE identity key. We do NOT
        // set the realm-wide unique `email` field — with the realm's default
        // duplicateEmailsAllowed=false that field would collide for two tenants
        // sharing an address and collapse them onto one KC user (exactly the bug
        // being fixed). The real email is preserved as a non-unique attribute so
        // it is still available to mappers/claims, scoped per (tenant, user).
        username: kcUsername(u.tenantId, u.email),
        emailVerified: true,
        enabled: true,
        firstName: firstName ?? u.name,
        lastName: rest.join(" "),
        attributes: { tenantId: [u.tenantId], tid: [u.tenantId], identity_user_id: [u.id], email_addr: [u.email] },
      }),
    });
    if (res.status !== 201 && res.status !== 409) {
      throw new Error(`keycloak user create failed: ${res.status} ${await res.text()}`);
    }
    const created = await findUser(cfg, token, u.tenantId, u.email);
    return { ok: true, ...(created ? { kcUserId: created.id, tenantVerified: created.tenantVerified } : {}) };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_provision_failed", userId: u.id });
    log?.warn({ userId: u.id, err: String(err) }, "keycloak provisioning failed (degraded)");
    return { ok: false, reason: String(err) };
  }
}

/**
 * FQ14: find (never create) the realm user for an identity user, for the
 * keycloak_user_id backfill. First by the tenant-namespaced username (how
 * provisionUser creates it), then by the identity_user_id attribute
 * provisionUser stamps on it. Either hit must carry this tenant's `tid`
 * attribute when it has one, so another tenant's realm user is never returned.
 * Read-only and best-effort: never throws.
 */
export async function lookupUserId(u: { tenantId: string; email: string; identityUserId: string }): Promise<KcResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const byName = await findUser(cfg, token, u.tenantId, u.email);
    if (byName) {
      return byName.tenantVerified
        ? { ok: true, kcUserId: byName.id, tenantVerified: true, reason: "username" }
        : { ok: true, reason: "tid_missing: realm user has no tid attribute for this tenant" };
    }
    const res = await kcFetch(
      `${cfg.url}/admin/realms/${cfg.realm}/users?q=${encodeURIComponent(`identity_user_id:${u.identityUserId}`)}&exact=true&briefRepresentation=false`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`keycloak attribute lookup failed: ${res.status}`);
    const arr = (await res.json()) as Array<{ id: string; attributes?: KcAttrs }>;
    const hits = arr.filter((k) => (k.attributes?.identity_user_id ?? []).includes(u.identityUserId));
    if (hits.length === 1) {
      return hasTenantTid(hits[0]!.attributes, u.tenantId)
        ? { ok: true, kcUserId: hits[0]!.id, tenantVerified: true, reason: "identity_user_id attribute" }
        : { ok: true, reason: "tid_missing: realm user has no tid attribute for this tenant" };
    }
    if (hits.length > 1) return { ok: true, reason: "ambiguous: several realm users carry this identity_user_id" };
    return { ok: true, reason: "user not present in keycloak" };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_lookup_failed", userId: u.identityUserId });
    return { ok: false, reason: String(err) };
  }
}

/**
 * Map realm ROLES (by name) onto an already-federated user.
 *
 * provisionUser() deliberately never does this itself: it only creates the
 * bare realm user (username/attributes), with no realm-role mapping call at
 * all. Nothing else in the codebase calls Keycloak's role-mappings endpoint
 * either — the identity-service `rbac` module's role-assign command family
 * (identity.rbac.role.assign) writes to identity-service's OWN tenant-scoped
 * custom-permission tables (roleId → a row in that tenant's rbac_roles),
 * which is unrelated to, and never reaches, Keycloak. So a user federated via
 * provisionUser() alone ends up with ZERO realm roles beyond Keycloak's own
 * built-in `default-roles-<realm>` composite — every `requireRole()` check in
 * every service then 403s for them, confirmed live against this realm: the
 * two users already provisioned this way (tenant-namespaced usernames, no
 * caller ever having called a role-mapping endpoint for them) carry only
 * `default-roles-civitasone`.
 *
 * This function is the missing piece: given realm ROLE NAMES, resolve each to
 * its Keycloak role representation ({id, name} — the role-mappings endpoint
 * requires the full representation, not a bare name) and POST them onto the
 * user's realm role-mappings. A role name that does not exist in this realm's
 * catalog is skipped (logged), not fatal — the realm's role catalog can lag
 * what services expect (see infra/keycloak/civitasone-realm.json drift), and
 * granting the subset that DOES exist is strictly better than granting none.
 *
 * Best-effort, same graceful-degradation contract as the rest of this file:
 * never throws, returns { ok:false } (captured + logged) on failure so a
 * Keycloak hiccup never blocks the caller's own success path.
 */
export async function assignRealmRoles(
  u: { tenantId: string; email: string },
  roleNames: string[],
  log?: { warn: (o: unknown, m: string) => void },
): Promise<KcResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  if (roleNames.length === 0) return { ok: true, reason: "no roles requested" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, u.tenantId, u.email);
    if (!existing) return { ok: false, reason: "user not present in keycloak" };

    const resolved: Array<{ id: string; name: string }> = [];
    for (const name of roleNames) {
      const res = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/roles/${encodeURIComponent(name)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.status === 200) {
        const role = (await res.json()) as { id: string; name: string };
        resolved.push({ id: role.id, name: role.name });
      } else if (res.status === 404) {
        log?.warn({ tenantId: u.tenantId, email: u.email, role: name }, "keycloak realm role not found in catalog — skipped");
      } else {
        throw new Error(`keycloak role lookup failed: ${res.status} (role=${name})`);
      }
    }
    if (resolved.length === 0) {
      return { ok: false, reason: "none of the requested roles exist in the realm catalog" };
    }

    const upd = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/role-mappings/realm`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(resolved),
    });
    if (!upd.ok && upd.status !== 204) {
      throw new Error(`keycloak role-mapping assign failed: ${upd.status} ${await upd.text()}`);
    }
    const assignedNames = resolved.map((r) => r.name);
    const skippedNames = roleNames.filter((n) => !assignedNames.includes(n));
    return {
      ok: true,
      kcUserId: existing.id,
      reason: skippedNames.length === 0
        ? `assigned: ${assignedNames.join(", ")}`
        : `assigned: ${assignedNames.join(", ")}; skipped (not in catalog): ${skippedNames.join(", ")}`,
    };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_role_assign_failed", tenantId: u.tenantId, email: u.email });
    log?.warn({ tenantId: u.tenantId, email: u.email, err: String(err) }, "keycloak role assignment failed (degraded)");
    return { ok: false, reason: String(err) };
  }
}

/**
 * Disable the realm user and log out all their sessions. Best-effort (returns
 * { ok:false } rather than throwing). SEC H3: scoped to the user's tenant via
 * the namespaced username — deactivating one tenant's user never touches a
 * same-email user in another tenant.
 */
export async function deactivateUser(tenantId: string, email: string, log?: { warn: (o: unknown, m: string) => void }): Promise<KcResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, tenantId, email);
    if (!existing) return { ok: true, reason: "user not present in keycloak" };
    const upd = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    if (!upd.ok && upd.status !== 204) throw new Error(`keycloak disable failed: ${upd.status}`);
    // Logout all sessions.
    await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    return { ok: true, kcUserId: existing.id };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_deactivate_failed", tenantId, email });
    log?.warn({ tenantId, email, err: String(err) }, "keycloak deactivation failed (degraded)");
    return { ok: false, reason: String(err) };
  }
}

/**
 * Drift reconcile: ensure the realm user exists and its enabled-state matches
 * the desired identity-service status. Used by an admin-triggered reconcile path.
 */export async function reconcileUser(u: { id: string; tenantId: string; email: string; name: string; active: boolean }, log?: { warn: (o: unknown, m: string) => void }): Promise<KcResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, u.tenantId, u.email);
    if (!existing) {
      if (!u.active) return { ok: true, reason: "inactive user absent in keycloak — no action" };
      return provisionUser(u, log);
    }
    if (existing.enabled !== u.active) {
      const upd = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ enabled: u.active }),
      });
      if (!upd.ok && upd.status !== 204) throw new Error(`keycloak reconcile update failed: ${upd.status}`);
      return { ok: true, kcUserId: existing.id, tenantVerified: existing.tenantVerified, reason: `enabled set to ${u.active}` };
    }
    return { ok: true, kcUserId: existing.id, tenantVerified: existing.tenantVerified, reason: "already in sync" };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_reconcile_failed", userId: u.id });
    log?.warn({ userId: u.id, err: String(err) }, "keycloak reconcile failed (degraded)");
    return { ok: false, reason: String(err) };
  }
}

/**
 * Request a password reset for a federated realm user.
 *
 * HONEST SEMANTICS:
 *   - When Keycloak admin creds ARE configured: we set the UPDATE_PASSWORD
 *     required action on the realm user so their NEXT login forces a password
 *     change, and (best-effort) trigger Keycloak's execute-actions-email so the
 *     user receives the reset link. We never set or learn the password ourselves.
 *   - When Keycloak is NOT configured (e.g. local/dev, or before the realm is
 *     wired): this is a logged no-op that returns { skipped: true }. The HTTP
 *     caller still records the request + emits an audit event and returns 202;
 *     NO credential is changed in that mode. This is intentional and surfaced to
 *     the operator via the audit trail.
 *
 * Best-effort: never throws — failures are captured + returned as { ok:false }.
 */
export async function requestPasswordReset(tenantId: string, email: string, log?: { warn: (o: unknown, m: string) => void }): Promise<KcResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, tenantId, email);
    if (!existing) return { ok: true, reason: "user not present in keycloak" };
    // 1) Force a password change on next login by setting the required action.
    const upd = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ requiredActions: ["UPDATE_PASSWORD"] }),
    });
    if (!upd.ok && upd.status !== 204) throw new Error(`keycloak set-required-action failed: ${upd.status}`);
    // 2) Best-effort: email the user the reset/update-password action link. A
    //    failure here (e.g. SMTP not configured in the realm) must not fail the
    //    reset — the required action above still enforces the change at login.
    await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/execute-actions-email`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(["UPDATE_PASSWORD"]),
    }).catch(() => undefined);
    return { ok: true, kcUserId: existing.id, reason: "UPDATE_PASSWORD required action set" };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_password_reset_failed", tenantId, email });
    log?.warn({ tenantId, email, err: String(err) }, "keycloak password reset failed (degraded)");
    return { ok: false, reason: String(err) };
  }
}

type KcLog = { warn: (o: unknown, m: string) => void };

/**
 * Re-enable a previously disabled realm user (platform-operator reactivation).
 * The disabling half is deactivateUser(). Best-effort: never throws.
 */
export async function enableUser(tenantId: string, email: string, log?: KcLog): Promise<KcResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, tenantId, email);
    if (!existing) return { ok: false, reason: "user not present in keycloak" };
    if (existing.enabled) return { ok: true, kcUserId: existing.id, reason: "already enabled" };
    const upd = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    if (!upd.ok && upd.status !== 204) throw new Error(`keycloak enable failed: ${upd.status}`);
    return { ok: true, kcUserId: existing.id };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_enable_failed", tenantId, email });
    log?.warn({ tenantId, email, err: String(err) }, "keycloak enable failed (degraded)");
    return { ok: false, reason: String(err) };
  }
}

/**
 * Swap realm roles on a federated user (platform-operator role change): remove
 * `remove`, add `add`, then log the user out so the next token carries the new
 * roles. Unknown role names are skipped like assignRealmRoles(). Best-effort.
 */
export async function replaceRealmRoles(
  u: { tenantId: string; email: string },
  remove: string[],
  add: string[],
  log?: KcLog,
): Promise<KcResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, u.tenantId, u.email);
    if (!existing) return { ok: false, reason: "user not present in keycloak" };
    const missing: string[] = [];
    const lookup = async (names: string[]) => {
      const out: Array<{ id: string; name: string }> = [];
      for (const name of names) {
        const res = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/roles/${encodeURIComponent(name)}`, { headers: { authorization: `Bearer ${token}` } });
        if (res.status === 200) out.push((await res.json()) as { id: string; name: string });
        else if (res.status === 404) missing.push(name);
        else throw new Error(`keycloak role lookup failed: ${res.status} (role=${name})`);
      }
      return out;
    };
    const mapping = `${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/role-mappings/realm`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const toRemove = await lookup(remove);
    if (toRemove.length > 0) {
      const del = await kcFetch(mapping, { method: "DELETE", headers, body: JSON.stringify(toRemove) });
      if (!del.ok && del.status !== 204) throw new Error(`keycloak role-mapping remove failed: ${del.status}`);
    }
    const toAdd = await lookup(add);
    if (toAdd.length > 0) {
      const post = await kcFetch(mapping, { method: "POST", headers, body: JSON.stringify(toAdd) });
      if (!post.ok && post.status !== 204) throw new Error(`keycloak role-mapping assign failed: ${post.status}`);
    }
    await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    return { ok: true, kcUserId: existing.id, ...(missing.length ? { reason: `skipped (not in realm catalog): ${missing.join(", ")}` } : {}) };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_role_replace_failed", tenantId: u.tenantId, email: u.email });
    log?.warn({ tenantId: u.tenantId, email: u.email, err: String(err) }, "keycloak role replacement failed (degraded)");
    return { ok: false, reason: String(err) };
  }
}


// ─── Usable logins on create (migration 0034 flow) ───────────────────────────────────────────

export type LoginProfileResult = KcResult & { emailSet?: boolean; emailConflict?: boolean; attributesSet?: boolean };

/**
 * Make a federated realm user usable as a login: stamp the tenant / identity attributes the token
 * mappers and the HR login-link read (tenantId, tid, identity_user_id, email_addr), mark the email
 * verified, and set the realm `email` so the user can sign in with it and receive an action email.
 *
 * Safety: the user is found by the tenant-namespaced username (never by email), an existing
 * `identity_user_id` that names a DIFFERENT identity user is never overwritten, and an email already
 * owned by another realm user (realm duplicateEmailsAllowed=false, e.g. the same address in another tenant)
 * is reported as emailConflict, never forced. Idempotent. Best-effort: never throws.
 */
export async function applyLoginProfile(
  u: { id: string; tenantId: string; email: string; name: string },
  log?: { warn: (o: unknown, m: string) => void },
): Promise<LoginProfileResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const found = await findUser(cfg, token, u.tenantId, u.email);
    if (!found) return { ok: false, reason: "user not present in keycloak" };
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const getRes = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${found.id}`, { headers: { authorization: `Bearer ${token}` } });
    if (!getRes.ok) throw new Error(`keycloak user read failed: ${getRes.status}`);
    const rep = (await getRes.json()) as { username: string; email?: string; attributes?: Record<string, string[]> };
    const attrs = { ...(rep.attributes ?? {}) };
    const existingIdentity = attrs.identity_user_id ?? [];
    if (existingIdentity.length > 0 && !existingIdentity.includes(u.id)) {
      return { ok: false, kcUserId: found.id, reason: "identity_user_id_mismatch: realm user already belongs to a different identity user" };
    }
    attrs.tenantId = [u.tenantId];
    attrs.tid = [u.tenantId];
    attrs.identity_user_id = [u.id];
    attrs.email_addr = [u.email];
    const [firstName, ...rest] = u.name.trim().split(/\s+/);
    const base = {
      username: rep.username, enabled: true, emailVerified: true,
      firstName: firstName ?? u.name, lastName: rest.join(" ") || (firstName ?? u.name), attributes: attrs,
    };
    const wantEmail = !rep.email;
    let put = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${found.id}`, {
      method: "PUT", headers, body: JSON.stringify(wantEmail ? { ...base, email: u.email.toLowerCase() } : base),
    });
    let emailConflict = false;
    if (put.status === 409 && wantEmail) {
      emailConflict = true;
      put = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${found.id}`, { method: "PUT", headers, body: JSON.stringify(base) });
    }
    if (!put.ok && put.status !== 204) throw new Error(`keycloak profile update failed: ${put.status}`);
    return {
      ok: true, kcUserId: found.id, tenantVerified: true, attributesSet: true,
      emailSet: Boolean(rep.email) || !emailConflict, emailConflict,
      ...(emailConflict ? { reason: "email_conflict: another realm user already owns this email" } : {}),
    };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_login_profile_failed", userId: u.id });
    log?.warn({ userId: u.id, err: String(err) }, "keycloak login profile failed (degraded)");
    return { ok: false, reason: String(err) };
  }
}

/** Current realm role NAMES mapped directly on a federated user. Read-only, best-effort. */
export async function getRealmRoleNames(u: { tenantId: string; email: string }): Promise<KcResult & { roles?: string[] }> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, u.tenantId, u.email);
    if (!existing) return { ok: false, reason: "user not present in keycloak" };
    const res = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/role-mappings/realm`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`keycloak role-mappings read failed: ${res.status}`);
    const arr = (await res.json()) as Array<{ name: string }>;
    return { ok: true, kcUserId: existing.id, roles: arr.map((r) => r.name) };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_role_read_failed", tenantId: u.tenantId, email: u.email });
    return { ok: false, reason: String(err) };
  }
}

/**
 * Preferred first-password path: Keycloak emails the user its own "update your password" action link
 * (UPDATE_PASSWORD, with a lifespan). We never see or set a password. Needs the realm to have SMTP and the
 * realm user to have an email; when either is missing the call reports why (mail_not_configured / no_email) so
 * the caller can fall back to the single-use link, instead of pretending a mail went out.
 */
export async function sendSetPasswordEmail(
  u: { tenantId: string; email: string },
  lifespanSeconds: number,
  log?: { warn: (o: unknown, m: string) => void },
): Promise<KcResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, u.tenantId, u.email);
    if (!existing) return { ok: false, reason: "user not present in keycloak" };
    const rep = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}`, { headers: { authorization: `Bearer ${token}` } });
    if (!rep.ok) throw new Error(`keycloak user read failed: ${rep.status}`);
    if (!((await rep.json()) as { email?: string }).email) return { ok: false, kcUserId: existing.id, reason: "no_email" };
    const mail = await kcFetch(
      `${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/execute-actions-email?lifespan=${Math.max(60, Math.floor(lifespanSeconds))}`,
      { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(["UPDATE_PASSWORD"]) },
    );
    if (!mail.ok && mail.status !== 204) return { ok: false, kcUserId: existing.id, reason: `mail_not_configured: keycloak answered ${mail.status}` };
    return { ok: true, kcUserId: existing.id, reason: "set-password email requested" };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_set_password_email_failed", tenantId: u.tenantId, email: u.email });
    log?.warn({ tenantId: u.tenantId, err: String(err) }, "keycloak set-password email failed (degraded)");
    return { ok: false, reason: String(err) };
  }
}

/**
 * Set a user's FIRST (or replacement) password from a redeemed single-use token. The password only passes
 * through this function into Keycloak's reset-password call; it is never stored, logged or returned, and no
 * error message built here includes it. A 400 is Keycloak's password policy refusing it.
 */
export async function setUserPassword(
  u: { tenantId: string; email: string },
  password: string,
  opts: { firstPasswordOnly: boolean } = { firstPasswordOnly: true },
): Promise<KcResult & { policyRejected?: boolean }> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, u.tenantId, u.email);
    if (!existing) return { ok: false, reason: "user not present in keycloak" };
    if (!existing.enabled) return { ok: false, kcUserId: existing.id, reason: "user_disabled" };
    if (opts.firstPasswordOnly) {
      // Re-checked at redeem time (not only at issue time): the user may have set a password another way since.
      const cr = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/credentials`, { headers: { authorization: `Bearer ${token}` } });
      if (!cr.ok) throw new Error(`keycloak credential read failed: ${cr.status}`);
      if (((await cr.json()) as Array<{ type?: string }>).some((c) => c.type === "password")) {
        return { ok: false, kcUserId: existing.id, reason: "password_already_set" };
      }
    }
    const res = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/reset-password`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "password", value: password, temporary: false }),
    });
    if (res.status === 400) return { ok: false, kcUserId: existing.id, policyRejected: true, reason: "password_policy" };
    if (!res.ok && res.status !== 204) throw new Error(`keycloak set password failed: ${res.status}`);
    // The password is set; clear any pending UPDATE_PASSWORD so the user is not asked again at first login.
    await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}`, {
      method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ requiredActions: [], emailVerified: true }),
    });
    return { ok: true, kcUserId: existing.id };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_set_password_failed", tenantId: u.tenantId });
    return { ok: false, reason: "keycloak_unavailable" };
  }
}

/**
 * Does the realm user already have a password credential? Used to keep the set-password link a FIRST-password
 * tool: a link can never be used to take over an account that already has a password (that is what the emailed
 * reset is for). Fails closed: if this cannot be determined the caller must refuse.
 */
export async function userHasPassword(u: { tenantId: string; email: string }): Promise<KcResult & { hasPassword?: boolean }> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, skipped: true, reason: "keycloak admin creds not configured" };
  try {
    const token = await getAdminToken(cfg);
    const existing = await findUser(cfg, token, u.tenantId, u.email);
    if (!existing) return { ok: false, reason: "user not present in keycloak" };
    const res = await kcFetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/credentials`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`keycloak credential read failed: ${res.status}`);
    const creds = (await res.json()) as Array<{ type?: string }>;
    return { ok: true, kcUserId: existing.id, hasPassword: creds.some((c) => c.type === "password") };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_credential_read_failed", tenantId: u.tenantId });
    return { ok: false, reason: "keycloak_unavailable" };
  }
}
