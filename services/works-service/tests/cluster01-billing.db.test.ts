/**
 * W2 works rescan, cluster 01: the REAL billing consumers and proposal repo against the REAL Postgres (works_svc,
 * NOBYPASSRLS, FORCE RLS) for the rules this cluster added.
 *
 *  - GAP-WORKS-BILLING-BILLS-NEW-05    bill number unique per work (case-insensitive), including under concurrency;
 *                                      a zero/negative gross and a negative deduction never reach the table;
 *                                      net payable is exact paise (gross - deductions)
 *  - GAP-WORKS-BILLING-MEASUREMENTS-NEW-05  only a draft MB takes a measurement; numeric(12,4) bound is storable
 *  - GAP-WORKS-APPROVALS-TS-NEW-01     work picker search returns status and ranks eligible works first
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { awards } from "../src/modules/tender/schema.js";
import { boqItems } from "../src/modules/boq/schema.js";
import { workProposals } from "../src/modules/proposal/schema.js";
import { bills, measurementBooks, measurements } from "../src/modules/billing/schema.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";
import { billNumberLockKey } from "../src/modules/billing/domain.js";
import { searchProposals, resolveProposals } from "../src/modules/proposal/repo.js";

const TENANT = "dddddddd-7777-4000-8000-0000000000d1";
const OTHER_TENANT = "dddddddd-7777-4000-8000-0000000000d2";
const MAKER = "00000000-aaaa-4000-8000-0000000000f1";

type Handler = (msg: unknown) => Promise<void>;
const handlers: Record<string, Handler> = {};
registerBillingConsumers({ subscribe: (t: string, fn: Handler) => { handlers[t] = fn; } } as never);

function msg(payload: Record<string, unknown>, messageId = randomUUID()) {
  return { messageId, tenantId: TENANT, actorId: MAKER, correlationId: `c01-${messageId}`, schemaVersion: "1.0", payload };
}
const deliver = (command: string, payload: Record<string, unknown>) =>
  runWithTenant(TENANT, () => handlers[command]!(msg(payload)));
const inTx = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

afterAll(async () => {
  for (const tenant of [TENANT, OTHER_TENANT]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${tenant}, true)`;
      for (const t of ["works.bill_items", "works.bills", "works.measurements", "works.measurement_books", "works.boq_items", "works.awards", "works.work_proposals"]) {
        await sql.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${tenant}'`);
      }
    });
  }
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id IN (${TENANT}, ${OTHER_TENANT})`;
  await sqlClient.end();
});

/** A work with an award, one BoQ item (rate 100 paise), a finalized MB and measurements worth 1,000,000 paise. */
async function seedBillableWork(mbStatus = "do_finalized") {
  const workId = randomUUID();
  const awardId = randomUUID();
  const mbId = randomUUID();
  const boqId = randomUUID();
  await inTx(async (tx) => {
    await tx.insert(awards).values({ id: awardId, tenantId: TENANT, workId, contractorName: "Acme", acceptedAmountMinor: 100000000n, createdBy: MAKER });
    await tx.insert(boqItems).values({
      id: boqId, tenantId: TENANT, workId, itemDescription: "Earthwork", unit: "cum", rate: 100n, quantity: "100000", amountMinor: 10000000n, createdBy: MAKER,
    });
    await tx.insert(measurementBooks).values({
      id: mbId, tenantId: TENANT, workId, awardId, mbNumber: `MB-${mbId.slice(0, 6)}`, issuedBy: MAKER, status: mbStatus, createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(measurements).values({
      id: randomUUID(), tenantId: TENANT, mbId, boqItemId: boqId, quantity: "10000", createdBy: MAKER, updatedBy: MAKER,
    });
  });
  return { workId, awardId, mbId, boqId };
}

async function addFinalizedMb(w: { workId: string; awardId: string; boqId: string }) {
  const mbId = randomUUID();
  await inTx(async (tx) => {
    await tx.insert(measurementBooks).values({
      id: mbId, tenantId: TENANT, workId: w.workId, awardId: w.awardId, mbNumber: `MB-${mbId.slice(0, 6)}`, issuedBy: MAKER, status: "do_finalized", createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(measurements).values({
      id: randomUUID(), tenantId: TENANT, mbId, boqItemId: w.boqId, quantity: "10000", createdBy: MAKER, updatedBy: MAKER,
    });
  });
  return mbId;
}

const billsOf = (workId: string) => inTx((tx) => tx.select().from(bills).where(eq(bills.workId, workId)));
const billPayload = (w: { workId: string; awardId: string; mbId: string }, billNumber: string, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), workId: w.workId, awardId: w.awardId, mbId: w.mbId, billMode: "e_mb", billNumber, grossAmountMinor: "1000", ...extra,
});

describe("bill creation (real DB): number uniqueness per work", () => {
  it("refuses a repeated bill number on the same work, ignoring case and spaces, and leaves exactly one row", async () => {
    const w = await seedBillableWork();
    await deliver(COMMANDS.billCreate, billPayload(w, "RA-1"));
    await expect(deliver(COMMANDS.billCreate, billPayload(w, "  ra-1 "))).rejects.toThrow(/DUPLICATE_BILL_NUMBER/);
    const rows = await billsOf(w.workId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.billNumber).toBe("RA-1");
  });

  it("allows the same number on another work, and a different number on the same work", async () => {
    const a = await seedBillableWork();
    const b = await seedBillableWork();
    await deliver(COMMANDS.billCreate, billPayload(a, "RA-7"));
    await deliver(COMMANDS.billCreate, billPayload(b, "RA-7"));
    await deliver(COMMANDS.billCreate, billPayload(a, "RA-8"));
    expect(await billsOf(a.workId)).toHaveLength(2);
    expect(await billsOf(b.workId)).toHaveLength(1);
  });

  it("billCreate queues behind the per-work lock: while another transaction holds it the create does not run, and it completes once the lock is released", async () => {
    const w = await seedBillableWork();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let lockTaken!: () => void;
    const taken = new Promise<void>((r) => { lockTaken = r; });
    const holder = sqlClient.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${billNumberLockKey(TENANT, w.workId)}, 0))`;
      lockTaken();
      await held;
    });
    await taken;
    let done = false;
    const create = deliver(COMMANDS.billCreate, billPayload(w, "RA-LOCKED")).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 500));
    expect(done).toBe(false); // blocked on the lock, nothing written yet
    expect(await billsOf(w.workId)).toHaveLength(0);
    release();
    await holder;
    await create;
    expect(done).toBe(true);
    expect(await billsOf(w.workId)).toHaveLength(1);
  });

  it("two simultaneous creates of the same number against DIFFERENT MBs: exactly one wins (the per-work lock serialises them)", async () => {
    const w = await seedBillableWork();
    const mb2 = await addFinalizedMb(w);
    const results = await Promise.allSettled([
      deliver(COMMANDS.billCreate, billPayload(w, "RA-RACE")),
      deliver(COMMANDS.billCreate, billPayload({ ...w, mbId: mb2 }, "RA-RACE")),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(String(failed[0]!.reason)).toMatch(/DUPLICATE_BILL_NUMBER/);
    expect(await billsOf(w.workId)).toHaveLength(1);
  });
});

describe("bill creation (real DB): amounts", () => {
  for (const [label, extra, pattern] of [
    ["a zero gross", { grossAmountMinor: "0" }, /INVALID_AMOUNT/],
    ["a negative gross", { grossAmountMinor: "-1000" }, /INVALID_AMOUNT/],
    ["a negative deduction", { deductionsMinor: "-1" }, /INVALID_AMOUNT/],
  ] as const) {
    it(`${label} never reaches the table`, async () => {
      const w = await seedBillableWork();
      await expect(deliver(COMMANDS.billCreate, billPayload(w, "RA-X", extra))).rejects.toThrow(pattern);
      expect(await billsOf(w.workId)).toHaveLength(0);
    });
  }

  it("stores gross, deductions and net payable as exact paise (100000 - 25050 = 74950), and zero deductions leave net = gross", async () => {
    const w = await seedBillableWork();
    await deliver(COMMANDS.billCreate, billPayload(w, "RA-EXACT", { grossAmountMinor: "100000", deductionsMinor: "25050" }));
    await deliver(COMMANDS.billCreate, billPayload(w, "RA-ZERO", { grossAmountMinor: "50000", deductionsMinor: "0" }));
    const rows = await billsOf(w.workId);
    const exact = rows.find((r) => r.billNumber === "RA-EXACT")!;
    expect([exact.grossAmountMinor, exact.deductionsMinor, exact.netPayableMinor]).toEqual([100000n, 25050n, 74950n]);
    const zero = rows.find((r) => r.billNumber === "RA-ZERO")!;
    expect([zero.grossAmountMinor, zero.deductionsMinor, zero.netPayableMinor]).toEqual([50000n, 0n, 50000n]);
  });

  it("the measured-value ceiling still binds: 1,000,000 paise measured, 600,000 billed, 400,001 refused, 400,000 accepted", async () => {
    const w = await seedBillableWork();
    await deliver(COMMANDS.billCreate, billPayload(w, "RA-A", { grossAmountMinor: "600000" }));
    await expect(deliver(COMMANDS.billCreate, billPayload(w, "RA-B", { grossAmountMinor: "400001" }))).rejects.toThrow(/MEASURED_VALUE_EXCEEDED/);
    await deliver(COMMANDS.billCreate, billPayload(w, "RA-C", { grossAmountMinor: "400000" }));
    expect(await billsOf(w.workId)).toHaveLength(2);
  });
});

describe("measurement recording (real DB): only a draft MB takes a measurement", () => {
  const record = (mbId: string, boqItemId: string, extra: Record<string, unknown> = {}) =>
    deliver(COMMANDS.measurementRecord, { id: randomUUID(), mbId, boqItemId, quantity: 5, ...extra });
  const rowsOf = (mbId: string) => inTx((tx) => tx.select().from(measurements).where(eq(measurements.mbId, mbId)));

  it("records against a draft MB, including a dimension at the numeric(12,4) limit", async () => {
    const w = await seedBillableWork("draft");
    const before = (await rowsOf(w.mbId)).length;
    await record(w.mbId, w.boqId, { lengthVal: 99999999.9999, depthVal: -99999999.9999, numberVal: 2 });
    const after = await rowsOf(w.mbId);
    expect(after).toHaveLength(before + 1);
    const row = after.find((r) => r.lengthVal === "99999999.9999")!;
    expect(row.depthVal).toBe("-99999999.9999");
  });

  for (const status of ["so_finalized", "sdo_finalized", "estimator_finalized", "do_finalized"]) {
    it(`refuses a measurement against an MB that is '${status}': no row, and the billing ceiling does not move`, async () => {
      const w = await seedBillableWork(status);
      const before = await rowsOf(w.mbId);
      await expect(record(w.mbId, w.boqId)).rejects.toThrow(/MB_NOT_OPEN/);
      expect(await rowsOf(w.mbId)).toHaveLength(before.length);
    });
  }

  it("an MB finalized after the command was queued is refused by the consumer's own check (the route check can race)", async () => {
    const w = await seedBillableWork("draft");
    await inTx((tx) => tx.update(measurementBooks).set({ status: "so_finalized" }).where(eq(measurementBooks.id, w.mbId)));
    await expect(record(w.mbId, w.boqId)).rejects.toThrow(/MB_NOT_OPEN/);
  });
});

describe("work picker search (real DB): status is returned and eligible works rank first", () => {
  async function seedProposal(workNumber: string, status: string, createdAt: Date, tenant = TENANT) {
    const id = randomUUID();
    await runWithTenant(tenant, () =>
      db.transaction((tx) =>
        tx.insert(workProposals).values({
          id, tenantId: tenant, workNumber, category: "regular", description: `Canal lining ${workNumber}`, workTypeId: randomUUID(),
          estimatedCostMinor: 100000n, status, createdBy: MAKER, updatedBy: MAKER, createdAt,
        }),
      ),
    );
    return id;
  }
  const search = (q: string, limit: number, prefer: string[], tenant = TENANT) =>
    runWithTenant(tenant, () => searchProposals(tenant, q, limit, prefer));

  it("returns the status, newest first by default", async () => {
    const tag = `NEWEST${randomUUID().slice(0, 6)}`;
    await seedProposal(`${tag}/old`, "dao_finalized", new Date("2026-01-01T00:00:00Z"));
    await seedProposal(`${tag}/new`, "draft", new Date("2026-03-01T00:00:00Z"));
    const rows = await search(tag, 20, []);
    expect(rows.map((r) => [r.workNumber, r.status])).toEqual([[`${tag}/new`, "draft"], [`${tag}/old`, "dao_finalized"]]);
  });

  it("with a preference, eligible works sort first even when newer ineligible ones exist, so a capped result cannot hide them", async () => {
    const tag = `PREFER${randomUUID().slice(0, 6)}`;
    await seedProposal(`${tag}/eligible-old`, "dao_finalized", new Date("2026-01-01T00:00:00Z"));
    await seedProposal(`${tag}/ts-eligible`, "ts_eligible", new Date("2026-01-02T00:00:00Z"));
    await seedProposal(`${tag}/draft-new-1`, "draft", new Date("2026-03-01T00:00:00Z"));
    await seedProposal(`${tag}/draft-new-2`, "draft", new Date("2026-03-02T00:00:00Z"));
    const capped = await search(tag, 2, ["dao_finalized", "ts_eligible"]);
    expect(capped.map((r) => r.status).sort()).toEqual(["dao_finalized", "ts_eligible"]);
    const all = await search(tag, 20, ["dao_finalized", "ts_eligible"]);
    expect(all.slice(0, 2).every((r) => r.status === "dao_finalized" || r.status === "ts_eligible")).toBe(true);
    expect(all.slice(2).map((r) => r.workNumber)).toEqual([`${tag}/draft-new-2`, `${tag}/draft-new-1`]);
  });

  it("is tenant-scoped: another tenant's works never appear", async () => {
    const tag = `TENANT${randomUUID().slice(0, 6)}`;
    await seedProposal(`${tag}/mine`, "dao_finalized", new Date("2026-01-01T00:00:00Z"));
    await seedProposal(`${tag}/theirs`, "dao_finalized", new Date("2026-01-02T00:00:00Z"), OTHER_TENANT);
    const mine = await search(tag, 20, []);
    expect(mine.map((r) => r.workNumber)).toEqual([`${tag}/mine`]);
  });

  it("resolveProposals returns the status too, and never another tenant's row", async () => {
    const tag = `RESOLVE${randomUUID().slice(0, 6)}`;
    const mine = await seedProposal(`${tag}/mine`, "ts_eligible", new Date("2026-01-01T00:00:00Z"));
    const theirs = await seedProposal(`${tag}/theirs`, "dao_finalized", new Date("2026-01-02T00:00:00Z"), OTHER_TENANT);
    const rows = await runWithTenant(TENANT, () => resolveProposals(TENANT, [mine, theirs]));
    expect(rows.map((r) => [r.id, r.status])).toEqual([[mine, "ts_eligible"]]);
  });
});
