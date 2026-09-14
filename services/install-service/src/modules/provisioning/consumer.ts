import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Option B: a silo tenant's dedicated DB name (matches provision-silo-tenant.mjs).
 *
 * SEC-013: this result is interpolated into a raw, unparameterized
 * `CREATE DATABASE ${dbName}` DDL statement by a privileged CREATEDB
 * connection (actuator.ts's provisionSiloDatabase — Postgres cannot
 * parameterize identifiers). The only defense before this fix was
 * `.replace(/-/g, "")` + `.slice(0, 16)`, which strips dashes and truncates
 * but does not reject any other character — `tenantId` itself was never
 * validated as a real UUID before reaching here (the sole caller casts the
 * queue payload with `as IsolationChanged`, a compile-time-only assertion,
 * not a runtime check). Assert a real UUID here, at the single place this
 * repo's own dbName strings are derived, so a malformed or adversarial
 * tenantId fails loudly at this choke point instead of silently reaching the
 * DDL statement.
 *
 * Exported (only) for the SEC-013 regression test
 * (tests/silo-db-name-validation.test.ts) to unit-test this assertion in
 * isolation, without needing a live queue/DB round trip.
 */
export function siloDbName(tenantId: string): string {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`INVALID_TENANT_ID: siloDbName requires a UUID tenantId, got ${JSON.stringify(tenantId)}`);
  }
  // .toLowerCase() before stripping/slicing: UUID_RE (like this repo's other
  // UUID_RE call sites) accepts mixed-case hex, but Postgres case-folds an
  // unquoted CREATE DATABASE identifier to lowercase regardless -- normalize
  // here so the dbName this function returns always matches what Postgres
  // actually names the database (relevant for the `datname = $1` lookup in
  // actuator.ts) and so it always satisfies actuator.ts's own lowercase-only
  // SAFE_PG_IDENTIFIER_RE defense-in-depth check.
  return `civitas_tenant_${tenantId.toLowerCase().replace(/-/g, "").slice(0, 16)}`;
}

type IsolationChanged = { tenantId: string; tier: "pool" | "silo" };
type ProvisionUpdate = {
  id: string; tenantId: string; status: "provisioning" | "ready" | "failed";
  error?: string | null; steps?: Array<{ step: string; ok: boolean; detail?: string }>;
};

export function registerProvisioningConsumers(queue: Queue): void {
  // A tenant was flipped to silo → record a provisioning request (idempotent).
  queue.subscribe(CONSUMED_EVENTS.tenantIsolationChanged, async (msg) => {
    const p = msg.payload as IsolationChanged;
    if (p.tier !== "silo") return; // pool: nothing to provision
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findByTenantTx(tx, p.tenantId);
      if (existing) return; // already tracked
      const id = randomUUID();
      await repo.insert(tx, {
        id, tenantId: p.tenantId, dbName: siloDbName(p.tenantId),
        status: "requested", steps: [], createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "install", action: "silo_provision.requested", resourceType: "silo_provision", resourceId: id, outcome: "success", metadata: { dbName: siloDbName(p.tenantId) } },
      });
    });
  });

  // Runner/ops reports provisioning progress.
  queue.subscribe(COMMANDS.siloProvisionUpdate, async (msg) => {
    const p = msg.payload as ProvisionUpdate;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTenantTx(tx, p.id, p.tenantId);
      if (!cur) return;
      const patch: Parameters<typeof repo.update>[2] = {
        status: p.status, updatedBy: msg.actorId, version: cur.version + 1,
      };
      if (p.error !== undefined) patch.error = p.error;
      if (p.steps !== undefined) patch.steps = p.steps;
      if (p.status === "ready") patch.readyAt = new Date();
      await repo.update(tx, p.id, patch);
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "install", action: `silo_provision.${p.status}`, resourceType: "silo_provision", resourceId: p.id, outcome: "success", metadata: {} },
      });
    });
  });
}
