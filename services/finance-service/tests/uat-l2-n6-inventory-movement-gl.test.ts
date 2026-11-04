/**
 * UAT L2-N6: inventory-service stock movements post to the GL (real Postgres, real GL consumer).
 *
 * finance.gl.post { type: "inventory_movement" } used to fall into the generic journal path, be refused as
 * JOURNAL_TOO_FEW_LINES and dead-letter (outbox e6932aac, GRN accept of SKU G4X13257).
 *  - receipt: Dr Stores / Inventory 1400, Cr GRN clearing (the GRN bill head, 2202) -- balanced, tenant-scoped;
 *  - issue: Dr Stores consumed 5300, Cr Stores / Inventory 1400;
 *  - idempotent by journal id: a redelivery, and a re-drive of a dead letter the generic path had already
 *    inbox-marked, post exactly once;
 *  - a legacy payload (no postingDate) still posts; an unknown head / closed period is refused with
 *    finance.gl.rejected and dead-lettered, nothing posted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq, and } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeJournals, financeJournalLines } from "../src/modules/gl/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financePeriodClose } from "../src/modules/period-close/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { deterministicId } from "../src/modules/gl/spine.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const BARE = randomUUID(); // a tenant whose chart has no stores head
const ACTOR = randomUUID();
const msgIds: string[] = [];

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}
let q: MemoryQueue;

async function post(tenantId: string, payload: Record<string, unknown>, messageId = randomUUID()): Promise<string> {
  msgIds.push(messageId);
  await q.publish(COMMANDS.journalPost, { messageId, type: COMMANDS.journalPost, tenantId, actorId: ACTOR, correlationId: `n6-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload });
  await q.drain();
  return messageId;
}
const journalOf = (tenantId: string, movementId: string) =>
  scoped(tenantId, (tx) => tx.select().from(financeJournals).where(and(eq(financeJournals.tenantId, tenantId), eq(financeJournals.id, deterministicId(`inventory_movement:${movementId}`)))));
const linesOf = async (tenantId: string, journalId: string) => {
  const rows = await scoped(tenantId, (tx) => tx.select().from(financeJournalLines).where(eq(financeJournalLines.journalId, journalId)));
  return (rows as Array<{ headCode: string | null; debitMinor: bigint; creditMinor: bigint }>)
    .map((r) => [r.headCode, String(r.debitMinor), String(r.creditMinor)]).sort();
};
const receipt = (movementId: string, extra: Record<string, unknown> = {}) => ({
  type: "inventory_movement", movementId, kind: "receipt", totalMinor: "300100", postingDate: "2026-11-04", refDoc: "GRN", refNo: randomUUID(), ...extra,
});

beforeAll(async () => {
  for (const [code, name, classification] of [["1400", "Stores / Inventory", "asset"], ["5300", "Stores Consumed", "expense"], ["2202", "General Education", "expense"]] as const) {
    await scoped(TENANT, (tx) => tx.insert(financeHeads).values({ tenantId: TENANT, code, name, level: 1, classification, createdBy: ACTOR, updatedBy: ACTOR }));
  }
  await scoped(BARE, (tx) => tx.insert(financeHeads).values({ tenantId: BARE, code: "2202", name: "General Education", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR }));
  q = tenantWrappedQueue();
  registerGlConsumers(q);
  await q.start();
});
afterAll(async () => {
  await q.stop();
  for (const t of [TENANT, BARE]) await scoped(t, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t))).catch(() => {});
  for (const m of msgIds) await db.delete(processed).where(eq(processed.messageId, m)).catch(() => {});
  await sqlClient.end();
});

describe("UAT L2-N6: finance.gl.post inventory_movement", () => {
  it("books a stock receipt Dr Stores / Inventory, Cr GRN clearing (the GRN bill head), balanced, on its posting date", async () => {
    const mv = randomUUID();
    await post(TENANT, receipt(mv));
    const [j] = await journalOf(TENANT, mv);
    expect(j).toMatchObject({ status: "posted", type: "inventory_movement", postingDate: "2026-11-04" });
    expect(await linesOf(TENANT, j!.id)).toEqual([["1400", "300100", "0"], ["2202", "0", "300100"]].sort());
    expect(q.dlq.length).toBe(0);
  });

  it("books a stores issue Dr Stores consumed, Cr Stores / Inventory", async () => {
    const mv = randomUUID();
    await post(TENANT, { type: "inventory_movement", movementId: mv, kind: "issue", totalMinor: "5000", postingDate: "2026-11-04" });
    const [j] = await journalOf(TENANT, mv);
    expect(await linesOf(TENANT, j!.id)).toEqual([["1400", "0", "5000"], ["5300", "5000", "0"]].sort());
  });

  it("is idempotent by journal id: a redelivery (new message id) posts nothing more", async () => {
    const mv = randomUUID();
    await post(TENANT, receipt(mv));
    await post(TENANT, receipt(mv));
    expect(await journalOf(TENANT, mv)).toHaveLength(1);
    expect(await linesOf(TENANT, (await journalOf(TENANT, mv))[0]!.id)).toHaveLength(2);
  });

  it("posts a re-driven dead letter that the old generic path had already inbox-marked (the e6932aac case), once", async () => {
    const mv = randomUUID();
    const dead = randomUUID();
    msgIds.push(dead);
    await db.insert(processed).values({ messageId: dead });
    // the legacy wire shape: no postingDate / ref fields
    await post(TENANT, { kind: "receipt", type: "inventory_movement", movementId: mv, totalMinor: "300100" }, dead);
    const rows = await journalOf(TENANT, mv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.postingDate).toBe(new Date().toISOString().slice(0, 10));
    await post(TENANT, { kind: "receipt", type: "inventory_movement", movementId: mv, totalMinor: "300100" }, dead);
    expect(await journalOf(TENANT, mv)).toHaveLength(1);
  });

  it("is tenant-scoped: the journal is invisible to another tenant", async () => {
    const mv = randomUUID();
    await post(TENANT, receipt(mv));
    expect(await journalOf(BARE, mv)).toHaveLength(0);
  });

  it("refuses a tenant without a stores head: finance.gl.rejected (UNKNOWN_ACCOUNT_CODE), dead-lettered, nothing posted", async () => {
    const mv = randomUUID();
    const before = q.dlq.length;
    await post(BARE, receipt(mv));
    expect(q.dlq.length).toBe(before + 1);
    expect(await journalOf(BARE, mv)).toHaveLength(0);
    const out = await scoped(BARE, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, BARE)));
    const rej = out.map((r) => r.payload as Record<string, unknown>).find((pl) => pl.type === "inventory_movement" && pl.code === "UNKNOWN_ACCOUNT_CODE");
    expect(rej).toMatchObject({ accountCode: "1400", sourceRef: `inventory_movement:${mv}`, journalId: deterministicId(`inventory_movement:${mv}`) });
  });

  it("refuses a posting into a hard-closed period (period-open check)", async () => {
    await scoped(TENANT, (tx) => tx.insert(financePeriodClose).values({ tenantId: TENANT, fiscalYear: "2025-26", period: "2026-03", status: "hard_close", createdBy: ACTOR }));
    const mv = randomUUID();
    const before = q.dlq.length;
    await post(TENANT, receipt(mv, { postingDate: "2026-03-15" }));
    expect(q.dlq.length).toBe(before + 1);
    expect(await journalOf(TENANT, mv)).toHaveLength(0);
  });

  it("dead-letters a payload that can never post (no movement id / bad amount) without posting", async () => {
    const before = q.dlq.length;
    await post(TENANT, { type: "inventory_movement", kind: "receipt", totalMinor: "-5" });
    expect(q.dlq.length).toBe(before + 1);
  });
});
