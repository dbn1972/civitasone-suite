import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";

/**
 * SYN-1 (03) behavioral coverage — idempotency, conflict detection, per-mutation
 * state. DB-gated like sync.perf.test.ts (needs migrations 0002 + 0007 applied to
 * the identity DB). Run with DB_URL set.
 */
const dbUrl = process.env.DB_URL;

describe.skipIf(!dbUrl)("sync protocol — idempotency + conflict detection", () => {
  const tenantId = "00000000-0000-0000-0000-000000000001";
  const deviceId = randomUUID();

  it("SYN-1b: a replayed clientMutationId is deduped (one recorded outcome)", async () => {
    const repo = await import("../src/modules/devices/repo.js");
    const { db } = await import("../src/shared/db.js");
    const clientMutationId = randomUUID();
    const entityId = randomUUID();

    await repo.recordProcessedMutation(db, {
      tenantId, deviceId, clientMutationId, mailbox: "approvals",
      entityId, status: "applied", resultEtag: "etag-1", resultSeq: "1",
    });

    // The unique (tenant, device, clientMutationId) constraint rejects a replay.
    await expect(
      repo.recordProcessedMutation(db, {
        tenantId, deviceId, clientMutationId, mailbox: "approvals",
        entityId, status: "applied", resultEtag: "etag-2", resultSeq: "2",
      }),
    ).rejects.toThrow();

    const found = await repo.findProcessedMutation(db, tenantId, deviceId, clientMutationId);
    expect(found?.status).toBe("applied");
    expect(found?.resultEtag).toBe("etag-1");
  });

  it("SYN-1c: latest entity state is returned for conflict detection", async () => {
    const repo = await import("../src/modules/devices/repo.js");
    const { db } = await import("../src/shared/db.js");
    const entityId = randomUUID();

    const first = await repo.appendChangelogOne(db, {
      tenantId, mailbox: "approvals", entityId, operation: "create", payload: { v: 1 },
    });
    const second = await repo.appendChangelogOne(db, {
      tenantId, mailbox: "approvals", entityId, operation: "update", payload: { v: 2 },
    });

    const latest = await repo.getLatestEntityState(db, tenantId, "approvals", entityId);
    expect(latest?.etag).toBe(second.etag);
    expect(latest?.etag).not.toBe(first.etag);

    // A client pushing with the stale (first) etag would be a conflict; with the
    // latest (second) etag it would not.
    expect(latest!.etag === first.etag).toBe(false);
    expect(latest!.etag === second.etag).toBe(true);
  });

  it("SYN-1/03-T7: a user-private mailbox hides another user's rows on pull", async () => {
    const repo = await import("../src/modules/devices/repo.js");
    const userA = randomUUID();
    const userB = randomUUID();
    const tenant = randomUUID();

    await repo.appendChangelog({
      tenantId: tenant, mailbox: "notifications", entityId: randomUUID(),
      operation: "upsert", payload: { for: "A" }, ownerUserId: userA,
    });
    await repo.appendChangelog({
      tenantId: tenant, mailbox: "notifications", entityId: randomUUID(),
      operation: "upsert", payload: { for: "B" }, ownerUserId: userB,
    });
    await repo.appendChangelog({
      tenantId: tenant, mailbox: "notifications", entityId: randomUUID(),
      operation: "upsert", payload: { for: "all" }, ownerUserId: null,
    });

    // User A's private pull sees their own row + the unowned/shared row, NOT B's.
    const rowsForA = await repo.pullSince(tenant, "notifications", 0n, 100, {
      userId: userA, userPrivate: true,
    });
    const owners = rowsForA.map((r) => r.ownerUserId);
    expect(owners).toContain(userA);
    expect(owners).toContain(null);
    expect(owners).not.toContain(userB);

    // Without the private flag (legacy/shared mailbox) all rows are returned.
    const rowsShared = await repo.pullSince(tenant, "notifications", 0n, 100);
    expect(rowsShared.length).toBeGreaterThanOrEqual(3);
  });

  it("03-T5: a domain delete event produces a `delete` changelog tombstone that pull returns", async () => {
    const repo = await import("../src/modules/devices/repo.js");
    const { registerSyncFeederConsumers } = await import("../src/modules/sync/feeder.js");
    const tenant = randomUUID();
    const contactId = randomUUID();

    // Wire the real feeder rules onto an in-memory queue and emit the domain
    // delete event (crm.contact.deleted → crm_contacts, operation "delete").
    const queue = new MemoryQueue();
    registerSyncFeederConsumers(queue);
    await queue.publish("crm.contact.deleted", {
      type: "crm.contact.deleted", tenantId: tenant, actorId: randomUUID(),
      correlationId: randomUUID(), schemaVersion: "1.0", payload: { contactId },
    });
    // MemoryQueue delivers on the next tick; wait for the handler to commit.
    await new Promise((r) => setTimeout(r, 30));

    // The feeder must have appended a tombstone (operation === "delete").
    const rows = await repo.pullSince(tenant, "crm_contacts", 0n, 100);
    const tombstone = rows.find((r) => r.entityId === contactId);
    expect(tombstone).toBeDefined();
    expect(tombstone?.operation).toBe("delete");

    // Pull maps operation === "delete" → a delete-entity for the client, so the
    // entity is removed locally on the next sync (verified in routes.ts pull).
    const entity = {
      id: tombstone!.entityId,
      operation: tombstone!.operation === "delete" ? ("delete" as const) : ("upsert" as const),
    };
    expect(entity.operation).toBe("delete");
  });

  it("03-T1: a pushed mutation for a write-through mailbox enqueues the domain command (outbox row)", async () => {
    process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || "test-internal-secret";
    const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;

    const { buildApp } = await import("../src/app.js");
    const { db } = await import("../src/shared/db.js");
    const { registeredDevices } = await import("../src/modules/devices/schema.js");
    const { outboxMessages } = await import("@civitasone/outbox");

    const tenant = randomUUID();
    const deviceId = randomUUID();
    const entityId = randomUUID();
    // x-internal context resolves to this fixed service-account actor id.
    const serviceActor = "00000000-0000-0000-0000-000000000099";

    // A push requires a trusted, non-revoked device owned by the actor.
    await db.insert(registeredDevices).values({
      id: deviceId, tenantId: tenant, userId: serviceActor,
      platform: "ios", label: "test-device", fingerprint: randomUUID(),
      trustToken: "test-token", trustLevel: "recognized",
      createdBy: serviceActor, updatedBy: serviceActor,
    });

    const app = await buildApp();
    try {
      const clientMutationId = randomUUID();
      const res = await app.inject({
        method: "POST",
        url: "/v1/sync/push",
        headers: {
          "x-internal": "1",
          "x-tenant-id": tenant,
          "x-service-secret": serviceSecret!,
          "content-type": "application/json",
        },
        payload: {
          deviceId,
          mailbox: "crm_contacts",
          cursor: "0",
          mutations: [
            {
              clientMutationId,
              operation: "create",
              entityId,
              payload: { name: "Test Contact", email: "t@example.gov.in" },
              clientUpdatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const bodyJson = res.json() as { applied: string[] };
      expect(bodyJson.applied).toContain(clientMutationId);

      // Write-through: the applied mutation must have enqueued the matching
      // domain command (crm_contacts + create → crm.contact.create) onto the
      // transactional outbox, in the same tx as the changelog write.
      const outRows = await db.select().from(outboxMessages).where(
        and(eq(outboxMessages.tenantId, tenant), eq(outboxMessages.topic, "crm.contact.create")),
      );
      const cmd = outRows.find((r) => (r.payload as { id?: string }).id === entityId);
      expect(cmd).toBeDefined();
      expect(cmd?.eventType).toBe("crm.contact.create");
      expect((cmd!.payload as { tenantId?: string }).tenantId).toBe(tenant);
    } finally {
      await app.close();
    }
  });
});
