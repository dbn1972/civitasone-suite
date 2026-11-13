import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import * as userRepo from "./repo.js";
import { strandsTenantAdmins } from "./last-admin.js";
import * as operatorsRepo from "../operators/repo.js";
import { assertTransition, type UserView } from "./domain.js";
import * as keycloak from "../../shared/keycloak.js";
import { recordPendingDeactivation, deprovisionInKeycloak } from "../../shared/kc-reconcile.js";
import { pino } from "pino";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { persistKeycloakUserId } from "./keycloak-link.js";
import * as onboardingRepo from "./onboarding-repo.js";
import { USER_ADMIN_ROLES, checkGrant, isTenantGrantable, normaliseRoles } from "./grantable-roles.js";
import { runWithTenant } from "@civitasone/db";

const kcLog = pino({ name: "identity-keycloak" });

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE.user, id);
}

export function registerUserConsumers(rawQueue: Queue): void {
  // Every handler must run inside the message's tenant context so RLS applies
  // (see shared/tenant-queue.ts). Subscriptions below use `queue`, never
  // `rawQueue` — subscribing on the raw queue bypasses tenant scoping.
  const queue = tenantScoped(rawQueue);

  queue.subscribe<UserView & { createdBy: string; initialRealmRoles?: string[]; requestedRoles?: string[] }>(COMMANDS.createUser, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, email: p.email, name: p.name,
        empCode: p.empCode ?? null, status: "active", mfaEnabled: false,
        createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await emitAudit(tx, msg, EVENTS.userCreated, { userId: p.id }, "create", p.id);
    });
    await cache.put(keyFor(msg.payload.tenantId, msg.payload.id), msg.payload);
    // Keycloak federation (best-effort, feature-flagged, never blocks user create).
    // Optional initialRealmRoles (e.g. the tenant-onboard flow's bootstrap-admin
    // role set) are mapped onto the user AFTER provisioning resolves — sequenced
    // within this same chain (not a separate queued command) so role assignment
    // never races the realm user's own creation. Skipped/degraded the same
    // best-effort way as provisioning itself: a Keycloak hiccup here must not
    // fail user creation, and is left for the operator to see in logs/captured
    // errors rather than blocking anything.
    const initialRoles = msg.payload.initialRealmRoles;
    // Usable-logins tenants (migration 0034 switch, read here from the DB, never from the message) take the
    // full path: attributes, Keycloak link, roles, first-password step. Everyone else keeps the original chain.
    const settings = await onboardingRepo.getSettings(msg.payload.tenantId).catch(() => onboardingRepo.DEFAULT_SETTINGS);
    if (settings.usableLogins) {
      void completeUsableLogin(msg, settings).catch((err: unknown) => kcLog.warn({ userId: msg.payload.id, err: String(err) }, "usable-login completion failed"));
      return;
    }
    void keycloak.provisionUser(
      { id: msg.payload.id, tenantId: msg.payload.tenantId, email: msg.payload.email, name: msg.payload.name },
      kcLog,
    ).then(async (r) => {
      if (!r.skipped) kcLog.info({ userId: msg.payload.id, result: r }, "keycloak provision");
      // FQ14: remember the realm user's id (= the login's JWT sub) so internal
      // lookups keyed by a sub resolve this user. Best-effort like the rest of
      // this chain; the keycloak-reconcile route / backfill repair a miss.
      if (r.ok && r.kcUserId && r.tenantVerified) {
        await persistKeycloakUserId(msg.payload.tenantId, msg.payload.id, r.kcUserId)
          .then((outcome) => { if (outcome === "conflict") kcLog.warn({ userId: msg.payload.id, kcUserId: r.kcUserId }, "keycloak user id already mapped differently"); })
          .catch((err: unknown) => kcLog.warn({ userId: msg.payload.id, err: String(err) }, "persisting keycloak user id failed"));
      }
      if (r.ok && !r.skipped && initialRoles && initialRoles.length > 0) {
        const rr = await keycloak.assignRealmRoles(
          { tenantId: msg.payload.tenantId, email: msg.payload.email },
          initialRoles,
          kcLog,
        );
        if (!rr.skipped) kcLog.info({ userId: msg.payload.id, result: rr }, "keycloak initial role assignment");
      }
    });
  });

  queue.subscribe<{ id: string; name?: string; empCode?: string }>(COMMANDS.updateUser, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.tenantId, msg.payload.id);
      if (!cur) throw new Error(`user ${msg.payload.id} not found`);
      const patch: Record<string, unknown> = { updatedBy: msg.actorId, version: cur.version + 1 };
      if (msg.payload.name !== undefined) patch.name = msg.payload.name;
      if (msg.payload.empCode !== undefined) patch.empCode = msg.payload.empCode;
      await repo.update(tx, msg.tenantId, msg.payload.id, patch);
      await emitAudit(tx, msg, EVENTS.userUpdated, { userId: msg.payload.id }, "update", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
  });

  queue.subscribe<{ id: string; status: string; reason?: string }>(COMMANDS.deactivateUser, async (msg) => {
    let deactivatedEmail: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.tenantId, msg.payload.id);
      if (!cur) throw new Error(`user ${msg.payload.id} not found`);
      // GAP-ADMIN-OPERATORS-05: the route refuses this for a platform operator; refuse again at apply time so a
      // command that reached the queue another way cannot change an operator without the approval flow.
      if (await operatorsRepo.loadOperator(tx as never, msg.tenantId, msg.payload.id)) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "identity", action: "status_change_refused", resourceType: "user", resourceId: msg.payload.id, outcome: "denied", severity: "high", code: "OPERATOR_REQUIRES_APPROVAL", status: msg.payload.status },
        });
        return;
      }
      assertTransition(cur.status, msg.payload.status as UserView["status"]);
      // GAP-ADMIN-USERS-01 (race-safe half): serialise the tenant's admin status changes, then
      // re-check against current state. If this change would strand the tenant it is NOT applied.
      if (msg.payload.status !== "active" && cur.status === "active") {
        await repo.lockTenantAdmins(tx, msg.tenantId);
        if (await strandsTenantAdmins(tx as never, msg.tenantId, msg.payload.id)) {
          await enqueue(tx as Parameters<typeof enqueue>[0], {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: { service: "identity", action: "status_change", resourceType: "user", resourceId: msg.payload.id, outcome: "denied", reason: "LAST_TENANT_ADMIN", severity: "high" },
          });
          return;
        }
      }
      await repo.update(tx, msg.tenantId, msg.payload.id, {
        status: msg.payload.status, updatedBy: msg.actorId, version: cur.version + 1,
      });
      await emitAudit(tx, msg, EVENTS.userDeactivated, { userId: msg.payload.id, status: msg.payload.status }, "status_change", msg.payload.id);
      if (msg.payload.status === "deactivated" && keycloak.isKeycloakEnabled()) {
        deactivatedEmail = cur.email;
        // SEC H2: durably record a PENDING Keycloak deactivation in the SAME
        // transaction as the DB deactivation. "DB deactivated ⇒ a reconciliation
        // obligation exists." If the post-commit best-effort KC call succeeds we
        // mark it reconciled; if it fails (or we crash), the worker reconciler
        // retries it — the user is never left enabled in Keycloak silently.
        await recordPendingDeactivation(tx as { insert: typeof db.insert }, {
          tenantId: msg.tenantId, userId: msg.payload.id, email: cur.email,
          correlationId: msg.correlationId, lastError: "pending initial keycloak deactivate",
        });
      }
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
    // Keycloak deprovision (disable + logout sessions). Best-effort, never blocks
    // the DB write — but failure is NOT silently dropped: the pending row above
    // keeps it on the reconciler's retry queue until it succeeds.
    if (deactivatedEmail) {
      await deprovisionInKeycloak(msg.tenantId, msg.payload.id, deactivatedEmail, kcLog);
    }
  });

  // Change a user's tenant-grantable realm roles (usable-logins). Audited twice: the request inside the command's
  // transaction, the Keycloak outcome after it. The worker RE-CHECKS the grant rules against the user's real
  // current roles (the HTTP layer cannot see them): a role the grantor may not grant must not be added, and a
  // role they may not grant must not be removed.
  queue.subscribe<{ id: string; roles: string[]; reason: string }>(COMMANDS.setUserRoles, async (msg) => {
    let email: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.tenantId, msg.payload.id);
      if (!cur) throw new Error(`user ${msg.payload.id} not found`);
      if (await operatorsRepo.loadOperator(tx as never, msg.tenantId, msg.payload.id)) return;
      email = cur.email;
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "identity", action: "roles_change_requested", resourceType: "user", resourceId: msg.payload.id, outcome: "success", severity: "high", desiredRoles: msg.payload.roles, reason: msg.payload.reason },
      });
    });
    if (!email || !keycloak.isKeycloakEnabled()) return;
    const audit = (extra: Record<string, unknown>) => auditOutcome(msg.tenantId, msg.actorId, msg.correlationId, { action: "roles_changed", resourceId: msg.payload.id, ...extra });
    const desired = normaliseRoles(msg.payload.roles);
    const current = await keycloak.getRealmRoleNames({ tenantId: msg.tenantId, email });
    if (!current.ok || !current.roles) {
      await audit({ outcome: "failed", severity: "high", reason: `could not read current roles: ${current.reason ?? "unknown"}` });
      return;
    }
    // Only allow-listed roles are ever in play; everything else the user holds (tenant_admin, ...) is left alone.
    const held = current.roles.filter(isTenantGrantable);
    const toAdd = desired.filter((r) => !held.includes(r));
    const toRemove = held.filter((r) => !desired.includes(r));
    const grantor = await deriveGrantorRoles(msg.tenantId, msg.actorId);
    if (!grantor || !isUserAdmin(grantor)) {
      await audit({ outcome: "denied", severity: "high", refused: ["grantor_unverified"] });
      return;
    }
    const grantCheck = checkGrant(grantor, toAdd);
    const removeCheck = checkGrant(grantor, toRemove);
    if (!grantCheck.ok || !removeCheck.ok) {
      const refused = [...(grantCheck.ok ? [] : grantCheck.refused), ...(removeCheck.ok ? [] : removeCheck.refused)];
      await audit({ outcome: "denied", severity: "high", refused: refused.map((r) => `${r.role}:${r.code}`) });
      return;
    }
    if (toAdd.length === 0 && toRemove.length === 0) {
      await audit({ outcome: "success", severity: "low", added: [], removed: [], note: "no change" });
      return;
    }
    const r = await keycloak.replaceRealmRoles({ tenantId: msg.tenantId, email }, toRemove, toAdd, kcLog);
    await audit({ outcome: r.ok ? "success" : "failed", severity: r.ok ? "medium" : "high", added: toAdd, removed: toRemove, ...(r.reason ? { reason: r.reason } : {}) });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
  });

  // Reset password (P0 security). The durable record of the request is the audit
  // event emitted via the outbox inside this transaction. The actual credential
  // change is delegated to Keycloak (best-effort, post-commit): when Keycloak is
  // configured we set the UPDATE_PASSWORD required action; when it is not, the
  // request is still audited but no credential changes (honest dev behaviour).
  queue.subscribe<{ id: string; reason?: string | null }>(COMMANDS.resetCredential, async (msg) => {
    let userEmail: string | null = null;
    let kcEnabled = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.tenantId, msg.payload.id);
      if (!cur) throw new Error(`user ${msg.payload.id} not found`);
      userEmail = cur.email;
      kcEnabled = keycloak.isKeycloakEnabled();
      await emitAudit(
        tx, msg, EVENTS.passwordResetRequested,
        // GAP-TENANT-ADMIN-USERS-DETAIL-01: record the admin's reason in the
        // audit trail when supplied.
        { userId: msg.payload.id, keycloakEnabled: kcEnabled, reason: msg.payload.reason ?? null },
        "reset_password", msg.payload.id,
      );
    });
    if (userEmail && kcEnabled) {
      void keycloak.requestPasswordReset(msg.tenantId, userEmail, kcLog)
        .then((r) => { if (!r.skipped) kcLog.info({ userId: msg.payload.id, result: r }, "keycloak password reset"); })
        .catch((err) => kcLog.error({ userId: msg.payload.id, err: String(err) }, "keycloak password reset threw"));
    }
  });
}

/**
 * The grantor's roles, re-derived HERE from the stamped actor id (the JWT sub = Keycloak user id) through identity and
 * Keycloak, never taken from the message: a command that reached the queue another way cannot claim authority it does
 * not have. null = could not be established (fail closed).
 */
async function deriveGrantorRoles(tenantId: string, actorId: string): Promise<string[] | null> {
  try {
    const actor = await userRepo.findByIdOrKeycloakId(tenantId, actorId);
    if (!actor || actor.status !== "active") return null;
    const r = await keycloak.getRealmRoleNames({ tenantId, email: actor.email }, { effective: true });
    return r.ok && r.roles ? r.roles : null;
  } catch {
    return null;
  }
}
const isUserAdmin = (roles: readonly string[]): boolean => roles.some((r) => (USER_ADMIN_ROLES as readonly string[]).includes(r));

/** An audit record outside any command transaction (post-commit Keycloak outcomes). Never carries secrets. */
async function auditOutcome(tenantId: string, actorId: string, correlationId: string, payload: Record<string, unknown>): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId, actorId, correlationId,
      payload: { service: "identity", resourceType: "user", ...payload },
    });
  }));
}

/**
 * Make a newly created user able to sign in (usable-logins tenants only). Best-effort and ordered; every step's
 * outcome lands in ONE audit record so an operator can see what still needs a repair. Never handles a password:
 * the first-password step is a Keycloak email (mode email) or an admin-issued single-use link (mode link).
 */
async function completeUsableLogin(
  msg: CommandEnvelope & { payload: UserView & { initialRealmRoles?: string[]; requestedRoles?: string[] } },
  settings: onboardingRepo.OnboardingSettings,
): Promise<void> {
  const p = msg.payload;
  const out: Record<string, unknown> = {};
  const prov = await keycloak.provisionUser({ id: p.id, tenantId: p.tenantId, email: p.email, name: p.name }, kcLog);
  if (prov.skipped) return;
  out.provision = prov.ok ? "ok" : "failed";
  if (prov.ok) {
    const prof = await keycloak.applyLoginProfile({ id: p.id, tenantId: p.tenantId, email: p.email, name: p.name }, kcLog);
    out.attributes = prof.ok ? "set" : `failed: ${prof.reason ?? "unknown"}`;
    if (prof.emailConflict) out.email = "conflict: another realm user owns this email, sign-in by email will not work";
    const kcUserId = prof.kcUserId ?? prov.kcUserId;
    if (prof.ok && kcUserId) {
      out.link = await persistKeycloakUserId(p.tenantId, p.id, kcUserId).catch((err: unknown) => `failed: ${String(err)}`);
    } else {
      out.link = "not_linked: repair with POST /identity/users/:id/keycloak-reconcile";
    }

    // Roles. Re-validated against the allow-list and the grantor's own roles: the HTTP layer already did this,
    // but a command that reached the queue another way must not be able to grant more.
    const fromRequest = p.requestedRoles !== undefined;
    const wanted = fromRequest ? normaliseRoles(p.requestedRoles ?? []) : (p.initialRealmRoles?.length ? [] : ["employee"]);
    let grant: string[] = [];
    if (fromRequest) {
      const grantor = await deriveGrantorRoles(p.tenantId, msg.actorId);
      if (!grantor || !isUserAdmin(grantor)) {
        out.rolesDenied = ["grantor_unverified: the acting admin could not be confirmed as a user admin"];
      } else {
        const check = checkGrant(grantor, wanted);
        if (check.ok) grant = check.roles;
        else out.rolesDenied = check.refused.map((r) => `${r.role}:${r.code}`);
      }
    } else {
      // No roles requested (older producer / default): only the default staff role, which needs no grantor.
      const check = checkGrant([], wanted);
      if (check.ok) grant = check.roles;
    }
    const all = [...new Set([...grant, ...(p.initialRealmRoles ?? [])])];
    if (all.length > 0) {
      const rr = await keycloak.assignRealmRoles({ tenantId: p.tenantId, email: p.email }, all, kcLog);
      out.roles = rr.ok ? (rr.reason ?? "assigned") : `failed: ${rr.reason ?? "unknown"}`;
    } else {
      out.roles = "none";
    }

    // First password, without anyone handling one.
    if (settings.passwordMode === "email") {
      const mail = await keycloak.sendSetPasswordEmail({ tenantId: p.tenantId, email: p.email }, onboardingRepo.setupTtlSeconds(), kcLog);
      out.passwordSetup = mail.ok ? "email_sent" : `email_failed: ${mail.reason ?? "unknown"}; issue a set-password link instead`;
    } else if (settings.passwordMode === "link") {
      out.passwordSetup = "awaiting_link: admin issues it with POST /identity/users/:id/password-setup-link";
    } else {
      out.passwordSetup = "off";
    }
  }
  kcLog.info({ userId: p.id, outcome: out }, "usable login onboarding");
  await auditOutcome(p.tenantId, msg.actorId, msg.correlationId, {
    action: "onboarding_login_ready", resourceId: p.id, outcome: prov.ok ? "success" : "failed", severity: prov.ok ? "low" : "high", detail: out,
  });
}

async function emitAudit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "identity", action, resourceType: "user", resourceId, outcome: "success" },
  });
}
