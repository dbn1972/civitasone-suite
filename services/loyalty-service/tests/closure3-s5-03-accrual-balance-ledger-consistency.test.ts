/**
 * CLOS3-S5-03 -- accruePoints inserted the accrual ledger row then ignored the
 * result of the version-guarded balance UPDATE. A stale enrolmentVersion (or
 * two concurrent accruals sharing one version) committed a ledger row, event
 * and audit with pointsBalance / lifetimePoints unchanged, so ledger and
 * balance diverged.
 *
 * Real Postgres (non-superuser role, FORCE RLS), real MemoryQueue (handler
 * errors land in q.dlq). Invariant asserted: SUM(accruals.points) ==
 * points_balance - opening balance, always.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { programs } from "../src/modules/programs/schema.js";
import { enrolments } from "../src/modules/enrolments/schema.js";
import { accruals } from "../src/modules/accruals/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerAccrualConsumers } from "../src/modules/accruals/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const force = vi.hoisted(() => ({ fail: false }));
vi.mock("../src/modules/enrolments/repo.js", async (orig) => {
  const m = await orig<typeof import("../src/modules/enrolments/repo.js")>();
  return {
    ...m,
    creditPoints: (...a: Parameters<typeof m.creditPoints>) =>
      force.fail ? Promise.resolve(false) : m.creditPoints(...a),
  };
});

const TENANT = "c3a50300-dead-4000-8000-0000000ba103";
const ACTOR = "c3a50300-dead-4000-8000-0000000ac703";
const PROGRAM = "c3a50300-dead-4000-8000-000000000ba3";
const ENROLMENT = "c3a50300-dead-4000-8000-0000000e0103";
const START = 1000n;

const tx = <T>(fn: (t: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

async function clean() {
  await tx(async (t) => {
    await t.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await t.delete(accruals).where(eq(accruals.tenantId, TENANT));
    await t.delete(enrolments).where(eq(enrolments.tenantId, TENANT));
    await t.delete(programs).where(eq(programs.tenantId, TENANT));
  });
}

async function seed() {
  await clean();
  await tx(async (t) => {
    await t.insert(programs).values({
      id: PROGRAM, tenantId: TENANT, name: "S5-03 fixture", status: "active",
      earnRatio: 100n, createdBy: ACTOR, updatedBy: ACTOR,
    });
    await t.insert(enrolments).values({
      id: ENROLMENT, tenantId: TENANT, programId: PROGRAM, profileId: randomUUID(),
      status: "active", tier: "base", pointsBalance: START, lifetimePoints: START,
      createdBy: ACTOR, updatedBy: ACTOR, version: 7,
    });
  });
}

const accrue = (version: number, points = 50) => ({
  id: randomUUID(), enrolmentId: ENROLMENT, points, source: "purchase",
  sourceRef: null, txType: "purchase", enrolmentVersion: version,
});

async function run(payloads: unknown[]) {
  const q = tenantScoped(new MemoryQueue());
  registerAccrualConsumers(q);
  await q.start();
  await Promise.all(
    payloads.map((payload) =>
      q.publish(COMMANDS.accruePoints, {
        messageId: randomUUID(), type: COMMANDS.accruePoints, tenantId: TENANT, actorId: ACTOR,
        correlationId: randomUUID(), schemaVersion: "1.0", payload,
      }),
    ),
  );
  await q.drain();
  await q.stop();
  return (q as unknown as MemoryQueue).dlq;
}

async function snapshot() {
  const [e] = await tx((t) => t.select().from(enrolments).where(eq(enrolments.id, ENROLMENT)));
  const ledger = await tx((t) => t.select().from(accruals).where(eq(accruals.tenantId, TENANT)));
  const events = await tx((t) => t.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  const sum = ledger.reduce((a, r) => a + r.points, 0n);
  return { e: e!, ledger, events, sum };
}

beforeAll(seed);
beforeEach(seed);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("CLOS3-S5-03 accrual ledger and balance never diverge", () => {
  it("a stale enrolmentVersion still credits the balance (ledger sum == balance delta)", async () => {
    const dlq = await run([accrue(6)]); // actual enrolment version is 7
    const s = await snapshot();
    expect(dlq).toHaveLength(0);
    expect(s.ledger).toHaveLength(1);
    expect(s.e.pointsBalance - START).toBe(s.sum);
    expect(s.e.lifetimePoints - START).toBe(s.sum);
  });

  it("concurrent accruals sharing one version are all applied exactly once", async () => {
    const dlq = await run([accrue(7), accrue(7), accrue(7), accrue(7)]);
    const s = await snapshot();
    expect(dlq).toHaveLength(0);
    expect(s.ledger).toHaveLength(4);
    expect(s.e.pointsBalance - START).toBe(s.sum);
    expect(s.sum).toBe(200n);
  });

  it("if the credit cannot be applied the ledger row, event and audit roll back", async () => {
    force.fail = true;
    const dlq = await run([accrue(7)]);
    force.fail = false;
    const s = await snapshot();
    expect(dlq).toHaveLength(1);
    expect(s.ledger).toHaveLength(0);
    expect(s.events).toHaveLength(0);
    expect(s.e.pointsBalance).toBe(START);
  });

  it("an accrual for a non-existent enrolment writes no ledger row", async () => {
    const dlq = await run([{ ...accrue(7), enrolmentId: randomUUID() }]);
    const s = await snapshot();
    expect(dlq).toHaveLength(1);
    expect(s.ledger).toHaveLength(0);
  });
});
