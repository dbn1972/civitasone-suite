/**
 * Resolution Sanction Intake — consumer + RLS integration tests (DB-backed).
 *
 * Proves the cross-service choreography money-path:
 *  - meeting.decision.financial -> a PENDING REVIEW intake row (no auto-sanction)
 *  - replay (same messageId) is a no-op (transactional inbox)
 *  - replay (same decisionId, different messageId) does not duplicate (unique intake)
 *  - RLS/tenant isolation: tenant B cannot see tenant A's intake
 *  - list query returns pending items
 *
 * Runs against the live civitas_finance DB (DATABASE_URL from vitest.config.ts).
 * RLS-aware: seed + query paths run inside runWithTenant so SET LOCAL app.tenant_id
 * is applied and the budget.current_tenant_id() policy is enforced.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerResolutionIntakeConsumers } from "../src/modules/resolution-intake/consumer.js";
import * as queries from "../src/modules/resolution-intake/queries.js";

const TOPIC = "meeting.decision.financial";

type Handler = (msg: any) => Promise<void>;
class TestQueue {
  private handlers = new Map<string, Handler[]>();
  subscribe(topic: string, handler: Handler): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
  }
  async deliver(topic: string, msg: any): Promise<void> {
    for (const h of this.handlers.get(topic) ?? []) await h(msg);
  }
}

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();

function makeMsg(tenantId: string, decisionId: string, overrides: Record<string, unknown> = {}) {
  return {
    messageId: randomUUID(),
    tenantId,
    actorId: ACTOR,
    correlationId: randomUUID(),
    payload: {
      decisionId,
      meetingId: randomUUID(),
      text: "Board resolved to sanction Rs. 5,00,000 for the new e-governance rollout.",
      financialImplication: "50000000", // paise
      currency: "INR",
      authority: "Governing Council",
      effectiveDate: "2026-08-01",
      ...overrides,
    },
  };
}

async function rawCountUnderTenant(tenantId: string): Promise<number> {
  return runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      const r: any = await tx.execute(
        sql`SELECT count(*)::int AS c FROM budget.finance_resolution_sanction_intake`,
      );
      const rows = Array.isArray(r) ? r : r.rows ?? [];
      return Number(rows[0]?.c ?? 0);
    }),
  ) as Promise<number>;
}

const queue = new TestQueue();

beforeAll(() => {
  registerResolutionIntakeConsumers(queue as any);
});

afterAll(async () => {
  for (const tid of [TENANT_A, TENANT_B]) {
    await runWithTenant(tid, () =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`DELETE FROM budget.finance_resolution_sanction_intake WHERE tenant_id = ${tid}::uuid`,
        );
      }),
    );
  }
  await sqlClient.end();
});

describe("resolution-intake consumer (meeting.decision.financial)", () => {
  const decisionId = randomUUID();

  it("creates a pending_review intake row from a board financial decision", async () => {
    await queue.deliver(TOPIC, makeMsg(TENANT_A, decisionId));

    const res = await runWithTenant(TENANT_A, () =>
      queries.listIntake(TENANT_A, { status: "pending_review", page: 1, pageSize: 50 }),
    );
    expect(res.total).toBe(1);
    const row = res.data[0]!;
    expect(row.decisionId).toBe(decisionId);
    expect(row.status).toBe("pending_review");
    expect(row.amountMinor).toBe("50000000");
    expect(row.currency).toBe("INR");
    expect(row.source).toBe("meeting");
    expect(row.authority).toBe("Governing Council");
  });

  it("does NOT auto-create any real sanction (intake only)", async () => {
    // The intake table is the ONLY thing written for finance; the sanction table
    // is untouched by this decision (no sanctionNo linked to this decision).
    const res = await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const r: any = await tx.execute(
          sql`SELECT count(*)::int AS c FROM budget.finance_sanctions WHERE tenant_id = ${TENANT_A}::uuid`,
        );
        const rows = Array.isArray(r) ? r : r.rows ?? [];
        return Number(rows[0]?.c ?? 0);
      }),
    );
    expect(res).toBe(0);
  });

  it("replay of the SAME messageId is a no-op (transactional inbox)", async () => {
    const msg = makeMsg(TENANT_A, randomUUID());
    await queue.deliver(TOPIC, msg);
    const before = await rawCountUnderTenant(TENANT_A);
    await queue.deliver(TOPIC, msg); // identical messageId
    const after = await rawCountUnderTenant(TENANT_A);
    expect(after).toBe(before);
  });

  it("replay of the SAME decisionId with a NEW messageId does not duplicate", async () => {
    const dId = randomUUID();
    await queue.deliver(TOPIC, makeMsg(TENANT_A, dId));
    await queue.deliver(TOPIC, makeMsg(TENANT_A, dId)); // new messageId, same decisionId
    const res = await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const r: any = await tx.execute(
          sql`SELECT count(*)::int AS c FROM budget.finance_resolution_sanction_intake WHERE tenant_id = ${TENANT_A}::uuid AND decision_id = ${dId}::uuid`,
        );
        const rows = Array.isArray(r) ? r : r.rows ?? [];
        return Number(rows[0]?.c ?? 0);
      }),
    );
    expect(res).toBe(1);
  });

  it("RLS: tenant B cannot see tenant A's intake rows", async () => {
    // Seed one row for tenant B.
    await queue.deliver(TOPIC, makeMsg(TENANT_B, randomUUID()));

    const seenByA = await rawCountUnderTenant(TENANT_A);
    const seenByB = await rawCountUnderTenant(TENANT_B);

    expect(seenByA).toBeGreaterThanOrEqual(1);
    expect(seenByB).toBe(1); // B sees only its own single row, none of A's

    // list query is also tenant-scoped
    const bList = await runWithTenant(TENANT_B, () =>
      queries.listIntake(TENANT_B, { status: "pending_review", page: 1, pageSize: 50 }),
    );
    expect(bList.data.every((r) => r.tenantId === TENANT_B)).toBe(true);
  });

  it("tolerates a decision with no financialImplication (amount defaults to 0)", async () => {
    const dId = randomUUID();
    await queue.deliver(
      TOPIC,
      makeMsg(TENANT_A, dId, { financialImplication: undefined, currency: undefined }),
    );
    const res = await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const r: any = await tx.execute(
          sql`SELECT amount_minor::text AS a, currency FROM budget.finance_resolution_sanction_intake WHERE tenant_id = ${TENANT_A}::uuid AND decision_id = ${dId}::uuid`,
        );
        const rows = Array.isArray(r) ? r : r.rows ?? [];
        return rows[0];
      }),
    );
    expect(res?.a).toBe("0");
    expect(res?.currency).toBe("INR");
  });
});
