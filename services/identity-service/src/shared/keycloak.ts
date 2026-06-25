/**
 * Keycloak Admin provisioning client (wave 2).
 *
 * Federates identity-service users into the Keycloak realm so they can
 * authenticate via OIDC. Operations:
 *   - provisionUser:   create (or no-op if exists) the realm user on user create
 *   - deactivateUser:  disable the user + revoke/logout all sessions on deactivate
 *   - reconcileUser:   drift-repair — ensure realm state matches identity-service
 *
 * FEATURE FLAG / GRACEFUL DEGRADATION:
 *   This client is ENABLED only when admin credentials are present in env
 *   (KEYCLOAK_ADMIN_USER + KEYCLOAK_ADMIN_PASSWORD, or KEYCLOAK_ADMIN +
 *   KEYCLOAK_ADMIN_PASSWORD). When credentials are absent the client is
 *   DISABLED: every call is a logged no-op that returns { skipped: true }.
 *   User creation/deactivation in identity-service MUST NOT fail because
 *   Keycloak is unconfigured or unreachable — provisioning is best-effort and
 *   its failures are logged + captured, never propagated to the caller.
 */
import { captureError } from "@civitasone/observability";

export type KcResult = { ok: boolean; skipped?: boolean; reason?: string; kcUserId?: string };

type KcConfig = {
  url: string;
  realm: string;
  adminRealm: string;
  adminUser: string;
  adminPassword: string;
  adminClientId: string;
};

function readConfig(): KcConfig | null {
  const url = process.env.KEYCLOAK_URL;
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

// Cached admin token (Keycloak access tokens are short-lived; cache with margin).
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAdminToken(cfg: KcConfig): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 5000) return tokenCache.token;
  const res = await fetch(`${cfg.url}/realms/${cfg.adminRealm}/protocol/openid-connect/token`, {
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
async function findUser(cfg: KcConfig, token: string, tenantId: string, email: string): Promise<{ id: string; enabled: boolean } | null> {
  const username = kcUsername(tenantId, email);
  const res = await fetch(
    `${cfg.url}/admin/realms/${cfg.realm}/users?username=${encodeURIComponent(username)}&exact=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`keycloak user lookup failed: ${res.status}`);
  const arr = (await res.json()) as Array<{ id: string; enabled: boolean; username?: string; attributes?: { tid?: string[] } }>;
  // Exact-username match, and (when present) tid must match the tenant. Never
  // fall back to a different tenant's record.
  const hit = arr.find((u) => u.username === username && (!u.attributes?.tid || u.attributes.tid.includes(tenantId)));
  return hit ? { id: hit.id, enabled: hit.enabled } : null;
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
    if (existing) return { ok: true, kcUserId: existing.id, reason: "already exists" };
    const [firstName, ...rest] = u.name.trim().split(/\s+/);
    const res = await fetch(`${cfg.url}/admin/realms/${cfg.realm}/users`, {
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
        attributes: { tid: [u.tenantId], identity_user_id: [u.id], email_addr: [u.email] },
      }),
    });
    if (res.status !== 201 && res.status !== 409) {
      throw new Error(`keycloak user create failed: ${res.status} ${await res.text()}`);
    }
    const created = await findUser(cfg, token, u.tenantId, u.email);
    return { ok: true, ...(created ? { kcUserId: created.id } : {}) };
  } catch (err) {
    captureError(err, { service: "identity", event: "keycloak_provision_failed", userId: u.id });
    log?.warn({ userId: u.id, err: String(err) }, "keycloak provisioning failed (degraded)");
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
    const upd = await fetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    if (!upd.ok && upd.status !== 204) throw new Error(`keycloak disable failed: ${upd.status}`);
    // Logout all sessions.
    await fetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/logout`, {
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
      const upd = await fetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ enabled: u.active }),
      });
      if (!upd.ok && upd.status !== 204) throw new Error(`keycloak reconcile update failed: ${upd.status}`);
      return { ok: true, kcUserId: existing.id, reason: `enabled set to ${u.active}` };
    }
    return { ok: true, kcUserId: existing.id, reason: "already in sync" };
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
    const upd = await fetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ requiredActions: ["UPDATE_PASSWORD"] }),
    });
    if (!upd.ok && upd.status !== 204) throw new Error(`keycloak set-required-action failed: ${upd.status}`);
    // 2) Best-effort: email the user the reset/update-password action link. A
    //    failure here (e.g. SMTP not configured in the realm) must not fail the
    //    reset — the required action above still enforces the change at login.
    await fetch(`${cfg.url}/admin/realms/${cfg.realm}/users/${existing.id}/execute-actions-email`, {
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
