/**
 * hrms-service service-book F3 consumer — "immutable once attested" guard
 * regression (SEC-CRIT-003), real Postgres, no mocks.
 *
 * f3-consumer.ts's edit case (service_book_routes__1) was missing
 * `eq(attested, false)` in its UPDATE's WHERE clause — unlike the attest
 * case a few lines below, which already had it — so an edit racing a
 * concurrent attest (the route's own pre-check reads `attested` BEFORE this
 * async command is actually processed) could silently overwrite an
 * already-attested entry. This attests a real entry, then runs a real edit
 * against it through the real consumer, and asserts: the row is unchanged
 * and the message is dead-lettered with a clear error, not silently applied.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_service_book_Consumers } from "../src/modules/service-book/f3-consumer.js";
import { hrmsServiceBookEntries, type ServiceBookRow } from "../src/modules/service-book/schema.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "a1000000-f3ed-4000-8000-00000000c0de";
const ACTOR = "a1000000-f3ed-4000-8000-0000000ac70a";
const ATTESTER = "a1000000-f3ed-4000-8000-0000000ac70b";
const EDITOR = "a1000000-f3ed-4000-8000-0000000ac70c";

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(op: string, id: string, actorId: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { op, id, tenantId: TENANT, ...payload },
  };
}

async function seedEntry(attested: boolean): Promise<{ entryId: string; employeeId: string }> {
  const entryId = randomUUID();
  const employeeId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id: employeeId, tenantId: TENANT, employeeNo: `TEST-${employeeId.slice(0, 8)}`,
    fullName: "Test Employee", departmentId: randomUUID(), designationId: randomUUID(),
    dateOfJoining: "2020-01-01", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsServiceBookEntries).values({
    id: entryId, tenantId: TENANT, employeeId, entryType: "increment", effectiveDate: "2026-04-01",
    description: "Original description", recordedBy: ACTOR,
    attested,
    ...(attested ? { attestedBy: ATTESTER, attestedAt: new Date(), attestRemarks: "Pre-attested for test" } : {}),
  }));
  return { entryId, employeeId };
}

async function readEntry(entryId: string): Promise<ServiceBookRow> {
  const rows = await withTenantScope(db, TENANT, (tx: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.id, entryId)));
  return rows[0];
}

describe("service-book F3 consumer -- immutable once attested (real DB, no mocks)", () => {
  it("an edit against an ALREADY-attested entry does not change the row and is dead-lettered, not silently applied", async () => {
    const { entryId } = await seedEntry(true);
    const before = await readEntry(entryId);
    expect(before.attested).toBe(true);

    const q = tenantWrappedQueue();
    registerF3_service_book_Consumers(q);
    await q.start();

    await q.publish(COMMANDS.f3RouteWrite, makeMsg("service_book_routes__1", entryId, EDITOR, {
      body: { description: "Sneaked-in edit", documentRef: null },
      params: { entryId },
      query: {},
    }));
    await q.drain();

    const after = await readEntry(entryId);
    expect(after.description).toBe("Original description");
    expect(after.description).not.toBe("Sneaked-in edit");
    expect(after.updatedBy).toBeNull();
    expect(after.updatedAt).toBeNull();

    expect(q.dlq, `expected the edit to be dead-lettered, got: ${JSON.stringify(q.dlq)}`).toHaveLength(1);
    expect(q.dlq[0]?.error).toMatch(/attested/i);

    await q.stop();
  });

  it("an edit against an UNattested entry updates the row and stamps updatedAt/updatedBy", async () => {
    const { entryId } = await seedEntry(false);

    const q = tenantWrappedQueue();
    registerF3_service_book_Consumers(q);
    await q.start();

    await q.publish(COMMANDS.f3RouteWrite, makeMsg("service_book_routes__1", entryId, EDITOR, {
      body: { description: "Legitimate edit", documentRef: "DOC-42" },
      params: { entryId },
      query: {},
    }));
    await q.drain();

    const after = await readEntry(entryId);
    expect(after.description).toBe("Legitimate edit");
    expect(after.documentRef).toBe("DOC-42");
    expect(after.updatedBy).toBe(EDITOR);
    expect(after.updatedAt).not.toBeNull();

    expect(q.dlq).toHaveLength(0);
    await q.stop();
  });
});
