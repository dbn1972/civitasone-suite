/**
 * CLOS3-S4-09 (building-service): application and permit reference numbers come from Postgres
 * sequences, so two commands can never collide on the UNIQUE number column and lose an already
 * accepted (202) request. randomInt(1, 999999) is pinned to a constant to make the old behaviour
 * collide deterministically.
 *
 * Real Postgres as the non-superuser building_svc role (FORCE RLS enforced).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    // only the reference-number call (1, 999999) is pinned; verification codes etc. stay random
    randomInt: ((min: number, max?: number, cb?: unknown) =>
      min === 1 && max === 999999 ? 1 : (actual.randomInt as (...a: unknown[]) => unknown)(min, max, cb)) as typeof actual.randomInt,
  };
});

const { db, sqlClient } = await import("../src/shared/db.js");
const { outboxMessages } = await import("@civitasone/outbox");
const { buildingApplications } = await import("../src/modules/applications/schema.js");
const { buildingPermits } = await import("../src/modules/permits/schema.js");
const { registerApplicationConsumers } = await import("../src/modules/applications/consumer.js");
const { registerPermitConsumers } = await import("../src/modules/permits/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "80000000-dead-4000-8000-0000000c3a09";
const ACTOR = "80000000-dead-4000-8000-0000000c3a0a";

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(buildingPermits).where(eq(buildingPermits.tenantId, TENANT));
    await tx.delete(buildingApplications).where(eq(buildingApplications.tenantId, TENANT));
  }));
}
const msg = (type: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
});
const asTenant = <T>(fn: () => Promise<T>): Promise<T> => Promise.resolve(runWithTenant(TENANT, fn));

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("building reference numbers are sequence-backed (real Postgres)", () => {
  it("two createApplication commands both persist, with distinct application numbers", async () => {
    const queue = new MemoryQueue();
    registerApplicationConsumers(queue);
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      await queue.publish(COMMANDS.createApplication, msg(COMMANDS.createApplication, {
        id, tenantId: TENANT, siteAddress: { line1: "1 Test Rd" }, plotArea: 100, builtUpArea: 80, proposedFloors: 2, fsiRequested: 1.0,
      }));
    }
    await queue.drain();
    const rows = await asTenant(() => db.transaction((tx) => tx.select().from(buildingApplications).where(eq(buildingApplications.tenantId, TENANT))));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.applicationNumber)).size).toBe(2);
    expect(rows.every((r) => /^BLDG\/ULB\/\d{4}\/\d{6}$/.test(r.applicationNumber))).toBe(true);
  });

  it("two issuePermit commands both persist, with distinct permit numbers", async () => {
    const queue = new MemoryQueue();
    registerPermitConsumers(queue);
    for (const id of [randomUUID(), randomUUID()]) {
      await queue.publish(COMMANDS.issuePermit, msg(COMMANDS.issuePermit, { id, tenantId: TENANT, applicationId: randomUUID(), validityMonths: 12 }));
    }
    await queue.drain();
    const rows = await asTenant(() => db.transaction((tx) => tx.select().from(buildingPermits).where(eq(buildingPermits.tenantId, TENANT))));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.permitNumber)).size).toBe(2);
    expect(rows.every((r) => /^PERM\/BLDG\/ULB\/\d{4}\/\d{6}$/.test(r.permitNumber))).toBe(true);
  });

  it("a rolled-back transaction leaves a gap in the sequence but never reuses a number", async () => {
    const { nextApplicationNumberSeq } = await import("../src/modules/applications/repo.js").then((m) => m as unknown as { nextApplicationNumberSeq?: (tx: unknown) => Promise<number> });
    expect(nextApplicationNumberSeq).toBeTypeOf("function");
    const seen: number[] = [];
    await expect(asTenant(() => db.transaction(async (tx) => {
      seen.push(await nextApplicationNumberSeq!(tx));
      throw new Error("rollback");
    }))).rejects.toThrow("rollback");
    await asTenant(() => db.transaction(async (tx) => { seen.push(await nextApplicationNumberSeq!(tx)); }));
    expect(seen[1]!).toBeGreaterThan(seen[0]!);
  });
});
