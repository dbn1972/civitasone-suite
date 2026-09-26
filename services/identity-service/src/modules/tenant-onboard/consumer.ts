/**
 * identity-service: tenant onboarding consumer.
 *
 * Listens for tenant.tenant.onboarded and provisions the first-admin user:
 *   1. Writes the user row to identity.users AND federates them into Keycloak
 *      with a working set of realm roles (via the identity.user.create
 *      command routed through the existing consumer, so all normal flows —
 *      cache prime, audit, Keycloak federation, role mapping — apply).
 *
 * The user creation itself is published as identity.user.create so it goes
 * through the normal CQRS path — the existing registerUserConsumers handles
 * the DB write, Keycloak federation, AND (via the initialRealmRoles field
 * below) the Keycloak realm-role mapping. This consumer only needs to publish
 * that one command; it does not write DB directly and does not talk to
 * Keycloak itself.
 *
 * BUG FIX (bootstrap admin locked out of every module): this used to ALSO
 * publish identity.rbac.role.assign with `roleName: "tenant_admin"`, on the
 * assumption that granted the new admin the "tenant_admin" Keycloak realm
 * role. It didn't — two independent problems:
 *   1. That command's consumer (modules/rbac/consumer.ts) expects a payload
 *      shaped `{ roleId, userId, ... }` (it assigns a row in identity-service's
 *      OWN tenant-scoped custom-permission tables, resolved by id). This
 *      publish sent `roleName` instead of `roleId`, so `p.roleId` was always
 *      undefined, `repo.lockRole()` always found nothing, and the handler
 *      always took its "role no longer exists" rejection branch — a silent
 *      no-op (well, not quite silent: it emitted a `severity: "high"`
 *      rejection audit event on every single tenant onboarding).
 *   2. Even with the payload shape fixed, that subsystem is unrelated to
 *      Keycloak: nothing in it, or anywhere else in the codebase, ever calls
 *      Keycloak's role-mappings API. provisionUser() (shared/keycloak.ts)
 *      only ever created the bare realm user — no role mapping. So the new
 *      admin's Keycloak user ended up with ZERO realm roles beyond
 *      Keycloak's own built-in `default-roles-<realm>` composite, and every
 *      `requireRole()` check in every service (finance, payroll, HRMS,
 *      procurement, and the "tenant_admin"-gated admin-service screens too)
 *      403'd for them. Confirmed live against this realm: the two users
 *      already provisioned via this path (tenant-namespaced usernames, never
 *      role-mapped by anything) carry only `default-roles-civitasone`.
 *
 * The fix: thread the intended role set through to shared/keycloak.ts's new
 * assignRealmRoles(), called from the createUser consumer right after it
 * federates the user (see modules/users/consumer.ts) — the one place that
 * actually talks to Keycloak. See BOOTSTRAP_ADMIN_REALM_ROLES below for how
 * the set was chosen.
 *
 * Idempotent: markProcessed on the inbound message prevents duplicate user
 * creation. The downstream identity.user.create consumer also runs
 * markProcessed on its own message so even if this consumer fires twice, the
 * second identity.user.create is a no-op.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS as IDENTITY_COMMANDS } from "../../topics.js";

const AUDIT_TOPIC       = "audit.event.record";
const TENANT_ONBOARDED  = "tenant.tenant.onboarded";

// A well-known sentinel actorId for system-originated provisioning actions.
// This is a deterministic UUID (v5-like, but we use a fixed constant to avoid
// pulling in a uuid/v5 dependency). It appears in audit trails as "system".
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000001";

/**
 * Realm roles granted to a brand-new tenant's bootstrap admin.
 *
 * Chosen from the LIVE civitasone Keycloak realm's role catalog (verified via
 * its admin API — 39 realm roles today, well ahead of the 7 in the checked-in
 * infra/keycloak/civitasone-realm.json; that IaC drift is tracked/fixed
 * separately), not invented:
 *
 *   - "tenant_admin"     — the tenant-scoped admin marker itself; gates
 *                          admin-service's own tenant-config screens
 *                          (TENANT_ADMIN_ROLES) and is the intended identity
 *                          of this account.
 *   - "finance_admin"    — unlocks finance-service's FINANCE_ROLES gates.
 *   - "hr_admin"         — unlocks hrms-service's HR_ROLES gates.
 *   - "payroll_admin"    — unlocks payroll-service's PAYROLL_ROLES gates.
 *   - "procurement_admin"— unlocks procurement-service's PROC_ROLES/
 *                          PROCUREMENT_ROLES gates.
 *
 * All five are already proven-working in the live realm — real accounts
 * (e.g. `financeadmin`, `test-payroll-admin`, `admin@civitasone.dev`) already
 * carry this exact style of fine-grained-role bundle and pass these route
 * guards today.
 *
 * Deliberately EXCLUDED: "super_admin" / "platform_admin". Both are
 * platform-wide, not tenant-scoped — admin-service's scopedPlatformRead()
 * documents super_admin performing genuinely cross-tenant reads ("list every
 * tenant", platform-wide break-glass), and several routes gate the most
 * sensitive platform-wide operations on `["platform_admin", "super_admin"]`
 * as equals. Auto-granting either to every new tenant's own admin would let
 * that tenant's admin act across every OTHER tenant — a security regression,
 * not a fix, and exactly what this constant must avoid.
 *
 * Known gap (NOT fixed here): grant-service, inventory-service, and
 * project-service gate their routes on role names (grant_admin,
 * inventory_admin, project_admin, etc.) that do not exist ANYWHERE in the
 * live 39-role catalog yet — not even the 34 hand-configured working accounts
 * hold them. There is currently no realm role this constant (or anything
 * else) could grant that would unlock those three services for a tenant
 * admin; that is a separate, pre-existing catalog gap for those modules,
 * tracked alongside the broader realm.json IaC-drift work, not introduced or
 * silently worked around by this fix.
 */
const BOOTSTRAP_ADMIN_REALM_ROLES = [
  "tenant_admin",
  "finance_admin",
  "hr_admin",
  "payroll_admin",
  "procurement_admin",
] as const;

export function registerIdentityTenantOnboardConsumers(queue: Queue): void {
  queue.subscribe<{
    tenantId: string;
    adminEmail: string;
    adminName: string;
    edition: string;
  }>(TENANT_ONBOARDED, async (msg) => {
    const p = msg.payload;

    // Derive a stable ID so relay redeliveries produce the same message id and
    // the downstream createUser consumer dedups it.
    // We XOR the tenant UUID bytes with a domain-specific constant so the user
    // id and tenant id are always distinct even for a one-tenant deployment.
    // Using randomUUID() here would produce different ids on each redelivery,
    // defeating markProcessed in the downstream consumer.
    //
    // Stable derivation: sha256(tenantId + ":first_admin")[:16 bytes] → UUID v4
    // We do this with Node crypto without adding dependencies.
    const { createHash } = await import("node:crypto");
    const userIdHex  = createHash("sha256").update(`${p.tenantId}:first_admin_user`).digest("hex").slice(0, 32);
    const formatUuid = (hex: string): string =>
      `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${((parseInt(hex.charAt(16),16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`;

    const adminUserId = formatUuid(userIdHex);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent guard

      // ── Publish identity.user.create for the first admin ──────────────────
      // The existing registerUserConsumers handles this command, including DB
      // insert, cache prime, audit, Keycloak federation, and — via
      // initialRealmRoles — mapping the bootstrap admin's realm roles onto the
      // federated Keycloak user. That last step is what actually gives this
      // account working access; see BOOTSTRAP_ADMIN_REALM_ROLES above.
      await enqueue(tx, {
        topic:         IDENTITY_COMMANDS.createUser,
        eventType:     IDENTITY_COMMANDS.createUser,
        tenantId:      p.tenantId,
        actorId:       SYSTEM_ACTOR,
        correlationId: msg.correlationId,
        payload: {
          // messageId is embedded in the outbox row id (stable via formatUuid)
          // and forwarded by the relay, so the createUser consumer deduplicates.
          id:                 adminUserId,
          tenantId:           p.tenantId,
          email:              p.adminEmail,
          name:               p.adminName,
          empCode:            null,
          status:             "active",
          mfaEnabled:         false,
          version:            1,
          createdBy:          SYSTEM_ACTOR,
          initialRealmRoles:  [...BOOTSTRAP_ADMIN_REALM_ROLES],
        },
      });

      // ── Audit: onboarding provisioned the first admin ─────────────────────
      await enqueue(tx, {
        topic:         AUDIT_TOPIC,
        eventType:     AUDIT_TOPIC,
        tenantId:      p.tenantId,
        actorId:       SYSTEM_ACTOR,
        correlationId: msg.correlationId,
        payload: {
          service:           "identity",
          action:            "provision_first_admin",
          resourceType:      "user",
          resourceId:        adminUserId,
          outcome:           "accepted",
          adminEmail:        p.adminEmail,
          initialRealmRoles: [...BOOTSTRAP_ADMIN_REALM_ROLES],
        },
      });
    });
  });
}
