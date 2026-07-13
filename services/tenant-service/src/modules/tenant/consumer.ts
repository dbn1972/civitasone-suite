/**
 * Consumer (the ONLY code that writes Postgres).
 * For each command: idempotency-check → apply write + enqueue domain & audit events in
 * the SAME transaction (outbox) → refresh/invalidate cache. The outbox relay publishes
 * the events after commit.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { assertTransition, type TenantView } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(id: string) { return cache.makeKey(id, RESOURCE, id); }

export function registerTenantConsumers(queue: Queue): void {
  queue.subscribe<TenantView>(COMMANDS.createTenant, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // already handled
      const p = msg.payload;
      // Tenant_Placement_Policy: fall back to pool/null if an older-shaped
      // payload (pre-adoption redelivery) doesn't carry these fields.
      const isolationTier = p.isolationTier ?? "pool";
      const policyVersion = p.policyVersion ?? null;
      const policyReason = p.policyReason ?? null;
      await repo.insert(tx, {
        id: p.id, tenantId: p.id, name: p.name, domain: p.domain, edition: p.edition,
        status: "draft", region: p.region, residency: p.residency,
        isolationTier, policyVersion, policyReason, settings: {},
        createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await emit(tx, msg, EVENTS.tenantCreated, { tenantId: p.id, plan: p.edition }, "create", p.id);

      // Audit the onboarding-time Tenant_Placement_Policy tier assignment,
      // including the fallback reason when applicable (Req 2.5, 2.6, 15.3).
      const t = tx as Parameters<typeof enqueue>[0];
      await enqueue(t, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "tenant", action: "placement_policy_assign", resourceType: "tenant",
          resourceId: p.id, outcome: "success", isolationTier, policyVersion, policyReason,
        },
      });

      // When the policy-derived tier is silo, publish the same Isolation_Changed_Event
      // used by the manual PATCH .../isolation path — exactly once, from this
      // transaction, so install-service's Provisioning_Actuator is triggered
      // through one consistent event path (Req 2.3). Not routed through the
      // generic `emit()` helper to avoid a second, redundant audit event for
      // the same tier assignment already audited above.
      if (isolationTier === "silo") {
        await enqueue(t, {
          topic: EVENTS.tenantIsolationChanged, eventType: EVENTS.tenantIsolationChanged,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { tenantId: p.id, tier: "silo" },
        });
      }
    });
    await cache.put(keyFor(msg.payload.id), msg.payload); // refresh
  });

  queue.subscribe<{ id: string; name?: string; settings?: Record<string, unknown> }>(
    COMMANDS.updateTenant,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const cur = await repo.findByIdTx(tx, msg.payload.id);
        if (!cur) throw new Error(`tenant ${msg.payload.id} not found`);
        const patch: Record<string, unknown> = { updatedBy: msg.actorId, version: cur.version + 1 };
        if (msg.payload.name !== undefined) patch.name = msg.payload.name;
        if (msg.payload.settings !== undefined) patch.settings = msg.payload.settings;
        await repo.update(tx, msg.payload.id, patch);
        await emit(tx, msg, EVENTS.tenantUpdated, { tenantId: msg.payload.id }, "update", msg.payload.id);
      });
      await cache.invalidate(keyFor(msg.payload.id));
    }
  );

  queue.subscribe<{ id: string; reason: string }>(COMMANDS.suspendTenant, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.payload.id);
      if (!cur) throw new Error(`tenant ${msg.payload.id} not found`);
      assertTransition(cur.status, "suspended"); // domain rule
      await repo.update(tx, msg.payload.id, { status: "suspended", updatedBy: msg.actorId, version: cur.version + 1 });
      await emit(tx, msg, EVENTS.tenantSuspended, { tenantId: msg.payload.id, reason: msg.payload.reason }, "suspend", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.payload.id));
  });

  /**
   * onboardTenant — activates the tenant (draft → active) and emits
   * tenant.tenant.onboarded so downstream services (finance, identity) can
   * seed themselves without coupling to the tenant-service DB.
   *
   * This command is published by createTenantPipeline immediately after the
   * createTenant command, so it is typically processed right after the tenant
   * row exists. The consumer does a findByIdTx; if the row isn't there yet
   * (race: create command hasn't been processed) it throws and the queue will
   * redeliver.
   */
  queue.subscribe<{
    tenantId: string;
    adminEmail: string;
    adminName: string;
    edition: string;
  }>(COMMANDS.onboardTenant, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const cur = await repo.findByIdTx(tx, p.tenantId);
      if (!cur) throw new Error(`tenant ${p.tenantId} not found — onboard command arrived before create was processed`);
      // Only advance draft → active. If already active (e.g. redelivery after
      // partial commit), the domain rule is already satisfied; skip silently.
      if (cur.status === "draft") {
        await repo.update(tx, p.tenantId, {
          status: "active",
          updatedBy: msg.actorId,
          version: cur.version + 1,
        });
      }
      // Emit the onboarded event carrying enough context for downstream seeds.
      await emit(tx, msg, EVENTS.tenantOnboarded, {
        tenantId: p.tenantId,
        adminEmail: p.adminEmail,
        adminName: p.adminName,
        edition: p.edition,
      }, "onboard", p.tenantId);
    });
    await cache.invalidate(keyFor(msg.payload.tenantId));
  });

  queue.subscribe<{ id: string; tier: "pool" | "silo"; dbDsnRef: string | null; kmsKeyRef: string | null }>(
    COMMANDS.setIsolation,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const cur = await repo.findByIdTx(tx, msg.payload.id);
        if (!cur) throw new Error(`tenant ${msg.payload.id} not found`);
        await repo.update(tx, msg.payload.id, {
          isolationTier: msg.payload.tier,
          dbDsnRef: msg.payload.dbDsnRef,
          kmsKeyRef: msg.payload.kmsKeyRef,
          updatedBy: msg.actorId,
          version: cur.version + 1,
        });
        // install-service consumes this to provision/migrate (silo) the tenant DB.
        await emit(tx, msg, EVENTS.tenantIsolationChanged,
          { tenantId: msg.payload.id, tier: msg.payload.tier }, "set_isolation", msg.payload.id);
      });
      await cache.invalidate(keyFor(msg.payload.id));
    },
  );
}

/** Enqueue the domain event + the mandatory audit event (CLAUDE.md §3: every mutation audits). */
async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "tenant", action, resourceType: "tenant", resourceId, outcome: "success" },
  });
}
