/**
 * ml-assets-05 review fixes -- consumer-level integration tests (real Postgres).
 * - verification submit/approve are compare-and-set on status (concurrent approve,
 *   item-add after submit) and leave an audit failure record when skipped.
 * - assetCreate treats a unique(tenant_id, code) violation as terminal.
 * - date refines: real calendar date, not after today IST.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages as outbox } from "../src/shared/outbox.js";
import { registerVerificationConsumers } from "../src/modules/verification/consumer.js";
import { registerRegisterConsumers, isUniqueViolation } from "../src/modules/register/consumer.js";
import { physicalVerifications, physicalVerificationItems } from "../src/modules/verification/schema.js";
import { assetAssets, assetCategories } from "../src/modules/register/schema.js";
import { createAssetBody } from "../src/modules/register/validators.js";
import { isRealDateNotAfterToday, todayIST } from "../src/shared/dates.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aaaaaaaa-5555-4000-8000-0000000000a5";
const ACTOR = "cccccccc-5555-4000-8000-0000000000c5";
// GAP2-ASSETS-VERIFICATION-01: an approver may not be the session's creator.
// Sessions here are CREATED by a distinct actor so ACTOR is a valid, different
// approver in the approve commands below.
const CREATOR = "ffffffff-5555-4000-8000-0000000000f5";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
const tick = (ms = 400) => new Promise<void>((r) => setTimeout(r, ms));

async function send(type: string, payload: Record<string, unknown>, register: (q: MemoryQueue) => void, messageId = randomUUID()) {
  const q = new MemoryQueue();
  register(q);
  await q.start();
  await q.publish(type, { messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: `ml05-${type}`, schemaVersion: "1.0", payload: { tenantId: TENANT, ...payload } });
  await tick();
  await q.stop();
}
const verif = (q: MemoryQueue) => registerVerificationConsumers(q);
const reg = (q: MemoryQueue) => registerRegisterConsumers(q);
const auditActions = async (needle: string) =>
  (await asTenant((tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, TENANT), eq(outbox.topic, "audit.event.record")))))
    .filter((r) => JSON.stringify(r.payload).includes(needle));
const statusOf = async (id: string) => (await asTenant((tx) => tx.select().from(physicalVerifications).where(eq(physicalVerifications.id, id))))[0]!;

const categoryId = randomUUID();

describe("ml-assets-05 consumers", () => {
  beforeAll(async () => {
    await asTenant((tx) => tx.insert(assetCategories).values({ id: categoryId, tenantId: TENANT, code: "ML5", name: "ML5", createdBy: ACTOR, updatedBy: ACTOR }));
  });
  afterAll(async () => {
    await asTenant(async (tx) => {
      await tx.delete(physicalVerificationItems).where(eq(physicalVerificationItems.tenantId, TENANT));
      await tx.delete(physicalVerifications).where(eq(physicalVerifications.tenantId, TENANT));
      await tx.delete(assetAssets).where(eq(assetAssets.tenantId, TENANT));
      await tx.delete(assetCategories).where(eq(assetCategories.id, categoryId));
    });
    await sqlClient.end();
  });

  async function session(status: string): Promise<string> {
    const id = randomUUID();
    await asTenant((tx) => tx.insert(physicalVerifications).values({ id, tenantId: TENANT, verificationDate: "2026-01-01", verifiedBy: CREATOR, status, createdBy: CREATOR, updatedBy: CREATOR }));
    return id;
  }

  it("a second approve on an already-approved session changes nothing and records a failure audit", async () => {
    const id = await session("submitted");
    await send(COMMANDS.verificationApprove, { id }, verif);
    const first = await statusOf(id);
    expect(first.status).toBe("approved");
    // concurrent/duplicate approve by someone else with a fresh messageId
    await send(COMMANDS.verificationApprove, { id }, verif);
    const second = await statusOf(id);
    expect(second.status).toBe("approved");
    expect(second.approvedAt?.getTime()).toBe(first.approvedAt?.getTime());
    expect((await auditActions("verification_approve_rejected")).some((r) => JSON.stringify(r.payload).includes(id))).toBe(true);
  });

  it("approve is refused on a draft (not yet submitted)", async () => {
    const id = await session("draft");
    await send(COMMANDS.verificationApprove, { id }, verif);
    expect((await statusOf(id)).status).toBe("draft");
  });

  it("an item added after submit is not inserted and is audited as rejected", async () => {
    const id = await session("draft");
    await send(COMMANDS.verificationSubmit, { id }, verif);
    expect((await statusOf(id)).status).toBe("submitted");
    const itemId = randomUUID();
    await send(COMMANDS.verificationItemAdd, { id: itemId, verificationId: id, assetId: randomUUID(), condition: "good" }, verif);
    const items = await asTenant((tx) => tx.select().from(physicalVerificationItems).where(eq(physicalVerificationItems.verificationId, id)));
    expect(items).toHaveLength(0);
    expect((await auditActions(itemId)).some((r) => JSON.stringify(r.payload).includes("verification_item_add_rejected"))).toBe(true);
  });

  it("an item added to a draft still lands", async () => {
    const id = await session("draft");
    await send(COMMANDS.verificationItemAdd, { id: randomUUID(), verificationId: id, assetId: randomUUID(), condition: "good" }, verif);
    const items = await asTenant((tx) => tx.select().from(physicalVerificationItems).where(eq(physicalVerificationItems.verificationId, id)));
    expect(items).toHaveLength(1);
  });

  it("a duplicate asset code reaching the consumer is terminal: one asset, a failure audit, and the message is acked (processed)", async () => {
    const code = `DUP-${randomUUID().slice(0, 6)}`;
    const base = { name: "Jeep", code, categoryId, acquisitionCost: 100, acquisitionDate: "2026-01-01" };
    const first = randomUUID();
    const second = randomUUID();
    await send(COMMANDS.assetCreate, { id: first, ...base }, reg);
    const dupMessageId = randomUUID();
    await send(COMMANDS.assetCreate, { id: second, ...base }, reg, dupMessageId);
    const rows = await asTenant((tx) => tx.select().from(assetAssets).where(and(eq(assetAssets.tenantId, TENANT), eq(assetAssets.code, code))));
    expect(rows.map((r) => r.id)).toEqual([first]);
    expect((await auditActions("create_rejected_duplicate_code")).some((r) => JSON.stringify(r.payload).includes(second))).toBe(true);
    // redelivery of the same duplicate message is a no-op (already processed -> no 2nd audit)
    await send(COMMANDS.assetCreate, { id: second, ...base }, reg, dupMessageId);
    expect((await auditActions("create_rejected_duplicate_code")).filter((r) => JSON.stringify(r.payload).includes(second))).toHaveLength(1);
  });
});

describe("pure", () => {
  it("isUniqueViolation sees 23505 directly or on cause", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
  });
  it("date refine: real calendar date, not after today IST", () => {
    const now = new Date("2026-03-10T20:00:00Z"); // 11 Mar IST
    expect(todayIST(now)).toBe("2026-03-11");
    expect(isRealDateNotAfterToday("2026-03-11", now)).toBe(true);
    expect(isRealDateNotAfterToday("2026-03-12", now)).toBe(false);
    expect(isRealDateNotAfterToday("2026-02-31", now)).toBe(false);
    expect(isRealDateNotAfterToday("2026-3-1", now)).toBe(false);
  });
  it("createAssetBody rejects a future / impossible acquisitionDate", () => {
    const ok = { name: "A", code: "A1", categoryId: "11111111-1111-4111-8111-111111111111", acquisitionCost: 1 };
    expect(createAssetBody.safeParse({ ...ok, acquisitionDate: "2999-01-01" }).success).toBe(false);
    expect(createAssetBody.safeParse({ ...ok, acquisitionDate: "2026-02-31" }).success).toBe(false);
    expect(createAssetBody.safeParse({ ...ok, acquisitionDate: todayIST() }).success).toBe(true);
  });
});
