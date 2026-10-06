/**
 * GAP-REVENUE-RECOVERY-01 (consumer level, DB-backed): the recovery-referral
 * gate must use the CURRENT outstanding balance, which is the sum of the LATEST
 * dcb entry per demand — `dcb_entries.balance_minor` is a running balance, so
 * summing every row would count a fully paid demand (charge 100 + receipt 0)
 * as 100 owed and let a coercive referral through for someone who owes nothing.
 *
 * Runs the real revenue.recovery.refer consumer against the test Postgres
 * named by DATABASE_URL (RLS tenant GUC set per transaction); only the outbox
 * and cache are stubbed.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";

const TENANT = "0000aaaa-0000-0000-0000-0000000004aa";
const ACTOR = "0000bbbb-0000-0000-0000-0000000004bb";
const PAID = "0000cccc-0000-0000-0000-000000000401";
const OWING = "0000cccc-0000-0000-0000-000000000402";
const PARTIAL = "0000cccc-0000-0000-0000-000000000403";
const D1 = "0000dddd-0000-0000-0000-000000000401";
const D2 = "0000dddd-0000-0000-0000-000000000402";
const D3 = "0000dddd-0000-0000-0000-000000000403";
const D4 = "0000dddd-0000-0000-0000-000000000404";

const raw = postgres(process.env.DATABASE_URL!, { max: 2 });

vi.mock("../src/shared/db.js", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const client = pg(process.env.DATABASE_URL!, { max: 2 });
  const d = drizzle(client);
  return {
    db: {
      transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        d.transaction(async (tx) => {
          await tx.execute(
            (await import("drizzle-orm")).sql`SELECT set_config('app.tenant_id', ${"0000aaaa-0000-0000-0000-0000000004aa"}, true)`,
          );
          return fn(tx);
        }),
    },
  };
});
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn().mockResolvedValue(true),
  enqueue: (...a: unknown[]) => mockEnqueue(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn().mockResolvedValue(undefined), getOrLoad: vi.fn() },
  queue: { subscribe: vi.fn(), publish: vi.fn() },
}));

import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";

type Handler = (msg: unknown) => Promise<void>;
const handlers: Record<string, Handler> = {};

async function inTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return raw.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function entry(
  tx: postgres.TransactionSql,
  assessee: string, demand: string, type: string, amount: number, balance: number, at: string,
) {
  await tx`
    INSERT INTO assessment.dcb_entries (tenant_id, assessee_id, demand_id, entry_type, amount_minor, balance_minor, created_at, created_by)
    VALUES (${TENANT}, ${assessee}, ${demand}, ${type}, ${amount}, ${balance}, ${at}, ${ACTOR})`;
}

async function cleanup() {
  await inTenant(async (tx) => {
    await tx`DELETE FROM assessment.dcb_entries WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM arrears.recovery_referrals WHERE tenant_id = ${TENANT}`;
  });
}

beforeAll(async () => {
  await cleanup();
  await inTenant(async (tx) => {
    // PAID: charge 100 then a receipt taking the running balance to 0.
    await entry(tx, PAID, D1, "demand", 100, 100, "2026-01-01T00:00:00Z");
    await entry(tx, PAID, D1, "collection", 100, 0, "2026-02-01T00:00:00Z");
    // OWING: charge only.
    await entry(tx, OWING, D2, "demand", 100, 100, "2026-01-01T00:00:00Z");
    // PARTIAL: D3 fully paid (0), D4 still owes 70 after a part payment.
    await entry(tx, PARTIAL, D3, "demand", 50, 50, "2026-01-01T00:00:00Z");
    await entry(tx, PARTIAL, D3, "collection", 50, 0, "2026-01-05T00:00:00Z");
    await entry(tx, PARTIAL, D4, "demand", 100, 100, "2026-01-01T00:00:00Z");
    await entry(tx, PARTIAL, D4, "collection", 30, 70, "2026-01-09T00:00:00Z");
  });
  registerArrearsConsumers({
    subscribe: (t: string, h: Handler) => { handlers[t] = h; },
  } as never);
});
beforeEach(() => {
  mockEnqueue.mockClear();
});
afterAll(async () => {
  await cleanup();
  await raw.end();
});

const msg = (assesseeId: string) => ({
  messageId: `m-${assesseeId}`, tenantId: TENANT, actorId: ACTOR, correlationId: "c-1",
  payload: { assesseeId, reason: "chronic default" },
});
const referrals = (assessee: string) =>
  inTenant(async (tx) => tx`SELECT id FROM arrears.recovery_referrals WHERE tenant_id = ${TENANT} AND assessee_id = ${assessee}`);

describe("recoveryRefer gate uses the latest balance per demand (GAP-REVENUE-RECOVERY-01)", () => {
  it("rejects a referral for a fully PAID assessee (running balances 100 then 0) and writes nothing", async () => {
    await expect(handlers["revenue.recovery.refer"]!(msg(PAID))).rejects.toThrow(/outstanding arrears/i);
    expect(await referrals(PAID)).toHaveLength(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("accepts a referral for an assessee that genuinely owes (charge, no payment)", async () => {
    await handlers["revenue.recovery.refer"]!(msg(OWING));
    expect(await referrals(OWING)).toHaveLength(1);
  });

  it("accepts a partly-paid assessee: one demand cleared, one still owing 70", async () => {
    await handlers["revenue.recovery.refer"]!(msg(PARTIAL));
    expect(await referrals(PARTIAL)).toHaveLength(1);
  });
});
