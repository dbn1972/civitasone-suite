/**
 * P1-4 — Real cross-service event chain: tenant/admin module-toggle → RBAC propagation.
 *
 * The UAT gap report lists "tenant module-toggle → RBAC" as WIRED
 * (`admin-service .../config/consumer.ts`) but UNTESTED. This exercises the real
 * hop on the shared-queue harness: publish the `admin.module.toggle` command, let
 * the REAL admin config consumer react, and assert it (a) upserts the module
 * enablement row RBAC reads from, and (b) emits the canonical audit event.
 *
 * DB + outbox + cache are stubbed in-memory so it runs in CI with no infra.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// --- admin-service data layer ----------------------------------------------
vi.mock("../../services/admin-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});

vi.mock("../../services/admin-service/src/shared/outbox.js", async () => {
  const h = await import("./harness.js");
  return {
    enqueue: h.mockEnqueue,
    markProcessed: h.mockMarkProcessed,
    outboxMessages: {},
    processed: {},
    outboxSchema: {},
    relayOnce: async () => 0,
    startRelay: () => ({}) as unknown,
  };
});

// cache.invalidate runs outside the tx — stub it so no Redis is needed.
vi.mock("../../services/admin-service/src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

const { registerConfigConsumers } = await import(
  "../../services/admin-service/src/modules/config/consumer.js"
);

const TENANT = "44444444-dddd-4000-8000-000000000001";
const ACTOR = "55555555-eeee-4000-8000-000000000001";

function envelope(messageId: string, type: string, payload: Record<string, unknown>) {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0",
    payload,
  };
}

let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  registerConfigConsumers(harness.queue);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Cross-service chain: admin.module.toggle → RBAC module enablement + audit", () => {
  it("a module toggle upserts the tenant module-enablement row RBAC reads from", async () => {
    await harness.queue.publish(
      "admin.module.toggle",
      envelope("c0000001-0001-4000-8000-000000000001", "admin.module.toggle", {
        tenantId: TENANT,
        moduleKey: "procurement",
        enabled: false,
      }),
    );
    await new Promise((r) => setTimeout(r, 200));

    const moduleRows = harness.inserts.filter(
      (i) => typeof (i.row as { moduleKey?: unknown }).moduleKey === "string",
    );
    expect(moduleRows).toHaveLength(1);
    const row = moduleRows[0].row as Record<string, unknown>;
    expect(row.tenantId).toBe(TENANT);
    expect(row.moduleKey).toBe("procurement");
    expect(row.enabled).toBe(false);
    expect(row.createdBy).toBe(ACTOR);
    expect(row.updatedBy).toBe(ACTOR);
  });

  it("also emits a canonical audit.event.record for the toggle", async () => {
    const auditEvent = harness.nextEvent("audit.event.record");

    await harness.queue.publish(
      "admin.module.toggle",
      envelope("c0000002-0001-4000-8000-000000000001", "admin.module.toggle", {
        tenantId: TENANT,
        moduleKey: "finance",
        enabled: true,
      }),
    );

    const msg = await auditEvent;
    const ap = msg.payload as { service: string; action: string; resourceType: string; resourceId: string; outcome: string };
    expect(ap.service).toBe("admin");
    expect(ap.action).toBe("module_toggle");
    expect(ap.resourceType).toBe("config");
    expect(ap.resourceId).toBe(TENANT);
    expect(ap.outcome).toBe("success");
  });

  it("a redelivered toggle command is processed once (idempotency across the hop)", async () => {
    const dup = envelope("c0000003-0001-4000-8000-000000000001", "admin.module.toggle", {
      tenantId: TENANT,
      moduleKey: "hrms",
      enabled: false,
    });
    await harness.queue.publish("admin.module.toggle", dup);
    await harness.queue.publish("admin.module.toggle", dup);
    await new Promise((r) => setTimeout(r, 300));

    const moduleRows = harness.inserts.filter(
      (i) => typeof (i.row as { moduleKey?: unknown }).moduleKey === "string",
    );
    expect(moduleRows).toHaveLength(1);
  });
});
