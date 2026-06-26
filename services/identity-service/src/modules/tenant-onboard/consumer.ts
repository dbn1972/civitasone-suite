/**
 * identity-service: tenant onboarding consumer.
 *
 * Listens for tenant.tenant.onboarded and provisions the first-admin user:
 *   1. Writes the user row to identity.users (via the identity.user.create
 *      command routed through the existing consumer, so all normal flows —
 *      cache prime, audit, Keycloak federation — apply).
 *   2. Assigns the tenant_admin role to that user (via identity.rbac.role.assign).
 *
 * The user creation itself is published as identity.user.create so it goes
 * through the normal CQRS path — the existing registerUserConsumers handles
 * the DB write and Keycloak federation. This consumer only needs to publish
 * the two commands; it does not write DB directly.
 *
 * Idempotent: markProcessed on the inbound message prevents duplicate user
 * creation. The downstream identity.user.create consumer also runs
 * markProcessed on its own message so even if this consumer fires twice, the
 * second identity.user.create is a no-op.
 */
import { randomUUID } from "node:crypto";
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

export function registerIdentityTenantOnboardConsumers(queue: Queue): void {
  queue.subscribe<{
    tenantId: string;
    adminEmail: string;
    adminName: string;
    edition: string;
  }>(TENANT_ONBOARDED, async (msg) => {
    const p = msg.payload;

    // Derive stable IDs so relay redeliveries produce the same message ids and
    // the downstream createUser + rbacAssignRole consumers dedup them.
    // We XOR the tenant UUID bytes with a domain-specific constant so the user
    // id and tenant id are always distinct even for a one-tenant deployment.
    // Using randomUUID() here would produce different ids on each redelivery,
    // defeating markProcessed in the downstream consumer.
    //
    // Stable derivation: sha256(tenantId + ":first_admin")[:16 bytes] → UUID v4
    // We do this with Node crypto without adding dependencies.
    const { createHash } = await import("node:crypto");
    const userIdHex  = createHash("sha256").update(`${p.tenantId}:first_admin_user`).digest("hex").slice(0, 32);
    const roleAssignHex = createHash("sha256").update(`${p.tenantId}:first_admin_role_assign`).digest("hex").slice(0, 32);
    const formatUuid = (hex: string): string =>
      `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${((parseInt(hex.charAt(16),16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`;

    const adminUserId      = formatUuid(userIdHex);
    const roleAssignMsgId  = formatUuid(roleAssignHex);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent guard

      // ── Publish identity.user.create for the first admin ──────────────────
      // The existing registerUserConsumers handles this command, including
      // DB insert, cache prime, audit, and Keycloak federation.
      await enqueue(tx, {
        topic:         IDENTITY_COMMANDS.createUser,
        eventType:     IDENTITY_COMMANDS.createUser,
        tenantId:      p.tenantId,
        actorId:       SYSTEM_ACTOR,
        correlationId: msg.correlationId,
        payload: {
          // messageId is embedded in the outbox row id (stable via formatUuid)
          // and forwarded by the relay, so the createUser consumer deduplicates.
          id:         adminUserId,
          tenantId:   p.tenantId,
          email:      p.adminEmail,
          name:       p.adminName,
          empCode:    null,
          status:     "active",
          mfaEnabled: false,
          version:    1,
          createdBy:  SYSTEM_ACTOR,
        },
      });

      // ── Publish rbac.role.assign to grant tenant_admin role ───────────────
      await enqueue(tx, {
        topic:         IDENTITY_COMMANDS.rbacAssignRole,
        eventType:     IDENTITY_COMMANDS.rbacAssignRole,
        tenantId:      p.tenantId,
        actorId:       SYSTEM_ACTOR,
        correlationId: msg.correlationId,
        payload: {
          id:         roleAssignMsgId,
          userId:     adminUserId,
          tenantId:   p.tenantId,
          roleName:   "tenant_admin",
          grantedBy:  SYSTEM_ACTOR,
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
          service:      "identity",
          action:       "provision_first_admin",
          resourceType: "user",
          resourceId:   adminUserId,
          outcome:      "accepted",
          adminEmail:   p.adminEmail,
        },
      });
    });
  });
}
