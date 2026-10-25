/**
 * CLOS3-S5-02 -- redeemPoints / voidRedemption ignored the boolean returned by
 * enrolmentRepo.adjustBalance() (false == optimistic-lock miss, 0 rows updated).
 * The redemption row, outbox event and audit row committed while
 * points_balance was never deducted (or, on void, never restored).
 *
 * Real Postgres, real RLS (non-superuser role), real MemoryQueue. MemoryQueue
 * swallows handler errors into q.dlq, so a rolled-back command shows up there.
 * Fails on the pre-fix code (row committed, DLQ empty).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { programs } from "../src/modules/programs/schema.js";
import { enrolments } from "../src/modules/enrolments/schema.js";
import { redemptions } from "../src/modules/redemptions/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerRedemptionConsumers } from "../src/modules/redemptions/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const force = vi.hoisted(() => ({ lose: false }));
vi.mock("../src/modules/enrolments/repo.js", async (orig) => {
  const m = await orig<typeof import("../src/modules/enrolments/repo.js")>();
  return {
    ...m,
    adjustBalance: (...a: Parameters<typeof m.adjustBalance>) =>
      force.lose ? Promise.resolve(false) : m.adjustBalance(...a),
  };
});

const TENANT = "c3a50200-dead-4000-8000-0000000ba102";
const ACTOR = "c3a50200-dead-4000-8000-0000000ac702";
const PROGRAM = "c3a50200-dead-4000-8000-000000000ba2";
const ENROLMENT = "c3a50200-dead-4000-8000-0000000e0102";
const START = 1000n;

const tx = <T>(fn: (t: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

async function clean() {
  await tx(async (t) => {
    await t.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await t.delete(redemptions).where(eq(redemptions.tenantId, TENANT));
    await t.delete(enrolments).where(eq(enrolments.tenantId, TENANT));
    await t.delete(programs).where(eq(programs.tenantId, TENANT));
  });
}

async function seed() {
  await clean();
  await tx(async (t) => {
    await t.insert(programs).values({
      id: PROGRAM, tenantId: TENANT, name: "S5-02 fixture", status: "active",
      earnRatio: 100n, createdBy: ACTOR, updatedBy: ACTOR,
    });
    await t.insert(enrolments).values({
      id: ENROLMENT, tenantId: TENANT, programId: PROGRAM, profileId: randomUUID(),
      status: "active", tier: "base", pointsBalance: START, lifetimePoints: START,
      createdBy: ACTOR, updatedBy: ACTOR, version: 5,
    });
  });
}

const envelope = (type: string, payload: unknown) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
  correlationId: randomUUID(), schemaVersion: "1.0", payload,
});

async function run(type: string, payload: unknown) {
  const q = tenantScoped(new MemoryQueue());
  registerRedemptionConsumers(q);
  await q.start();
  await q.publish(type, envelope(type, payload));
  await q.drain();
  await q.stop();
  return (q as unknown as MemoryQueue).dlq;
}

const enrolmentRow = async () =>
  (await tx((t) => t.select().from(enrolments).where(eq(enrolments.id, ENROLMENT))))[0]!;
const outboxCount = async () =>
  (await tx((t) => t.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))).length;
const seedRedemption = (id: string) =>
  tx((t) => t.insert(redemptions).values({
    id, tenantId: TENANT, enrolmentId: ENROLMENT, points: 100n, rewardType: "voucher",
    status: "pending", createdBy: ACTOR, version: 1,
  }));

beforeAll(seed);
beforeEach(seed);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("CLOS3-S5-02 adjustBalance result is enforced inside the consumer tx", () => {
  it("redeemPoints with a stale enrolmentVersion rolls back the redemption row, event and audit", async () => {
    const id = randomUUID();
    const dlq = await run(COMMANDS.redeemPoints, {
      id, enrolmentId: ENROLMENT, memberId: randomUUID(), points: 100,
      rewardType: "voucher", status: "pending", enrolmentVersion: 4, // actual is 5
    });
    expect(dlq).toHaveLength(1);
    const rows = await tx((t) => t.select().from(redemptions).where(eq(redemptions.id, id)));
    expect(rows, "ledger row must not commit without a balance effect").toHaveLength(0);
    expect(await outboxCount()).toBe(0);
    const e = await enrolmentRow();
    expect(e.pointsBalance).toBe(START);
    expect(e.version).toBe(5);
  });

  it("redeemPoints with the current version still deducts the balance", async () => {
    const id = randomUUID();
    const dlq = await run(COMMANDS.redeemPoints, {
      id, enrolmentId: ENROLMENT, memberId: randomUUID(), points: 100,
      rewardType: "voucher", status: "pending", enrolmentVersion: 5,
    });
    expect(dlq).toHaveLength(0);
    expect((await enrolmentRow()).pointsBalance).toBe(START - 100n);
    expect(await tx((t) => t.select().from(redemptions).where(eq(redemptions.id, id)))).toHaveLength(1);
  });

  it("voidRedemption whose balance restore loses the optimistic lock rolls back the void", async () => {
    const id = randomUUID();
    await seedRedemption(id);
    force.lose = true; // a concurrent writer bumped the version: guarded UPDATE matches 0 rows
    const dlq = await run(COMMANDS.voidRedemption, {
      id, reason: "r", version: 1, enrolmentId: ENROLMENT, points: "100",
    });
    force.lose = false;
    expect(dlq).toHaveLength(1);
    const [row] = await tx((t) => t.select().from(redemptions).where(eq(redemptions.id, id)));
    expect(row!.status, "void must roll back with the failed restore").toBe("pending");
    expect(await outboxCount()).toBe(0);
    expect((await enrolmentRow()).pointsBalance).toBe(START);
  });

  it("voidRedemption on the healthy path restores the balance", async () => {
    const id = randomUUID();
    await seedRedemption(id);
    const dlq = await run(COMMANDS.voidRedemption, {
      id, reason: "r", version: 1, enrolmentId: ENROLMENT, points: "100",
    });
    expect(dlq).toHaveLength(0);
    expect((await enrolmentRow()).pointsBalance).toBe(START + 100n);
  });
});
