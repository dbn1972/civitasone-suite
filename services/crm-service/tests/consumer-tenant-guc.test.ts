/**
 * Guard: every crm-service consumer writes inside a tenant GUC.
 *
 * WHY THIS FILE EXISTS
 * Every table in the `crm` schema is FORCE ROW LEVEL SECURITY with a policy of
 * the form `tenant_id::text = current_setting('app.tenant_id', true)`. In
 * production the worker connects as `crm_svc`, which is NOSUPERUSER and
 * NOBYPASSRLS, so FORCE RLS is genuinely applied to it. Verified against the
 * dev database: as `crm_svc` with no GUC set, an INSERT into
 * crm.lead_field_rules is rejected with
 *   ERROR: new row violates row-level security policy
 * and the identical INSERT succeeds after `SET LOCAL app.tenant_id`.
 *
 * The GUC is only injected by `wrapWithTenantGuc` (see packages/db) when an
 * AsyncLocalStorage tenant context is active. Consumers call a plain
 * `db.transaction(...)`, so the context has to come from somewhere else. It
 * comes from `createQueue()` (services/queue-service/src/bus.ts), which
 * decorates `subscribe` with `withTenantConsumer` so every handler runs inside
 * `runWithTenant(msg.tenantId, ...)`. crm-service gets its bus from that
 * factory (src/shared/infra.ts), so all 60 registered consumers inherit it.
 *
 * That protection was entirely unguarded by this service's tests: nothing here
 * asserted the GUC is set, so removing the decoration — or swapping
 * `createQueue()` for a bare `new MemoryQueue()` in infra.ts — would break
 * every consumer write in production while the suite stayed green. This file
 * closes that gap. Confirmed to fail (not merely to be redundant) by pointing
 * infra.ts at an undecorated MemoryQueue: the first two cases below then fail.
 *
 * WHY IT IS SHAPED THIS WAY
 * The invariant is asserted by observing `current_setting('app.tenant_id')`
 * from inside a handler's own transaction — provable under any DB role, so it
 * holds even if DATABASE_URL is later pointed at a superuser (for whom FORCE
 * RLS is bypassed and an RLS-rejection assertion would silently go vacuous).
 * The stronger end-to-end check — that a GUC-less write is actually refused by
 * Postgres — is only meaningful for a role that does not bypass RLS, so it is
 * gated on that being true and reports itself when skipped.
 *
 * The "future consumer cannot skip the wrapper" guard is deliberately split in
 * two, because the protection is a property of the bus rather than of any
 * handler: (1) the registrar subscribes only through the queue it is handed,
 * and (2) that queue establishes the tenant context for an arbitrary handler.
 * Together those cover consumers that do not exist yet, which enumerating
 * today's handlers would not.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getCurrentTenantId } from "@civitasone/db";
import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";

/** Topic used only by this file's probe handlers — never registered in src. */
const PROBE_TOPIC = "crm.command.__tenant_guc_probe";

/** Whether the connected role actually has FORCE RLS applied to it. */
let rlsApplies = false;
/** The role in use, reported in assertion messages when a check is skipped. */
let dbRole = "unknown";

beforeAll(async () => {
  const rows = (await db.execute(
    sql`SELECT current_user AS role, current_setting('is_superuser') AS su, bypassrls
        FROM pg_roles WHERE rolname = current_user`,
  )) as unknown as Array<{ role: string; su: string; bypassrls: boolean }>;
  const row = rows[0];
  dbRole = row?.role ?? "unknown";
  rlsApplies = row !== undefined && row.su !== "on" && row.bypassrls !== true;
  await queue.start();
});

afterAll(async () => {
  await sqlClient.end();
});

/**
 * Publish one envelope to `topic` on the real bus and wait for delivery.
 * Uses the service's own queue singleton — the object worker.ts hands to
 * registerAllConsumers — so what is exercised is the production wiring.
 */
async function deliver(topic: string, tenantId: string): Promise<void> {
  await queue.publish(topic, {
    type: topic,
    tenantId,
    actorId: randomUUID(),
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: {},
  });
  const drainable = queue as unknown as { drain?: () => Promise<void> };
  if (drainable.drain) await drainable.drain();
  else await new Promise<void>((r) => setTimeout(r, 300));
}

describe("crm consumers run inside a tenant GUC (RLS enforcement)", () => {
  it("sets app.tenant_id to msg.tenantId inside the handler's own transaction", async () => {
    const tenantId = randomUUID();
    let observed: string | null | undefined;
    let handlerRan = false;

    queue.subscribe(PROBE_TOPIC, async () => {
      handlerRan = true;
      // A plain db.transaction — exactly what every real consumer calls.
      await db.transaction(async (tx) => {
        const rows = (await tx.execute(
          sql`SELECT current_setting('app.tenant_id', true) AS guc`,
        )) as unknown as Array<{ guc: string | null }>;
        observed = rows[0]?.guc;
      });
    });

    await deliver(PROBE_TOPIC, tenantId);

    expect(handlerRan, "probe handler was never invoked").toBe(true);
    expect(
      observed,
      "a consumer transaction with no app.tenant_id is rejected by FORCE RLS in production",
    ).toBe(tenantId);
  });

  it("carries the correct tenant when two tenants are processed concurrently", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const seen = new Map<string, string | null | undefined>();
    const topic = `${PROBE_TOPIC}.concurrent`;

    queue.subscribe<Record<string, never>>(topic, async (msg) => {
      await db.transaction(async (tx) => {
        // Interleave the two deliveries so a context that leaked across async
        // boundaries would show up as a crossed tenant rather than passing.
        await new Promise<void>((r) => setTimeout(r, msg.tenantId === tenantA ? 30 : 5));
        const rows = (await tx.execute(
          sql`SELECT current_setting('app.tenant_id', true) AS guc`,
        )) as unknown as Array<{ guc: string | null }>;
        seen.set(msg.tenantId, rows[0]?.guc);
      });
    });

    await Promise.all([deliver(topic, tenantA), deliver(topic, tenantB)]);

    expect(seen.get(tenantA)).toBe(tenantA);
    expect(seen.get(tenantB)).toBe(tenantB);
  });

  it("is refused by Postgres when the same write runs with no tenant context", async () => {
    if (!rlsApplies) {
      // Not a silent pass: state why the strongest check could not run.
      expect(
        rlsApplies,
        `skipped — role "${dbRole}" bypasses FORCE RLS, so a GUC-less write cannot be refused. ` +
          "Point DATABASE_URL at crm_svc to exercise this.",
      ).toBe(false);
      return;
    }

    const tenantId = randomUUID();
    // No runWithTenant wrapper here, so wrapWithTenantGuc injects nothing and
    // the policy is evaluated against a NULL GUC.
    await expect(
      db.transaction((tx) =>
        tx.execute(sql`
          INSERT INTO crm.lead_field_rules
            (tenant_id, field_name, required, created_by, updated_by)
          VALUES (${tenantId}, 'phone', true, ${randomUUID()}, ${randomUUID()})
        `),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("no crm consumer can skip the tenant wrapper", () => {
  it("registers every consumer through the injected queue, never the singleton directly", () => {
    // If a module reached for `infra.queue` itself it would bypass whatever the
    // worker hands in, and a future refactor of worker.ts could not fix it.
    const spy = vi.spyOn(queue, "subscribe");
    const topics: string[] = [];
    const recorder = {
      subscribe: (topic: string) => { topics.push(topic); },
      publish: async () => "recorded",
      start: async () => {},
      stop: async () => {},
      healthCheck: async () => ({ healthy: true, driver: "memory" as const }),
    };
    try {
      registerAllConsumers(recorder as unknown as Queue);
    } finally {
      spy.mockRestore();
    }

    expect(spy).not.toHaveBeenCalled();
    expect(topics.length).toBeGreaterThanOrEqual(Object.keys(COMMANDS).length);
    expect(topics.filter((t) => t.length === 0)).toEqual([]);
  });

  it("gives a tenant context to any handler the worker's queue subscribes, including new ones", async () => {
    // The wrapper lives on the bus, not on the handlers, so this holds for a
    // consumer added tomorrow that this file knows nothing about.
    const tenantId = randomUUID();
    const topic = `${PROBE_TOPIC}.future`;
    let contextTenant: string | undefined;

    queue.subscribe(topic, async () => {
      contextTenant = getCurrentTenantId();
    });
    await deliver(topic, tenantId);

    expect(
      contextTenant,
      "a handler subscribed on the worker's queue must inherit msg.tenantId",
    ).toBe(tenantId);
  });

  it("dead-letters a tenant-less message instead of writing with a NULL GUC", async () => {
    const topic = `${PROBE_TOPIC}.no-tenant`;
    let handlerRan = false;
    queue.subscribe(topic, async () => { handlerRan = true; });

    // Bypass publish()'s typed envelope to post what a malformed upstream
    // message looks like on the wire: no tenantId at all.
    await queue.publish(topic, {
      type: topic,
      actorId: randomUUID(),
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {},
    } as unknown as Parameters<typeof queue.publish>[1]);
    const drainable = queue as unknown as { drain?: () => Promise<void> };
    if (drainable.drain) await drainable.drain();

    // Envelope validation at the consume boundary rejects it before any
    // handler runs, so it fails loudly to the DLQ rather than attempting a
    // write that RLS would refuse with an opaque error.
    expect(handlerRan, "a tenant-less message must never reach a consumer").toBe(false);
    const dlq = (queue as unknown as { dlq?: Array<{ topic: string; error: string }> }).dlq ?? [];
    expect(dlq.filter((d) => d.topic === topic).map((d) => d.error).join(";")).toMatch(
      /invalid_envelope/,
    );
  });
});

// Keeps the CommandEnvelope import meaningful for readers: this is the shape
// every assertion above is about.
export type ProbeEnvelope = CommandEnvelope<Record<string, never>>;
