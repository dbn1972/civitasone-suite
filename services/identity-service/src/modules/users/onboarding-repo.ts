/**
 * Persistence for the usable-logins flow (migration 0034): the per-tenant switch and the single-use
 * set-password tokens. Everything is tenant-scoped through RLS (users.current_tenant_id()) AND an explicit
 * tenant_id predicate. A token carries its tenant id in clear (a tenant id is not a secret) so the PUBLIC
 * redeem route can enter the right tenant context before touching the table; the secret half is 256 random
 * bits of which only the SHA-256 is stored.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, gt, inArray, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { tenantOnboardingSettings, passwordSetupTokens } from "./onboarding-schema.js";
import { users } from "./schema.js";

export type PasswordMode = "email" | "link" | "off";
export type OnboardingSettings = { usableLogins: boolean; passwordMode: PasswordMode; source: "tenant" | "default" };

/** What a tenant with no row gets: today's behaviour. */
export const DEFAULT_SETTINGS: OnboardingSettings = { usableLogins: false, passwordMode: "link", source: "default" };

export async function getSettings(tenantId: string): Promise<OnboardingSettings> {
  const rows = await scopedRead((tx) => tx.select().from(tenantOnboardingSettings)
    .where(eq(tenantOnboardingSettings.tenantId, tenantId)).limit(1));
  const r = rows[0];
  return r ? { usableLogins: r.usableLogins, passwordMode: r.passwordMode as PasswordMode, source: "tenant" } : DEFAULT_SETTINGS;
}

export async function putSettings(tenantId: string, actorId: string, s: { usableLogins: boolean; passwordMode: PasswordMode }, correlationId: string): Promise<OnboardingSettings> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(tenantOnboardingSettings)
      .values({ tenantId, usableLogins: s.usableLogins, passwordMode: s.passwordMode, updatedBy: actorId })
      .onConflictDoUpdate({ target: tenantOnboardingSettings.tenantId, set: { usableLogins: s.usableLogins, passwordMode: s.passwordMode, updatedBy: actorId, updatedAt: new Date() } });
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: "audit.event.record", eventType: "audit.event.record", tenantId, actorId, correlationId,
      payload: { service: "identity", action: "onboarding_settings_change", resourceType: "tenant", resourceId: tenantId, outcome: "success", severity: "high", usableLogins: s.usableLogins, passwordMode: s.passwordMode },
    });
  }));
  return { ...s, source: "tenant" };
}

// ─── single-use set-password tokens ──────────────────────────────────────────────────────────

const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;
const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

export function parseSetupToken(raw: string): { tenantId: string; hash: string } | null {
  const m = TOKEN_RE.exec(raw);
  return m ? { tenantId: m[1]!.toLowerCase(), hash: sha256(m[2]!) } : null;
}

export const SETUP_TTL_DEFAULT_SECONDS = 24 * 3600;
export const SETUP_TTL_MAX_SECONDS = 72 * 3600;
export const SETUP_TTL_MIN_SECONDS = 600;

export function setupTtlSeconds(): number {
  const n = Number(process.env.IDENTITY_SET_PASSWORD_TTL_SECONDS);
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : SETUP_TTL_DEFAULT_SECONDS;
  return Math.min(SETUP_TTL_MAX_SECONDS, Math.max(SETUP_TTL_MIN_SECONDS, v));
}

/**
 * Issue a token for `userId`, revoking any earlier unused one (one live link per user). The clear token is
 * returned to the caller exactly once and never stored.
 */
export async function issueSetupToken(tenantId: string, userId: string, actorId: string, grantorRoles: readonly string[], correlationId: string, ttlSeconds = setupTtlSeconds()): Promise<{ id: string; token: string; expiresAt: Date }> {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.update(passwordSetupTokens).set({ revokedAt: new Date() }).where(and(
      eq(passwordSetupTokens.tenantId, tenantId), eq(passwordSetupTokens.userId, userId),
      isNull(passwordSetupTokens.consumedAt), isNull(passwordSetupTokens.revokedAt),
    ));
    await tx.insert(passwordSetupTokens).values({ id, tenantId, userId, tokenHash: sha256(secret), createdBy: actorId, grantorRoles: [...grantorRoles], expiresAt });
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: "audit.event.record", eventType: "audit.event.record", tenantId, actorId, correlationId,
      // The audit record names the token row id and expiry, never the token or its hash.
      payload: { service: "identity", action: "password_setup_link_issue", resourceType: "user", resourceId: userId, outcome: "success", severity: "medium", tokenId: id, expiresAt: expiresAt.toISOString() },
    });
  }));
  return { id, token: `${tenantId}.${secret}`, expiresAt };
}

export type RedeemOutcome =
  | { status: "invalid" }
  | { status: "applied" }
  | { status: "rejected"; reason: string };

class RollbackWith extends Error {
  constructor(public outcome: RedeemOutcome) { super("rollback"); }
}

/**
 * Redeem a token. Inside ONE tenant transaction: lock the token row, check it is live (unused, unrevoked, not
 * expired) and its user is active, MARK IT CONSUMED AND WRITE THE AUDIT RECORD FIRST, then run `apply` (the
 * Keycloak password set), and commit. Ordering matters:
 *  - if the consume/audit write fails, nothing has touched Keycloak, so no password is set behind an unconsumed token;
 *  - if `apply` refuses (policy, outage, roles changed) the transaction is rolled back, so the token stays valid
 *    for a retry;
 *  - the row lock makes it single-use under concurrency.
 * Residual: Keycloak accepts the password and the process dies (or the commit fails) before COMMIT. The token then
 * still looks unused, but `apply` refuses a user who already has a password, so it cannot be used to change it.
 * Every "not usable" case is the same `invalid`, so the endpoint is not an oracle for which tokens exist.
 */
export async function redeemSetupToken(
  raw: string,
  apply: (user: { id: string; tenantId: string; email: string }, grantorRoles: string[]) => Promise<{ ok: true } | { ok: false; reason: string }>,
  correlationId: string,
): Promise<RedeemOutcome> {
  const parsed = parseSetupToken(raw);
  if (!parsed) return { status: "invalid" };
  const { tenantId, hash } = parsed;
  try {
    return await runWithTenant(tenantId, () => db.transaction(async (tx): Promise<RedeemOutcome> => {
      const rows = await tx.select().from(passwordSetupTokens)
        .where(and(eq(passwordSetupTokens.tenantId, tenantId), eq(passwordSetupTokens.tokenHash, hash),
          isNull(passwordSetupTokens.consumedAt), isNull(passwordSetupTokens.revokedAt), gt(passwordSetupTokens.expiresAt, new Date())))
        .for("update").limit(1);
      const t = rows[0];
      if (!t) return { status: "invalid" };
      const u = (await tx.select().from(users).where(and(eq(users.id, t.userId), eq(users.tenantId, tenantId))).limit(1))[0];
      if (!u || u.status !== "active") return { status: "invalid" };
      await tx.update(passwordSetupTokens).set({ consumedAt: new Date() }).where(eq(passwordSetupTokens.id, t.id));
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: "audit.event.record", eventType: "audit.event.record", tenantId, actorId: u.id, correlationId,
        payload: { service: "identity", action: "password_setup_complete", resourceType: "user", resourceId: u.id, outcome: "success", severity: "medium", tokenId: t.id },
      });
      const r = await apply({ id: u.id, tenantId, email: u.email }, t.grantorRoles);
      if (!r.ok) throw new RollbackWith({ status: "rejected", reason: r.reason });
      return { status: "applied" };
    }));
  } catch (err) {
    if (err instanceof RollbackWith) return err.outcome;
    throw err;
  }
}

/** Revoke every live token of a user (used when the user is deactivated or a new link supersedes). */
export async function revokeSetupTokens(tenantId: string, userId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.update(passwordSetupTokens).set({ revokedAt: new Date() }).where(and(
      eq(passwordSetupTokens.tenantId, tenantId), eq(passwordSetupTokens.userId, userId),
      isNull(passwordSetupTokens.consumedAt), isNull(passwordSetupTokens.revokedAt),
    ));
  }));
}

/** Lower-cased emails from `emails` that already exist in the tenant (one query for a whole bulk request). */
export async function existingEmails(tenantId: string, emails: readonly string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await scopedRead((tx) => tx.select({ email: users.email }).from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(sql`lower(${users.email})`, emails.map((e) => e.toLowerCase())))));
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

/** What the set-password link route needs about a user, tenant-scoped (a foreign id is simply absent). */
export async function loadForSetup(tenantId: string, userId: string): Promise<{ id: string; email: string; status: string; keycloakUserId: string | null } | null> {
  const rows = await scopedRead((tx) => tx.select({ id: users.id, email: users.email, status: users.status, keycloakUserId: users.keycloakUserId })
    .from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}
