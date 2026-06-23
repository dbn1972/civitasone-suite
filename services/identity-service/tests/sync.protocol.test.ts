import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

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
});
