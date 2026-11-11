/**
 * Usable-logins routes: bulk onboarding, tenant-grantable role changes, the first-password (set-password)
 * flow and the per-tenant switch. Reached through the gateway as /api/v1/admin/users/* (bulk, roles,
 * password-setup-link[s]) and /api/identity/* (the public redeem route and the settings).
 *
 * Nothing here ever returns, stores or logs a password. The only secret a response carries is a single-use
 * set-password TOKEN, shown once to the admin who asked for it (Cache-Control: no-store).
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as keycloak from "../../shared/keycloak.js";
import { randomUUID } from "node:crypto";
import { assertNotPlatformOperator } from "../operators/commands.js";
import * as commands from "./commands.js";
import * as onboardingRepo from "./onboarding-repo.js";
import { ADMIN_TIER_ROLES, DEFAULT_ROLE, STAFF_ROLES, checkGrant, checkCanActFor, USER_ADMIN_ROLES } from "./grantable-roles.js";
import { bulkCreateBody, setRolesBody, onboardingSettingsBody, setupLinksBody, redeemBody, userIdParam } from "./validators.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];
const PLATFORM = ["platform_admin", "super_admin"];
export const SETUP_LINK_MAX_PER_HOUR = 5;
const SETUP_LINK_WINDOW_SECONDS = 3600;

type LinkResult =
  | { userId: string; status: "issued"; token: string; url?: string; expiresAt: string }
  | { userId: string; status: "error"; code: string; message: string };

/** Where the user opens the link. The token rides in the URL FRAGMENT so it never reaches a server or access log on the way. */
function setupUrl(token: string): string | undefined {
  const base = process.env.IDENTITY_SET_PASSWORD_BASE_URL ?? process.env.APP_BASE_URL;
  return base ? `${base.replace(/\/+$/, "")}/auth/set-password#token=${token}` : undefined;
}

async function issueLink(ctx: ReturnType<typeof resolveContext>, userId: string): Promise<LinkResult> {
  const u = await onboardingRepo.loadForSetup(ctx.tenantId, userId); // tenant-scoped: another tenant's id is "not found"
  if (!u) return { userId, status: "error", code: "NOT_FOUND", message: "user not found" };
  if (u.status !== "active") return { userId, status: "error", code: "USER_NOT_ACTIVE", message: "only an active user can be given a set-password link" };
  // Nobody issues a link for themselves (their own account can use the normal reset).
  const me = ctx.actorId.toLowerCase();
  if (userId.toLowerCase() === me || u.keycloakUserId?.toLowerCase() === me) return { userId, status: "error", code: "SELF_LINK", message: "you cannot issue a set-password link for your own account" };
  if (!u.keycloakUserId) return { userId, status: "error", code: "KEYCLOAK_NOT_LINKED", message: "the user is not linked to a login yet; run keycloak-reconcile first" };
  // A link is a FIRST-password tool. Whoever holds one could set that user's password, so it is never issued for
  // an account that already has one (a peer admin's or an operator's), nor for a platform operator at all.
  try { await assertNotPlatformOperator(ctx.tenantId, userId); }
  catch (err) { if (err instanceof HttpError) return { userId, status: "error", code: err.code, message: err.message }; throw err; }
  // Holding a link = being able to sign in as that user. So the caller must be allowed to grant EVERY role the target
  // holds (same tiers as the role-change route): a tenant admin, an operator, or an admin-tier holder the caller is not
  // themselves, can never be reached this way. Fails closed when Keycloak cannot say what the target holds.
  const held = await keycloak.getRealmRoleNames({ tenantId: ctx.tenantId, email: u.email }, { effective: true });
  if (!held.ok || !held.roles) return { userId, status: "error", code: "KEYCLOAK_UNAVAILABLE", message: "could not check the user's roles right now; try again shortly" };
  const can = checkCanActFor(ctx.roles, held.roles);
  if (!can.ok) return { userId, status: "error", code: "ROLE_NOT_PERMITTED", message: `you cannot issue a link for this user: they hold ${can.refused.map((r) => r.role).join(", ")}, which you may not grant` };
  const pw = await keycloak.userHasPassword({ tenantId: ctx.tenantId, email: u.email });
  if (!pw.ok) return { userId, status: "error", code: "KEYCLOAK_UNAVAILABLE", message: "could not check the user's login right now; try again shortly" };
  if (pw.hasPassword) return { userId, status: "error", code: "PASSWORD_ALREADY_SET", message: "this user already has a password; use Reset password, which emails them, instead" };
  const attempts = await cache.incr(cache.makeKey(ctx.tenantId, "pwsetup_rate", userId), SETUP_LINK_WINDOW_SECONDS);
  if (attempts > SETUP_LINK_MAX_PER_HOUR) return { userId, status: "error", code: "LINK_RECENTLY_ISSUED", message: "too many links requested for this user; try again later" };
  const t = await onboardingRepo.issueSetupToken(ctx.tenantId, userId, ctx.actorId, ctx.roles, ctx.correlationId);
  const url = setupUrl(t.token);
  return { userId, status: "issued", token: t.token, ...(url ? { url } : {}), expiresAt: t.expiresAt.toISOString() };
}

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  // ── bulk onboarding ────────────────────────────────────────────────────────────────────────
  app.post("/identity/users/bulk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = bulkCreateBody.parse(req.body);
    return reply.code(202).send(await commands.bulkCreateUsers(ctx, body));
  });

  // ── role change (audited, same rules as create) ────────────────────────────────────────────
  app.put("/identity/users/:id/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    const body = setRolesBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setUserRoles(ctx, id, body));
  });

  /** What THIS caller may grant (the UI's role picker). */
  app.get("/identity/users/grantable-roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const all = [...STAFF_ROLES.map((r) => ({ role: r, tier: "staff" as const })), ...ADMIN_TIER_ROLES.map((r) => ({ role: r, tier: "admin" as const }))];
    return reply.send({ defaultRole: DEFAULT_ROLE, roles: all.map((r) => ({ ...r, grantable: checkGrant(ctx.roles, [r.role]).ok })) });
  });

  /** A user's current tenant-grantable realm roles, read from the login provider. */
  app.get("/identity/users/:id/realm-roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    const u = await onboardingRepo.loadForSetup(ctx.tenantId, id);
    if (!u) throw new HttpError(404, "NOT_FOUND", "user not found");
    const r = await keycloak.getRealmRoleNames({ tenantId: ctx.tenantId, email: u.email });
    if (r.skipped) return reply.send({ userId: id, roles: [], source: "unavailable" });
    if (!r.ok) throw new HttpError(502, "KEYCLOAK_UNAVAILABLE", "could not read the user's roles");
    const { isTenantGrantable } = await import("./grantable-roles.js");
    return reply.send({ userId: id, roles: (r.roles ?? []).filter(isTenantGrantable), source: "keycloak" });
  });

  // ── first password: admin-issued single-use link (no-mail path) ────────────────────────────
  app.post("/identity/users/:id/password-setup-link", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    if (!keycloak.isKeycloakEnabled()) throw new HttpError(503, "KEYCLOAK_NOT_CONFIGURED", "the login provider is not configured, so no password can be set");
    const r = await issueLink(ctx, id);
    if (r.status === "error") {
      const status = r.code === "NOT_FOUND" ? 404 : r.code === "LINK_RECENTLY_ISSUED" ? 429 : r.code === "KEYCLOAK_UNAVAILABLE" ? 503 : r.code === "ROLE_NOT_PERMITTED" ? 403 : 409;
      throw new HttpError(status, r.code, r.message);
    }
    return reply.header("Cache-Control", "no-store").code(201).send(r);
  });

  app.post("/identity/users/password-setup-links", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { userIds } = setupLinksBody.parse(req.body);
    if (!keycloak.isKeycloakEnabled()) throw new HttpError(503, "KEYCLOAK_NOT_CONFIGURED", "the login provider is not configured, so no password can be set");
    const results: LinkResult[] = [];
    for (const id of [...new Set(userIds)]) results.push(await issueLink(ctx, id));
    return reply.header("Cache-Control", "no-store").code(200).send({
      issued: results.filter((r) => r.status === "issued").length,
      failed: results.filter((r) => r.status === "error").length,
      results,
    });
  });

  // ── PUBLIC: the user redeems their token and chooses a password ────────────────────────────
  // config.public skips bearer auth (the token IS the credential). The password goes straight into Keycloak's
  // reset-password call and nowhere else: it is not stored, logged, audited or echoed. Every unusable token
  // (unknown, used, expired, revoked, user inactive) answers the same 400, so this is not an oracle.
  app.post("/identity/password-setup/redeem", { config: { public: true, rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { token, password } = redeemBody.parse(req.body);
    // Extra ceilings on top of the per-IP limit (the gateway sees the real client IP; here req.ip may be the gateway's):
    // per token, per tenant, and one global ceiling, so one noisy client cannot starve everyone else's first login and
    // one token cannot be hammered from many addresses.
    const parsed = onboardingRepo.parseSetupToken(token);
    const buckets: Array<[string, number, number]> = [[cache.makeKey("global", "pwsetup_redeem", "all"), 600, 60]];
    if (parsed) {
      buckets.push([cache.makeKey(parsed.tenantId, "pwsetup_redeem_tenant", "all"), 120, 60]);
      buckets.push([cache.makeKey(parsed.tenantId, "pwsetup_redeem_token", parsed.hash.slice(0, 32)), 10, 900]);
    }
    for (const [key, max, window] of buckets) {
      if ((await cache.incr(key, window)) > max) throw new HttpError(429, "TOO_MANY_ATTEMPTS", "too many attempts; wait a few minutes and try again");
    }
    const hdr = req.headers["x-correlation-id"];
    // The audit column is varchar(64): accept only a short, plain id and mint our own otherwise.
    const correlationId = typeof hdr === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(hdr) ? hdr : randomUUID();
    const outcome = await onboardingRepo.redeemSetupToken(token, async (u, issuer, grantorRoles) => {
      // Re-check at redeem time: the target may have been promoted (or the link issued for someone it should not have
      // been) since issue. Same rule as issue, using the roles the issuing admin held then.
      const held = await keycloak.getRealmRoleNames({ tenantId: u.tenantId, email: u.email }, { effective: true });
      if (!held.ok || !held.roles) return { ok: false as const, reason: "unavailable" };
      if (!checkCanActFor(grantorRoles, held.roles).ok) return { ok: false as const, reason: "invalid" };
      // ...and against the issuing admin's CURRENT standing, not just the snapshot: a link does not outlive the issuer
      // being disabled, demoted, or otherwise no longer able to grant the target's roles. Any lookup failure is a refusal.
      if (!issuer || issuer.status !== "active") return { ok: false as const, reason: "invalid" };
      const now = await keycloak.getRealmRoleNames({ tenantId: u.tenantId, email: issuer.email }, { effective: true });
      if (!now.ok || !now.roles) return { ok: false as const, reason: "invalid" };
      // identity may still say active while the login itself is disabled: that issuer has no standing either.
      if (now.enabled !== true) return { ok: false as const, reason: "invalid" };
      if (!now.roles.some((r) => (USER_ADMIN_ROLES as readonly string[]).includes(r))) return { ok: false as const, reason: "invalid" };
      if (!checkCanActFor(now.roles, held.roles).ok) return { ok: false as const, reason: "invalid" };
      const r = await keycloak.setUserPassword({ tenantId: u.tenantId, email: u.email }, password);
      if (r.ok) return { ok: true as const };
      return { ok: false as const, reason: r.policyRejected ? "password_policy" : r.reason === "password_already_set" ? "invalid" : "unavailable" };
    }, correlationId);
    reply.header("Cache-Control", "no-store");
    if (outcome.status === "applied") return reply.send({ status: "password_set" });
    if (outcome.status === "rejected" && outcome.reason === "password_policy") {
      throw new HttpError(422, "PASSWORD_POLICY", "that password does not meet the password policy: at least 12 characters with upper and lower case, a digit and a special character, and not one you used recently");
    }
    if (outcome.status === "rejected" && outcome.reason !== "invalid") throw new HttpError(503, "TEMPORARILY_UNAVAILABLE", "could not set the password right now; try again shortly");
    throw new HttpError(400, "INVALID_OR_EXPIRED_TOKEN", "this link is invalid or has expired; ask your administrator for a new one");
  });

  // ── per-tenant switch ──────────────────────────────────────────────────────────────────────
  app.get("/identity/onboarding-settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    return reply.send(await onboardingRepo.getSettings(ctx.tenantId));
  });

  // Switching it on widens what user create does for a tenant, so only platform operators may flip it.
  app.put("/identity/onboarding-settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM);
    const body = onboardingSettingsBody.parse(req.body);
    return reply.send(await onboardingRepo.putSettings(body.tenantId ?? ctx.tenantId, ctx.actorId, body, ctx.correlationId));
  });
}
