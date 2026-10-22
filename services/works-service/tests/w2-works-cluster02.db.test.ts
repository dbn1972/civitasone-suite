/**
 * W2 works rescan, cluster 02: REAL consumers and repos against the REAL Postgres (works_svc, NOBYPASSRLS, FORCE RLS).
 *
 *  GAP-WORKS-BILLING-WORKID-07     a repeated finalize (new messageId, same step) applies ONCE: one status write, one
 *                                  event, and for the DO step ONE finance hand-off; an out-of-order step is refused
 *  GAP-WORKS-BOQ-NEW-05            BR-015: a line cannot be added once a pre-tender exists; a non-positive rate is refused
 *  GAP-WORKS-BOQ-WORKID-05         a recapitulation is computed on the stored BoQ lines, to the exact paisa; a work has
 *                                  ONE of them: a repeat or a racing double submit is refused (RECAP_EXISTS) and the
 *                                  stored figures never move
 *  GAP-WORKS-CONTRACTORS-03/-06    the register count and page window come from the database
 *  GAP-WORKS-CONTRACTORS-DETAIL-04 a configured cooling-off period is enforced in the writing transaction; the audit
 *                                  event carries the stated reason; a rating can name the work it is about
 */
import { randomUUID, randomBytes } from "node:crypto";
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS, FINANCE_HANDOFF } from "../src/topics.js";
import { awards, preTenders } from "../src/modules/tender/schema.js";
import { bills, measurementBooks } from "../src/modules/billing/schema.js";
import { boqItems, recapitulation } from "../src/modules/boq/schema.js";
import { technicalSanctions } from "../src/modules/approval/schema.js";
import { workProposals } from "../src/modules/proposal/schema.js";
import { contractors, contractorRatings } from "../src/modules/contractor/schema.js";
import * as contractorRepo from "../src/modules/contractor/repo.js";
import * as boqRepo from "../src/modules/boq/repo.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";
import { registerBoqConsumers } from "../src/modules/boq/consumer.js";
import { registerContractorConsumers } from "../src/modules/contractor/consumer.js";

// Contractor PAN is encrypted at rest; the suite needs a key. Generated per run, never committed.
process.env.PII_ENC_KEY ??= randomBytes(32).toString("hex");

const TENANT = "dddddddd-6666-4000-8000-0000000000e2";
const MAKER = "00000000-aaaa-4000-8000-0000000000e1";
const CHECKER = "00000000-aaaa-4000-8000-0000000000e2";
const OTHER_OFFICER = "00000000-aaaa-4000-8000-0000000000e3";

type Handler = (msg: unknown) => Promise<void>;
function collect(register: (q: never) => void): Record<string, Handler> {
  const h: Record<string, Handler> = {};
  register({ subscribe: (t: string, fn: Handler) => { h[t] = fn; } } as never);
  return h;
}
const handlers = {
  ...collect(registerBillingConsumers as never),
  ...collect(registerBoqConsumers as never),
  ...collect(registerContractorConsumers as never),
};

function msg(actorId: string, payload: Record<string, unknown>, messageId = randomUUID()) {
  return { messageId, tenantId: TENANT, actorId, correlationId: `w2c02-${messageId}`, schemaVersion: "1.0", payload };
}
function deliver(command: string, m: ReturnType<typeof msg>): Promise<void> {
  return runWithTenant(TENANT, () => handlers[command]!(m));
}
const inTx = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

async function outbox(topic: string, match: Record<string, string>): Promise<Array<{ payload: Record<string, unknown> }>> {
  const rows = await sqlClient`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = ${topic}`;
  return (rows as unknown as Array<{ payload: Record<string, unknown> }>).filter((r) =>
    Object.entries(match).every(([k, v]) => String(r.payload[k]) === v));
}

afterEach(() => { delete process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS; });

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const t of [
      "works.recapitulation", "works.boq_items", "works.technical_sanctions", "works.bills", "works.measurement_books",
      "works.pre_tenders", "works.awards", "works.contractor_ratings", "works.contractors", "works.work_proposals",
    ]) {
      await sql.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`);
    }
  });
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  await sqlClient.end();
});

async function seedAward(): Promise<{ awardId: string; workId: string }> {
  const awardId = randomUUID();
  const workId = randomUUID();
  await inTx(async (tx) => {
    await tx.insert(awards).values({ id: awardId, tenantId: TENANT, workId, contractorName: "Acme", acceptedAmountMinor: 100000000n, createdBy: MAKER });
  });
  return { awardId, workId };
}

async function seedBill(status: string): Promise<{ billId: string; awardId: string; workId: string }> {
  const a = await seedAward();
  const billId = randomUUID();
  await inTx(async (tx) => {
    await tx.insert(bills).values({
      id: billId, tenantId: TENANT, workId: a.workId, awardId: a.awardId, billMode: "abstract",
      billNumber: `RA-${billId.slice(0, 6)}`, grossAmountMinor: 1000n, netPayableMinor: 900n, status, createdBy: MAKER,
    });
  });
  return { billId, ...a };
}

const billStatus = async (id: string) => (await inTx((tx) => tx.select().from(bills).where(eq(bills.id, id))))[0]!.status;
const mbStatus = async (id: string) => (await inTx((tx) => tx.select().from(measurementBooks).where(eq(measurementBooks.id, id))))[0]!.status;

describe("bill finalize is idempotent (real DB, WORKID-07)", () => {
  it("two finalize commands for the same step (different messageIds) apply once: one status write, one event", async () => {
    const { billId } = await seedBill("draft");
    await deliver(COMMANDS.billFinalize, msg(CHECKER, { id: billId, nextStatus: "so_finalized" }));
    await deliver(COMMANDS.billFinalize, msg(CHECKER, { id: billId, nextStatus: "so_finalized" }));
    expect(await billStatus(billId)).toBe("so_finalized");
    expect(await outbox(EVENTS.billFinalized, { id: billId })).toHaveLength(1);
    expect(await outbox("audit.event.record", { resourceId: billId, action: "finalize" })).toHaveLength(1);
  });

  it("the DO step replayed raises exactly ONE finance hand-off, not a second one with a fresh financeBillId", async () => {
    const { billId } = await seedBill("dao_finalized");
    await deliver(COMMANDS.billFinalize, msg(CHECKER, { id: billId, nextStatus: "do_finalized" }));
    await deliver(COMMANDS.billFinalize, msg(CHECKER, { id: billId, nextStatus: "do_finalized" }));
    expect(await billStatus(billId)).toBe("do_finalized");
    const handoffs = await outbox(FINANCE_HANDOFF.billCreate, { worksBillId: billId });
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.payload.grossMinor).toBe("1000");
    expect(handoffs[0]!.payload.netMinor).toBe("900");
  });

  it("two finalize commands racing at the same instant are serialised by the row lock: still one event", async () => {
    const { billId } = await seedBill("auditor_finalized");
    await Promise.all([
      deliver(COMMANDS.billFinalize, msg(CHECKER, { id: billId, nextStatus: "dao_finalized" })),
      deliver(COMMANDS.billFinalize, msg(OTHER_OFFICER, { id: billId, nextStatus: "dao_finalized" })),
    ]);
    expect(await billStatus(billId)).toBe("dao_finalized");
    expect(await outbox(EVENTS.billFinalized, { id: billId })).toHaveLength(1);
  });

  it("a step that is not the next one is refused as INVALID_STEP and leaves the bill and the outbox untouched", async () => {
    const { billId } = await seedBill("draft");
    const skip = msg(CHECKER, { id: billId, nextStatus: "dao_finalized" });
    await expect(deliver(COMMANDS.billFinalize, skip)).rejects.toBeInstanceOf(NonRetryableError);
    await expect(deliver(COMMANDS.billFinalize, msg(CHECKER, { id: billId, nextStatus: "dao_finalized" }))).rejects.toThrow(/INVALID_STEP/);
    expect(await billStatus(billId)).toBe("draft");
    expect(await outbox(EVENTS.billFinalized, { id: billId })).toHaveLength(0);
    expect(await outbox(FINANCE_HANDOFF.billCreate, { worksBillId: billId })).toHaveLength(0);
  });

  it("a finalize arriving after the bill has moved PAST that step does not roll it back", async () => {
    const { billId } = await seedBill("dao_finalized");
    await expect(deliver(COMMANDS.billFinalize, msg(CHECKER, { id: billId, nextStatus: "so_finalized" }))).rejects.toThrow(/INVALID_STEP/);
    expect(await billStatus(billId)).toBe("dao_finalized");
  });
});

describe("MB finalize is idempotent (real DB, WORKID-07)", () => {
  it("a replayed step applies once; an out-of-order step is refused", async () => {
    const a = await seedAward();
    const mbId = randomUUID();
    await deliver(COMMANDS.mbIssue, msg(MAKER, { id: mbId, workId: a.workId, awardId: a.awardId, mbNumber: `MB-${mbId.slice(0, 6)}` }));
    await deliver(COMMANDS.mbFinalize, msg(CHECKER, { id: mbId, nextStatus: "so_finalized" }));
    await deliver(COMMANDS.mbFinalize, msg(CHECKER, { id: mbId, nextStatus: "so_finalized" }));
    expect(await mbStatus(mbId)).toBe("so_finalized");
    expect(await outbox(EVENTS.mbFinalized, { id: mbId })).toHaveLength(1);
    await expect(deliver(COMMANDS.mbFinalize, msg(CHECKER, { id: mbId, nextStatus: "estimator_finalized" }))).rejects.toThrow(/INVALID_STEP/);
    expect(await mbStatus(mbId)).toBe("so_finalized");
  });
});

// ── BoQ ──────────────────────────────────────────────────────────────────────
async function seedWorkWithTs(): Promise<string> {
  const workId = randomUUID();
  await inTx(async (tx) => {
    await tx.insert(technicalSanctions).values({
      id: randomUUID(), tenantId: TENANT, workId, tsNumber: `TS/${workId.slice(0, 6)}`, tsDate: new Date(),
      tsAuthorityId: randomUUID(), tsAmountMinor: 100000000n, sanctionType: "original", status: "finalized", createdBy: MAKER,
    });
  });
  return workId;
}
const addLine = (workId: string, over: Record<string, unknown> = {}) =>
  deliver(COMMANDS.boqAddItem, msg(MAKER, {
    id: randomUUID(), workId, itemDescription: `Item ${randomUUID().slice(0, 6)}`, itemCode: `C-${randomUUID().slice(0, 6)}`,
    unit: "cum", rate: "12500", quantity: 3, ...over,
  }));
const linesOf = (workId: string) => inTx((tx) => tx.select().from(boqItems).where(eq(boqItems.workId, workId)));

describe("BoQ add rules (real DB, BOQ-NEW-04 / NEW-05)", () => {
  it("BR-015: once a pre-tender exists for the work a new line is refused (BOQ_FROZEN) and nothing is stored", async () => {
    const workId = await seedWorkWithTs();
    await addLine(workId, { itemCode: "OK-1" });
    await inTx(async (tx) => {
      await tx.insert(preTenders).values({ id: randomUUID(), tenantId: TENANT, workId, referenceNumber: `NIT/${workId.slice(0, 6)}`, createdBy: MAKER } as never);
    });
    await expect(addLine(workId, { itemCode: "LATE-1" })).rejects.toBeInstanceOf(NonRetryableError);
    await expect(addLine(workId, { itemCode: "LATE-2" })).rejects.toThrow(/BOQ_FROZEN/);
    expect((await linesOf(workId)).map((l) => l.itemCode)).toEqual(["OK-1"]);
  });

  it("a zero or negative rate is refused by the consumer too, with no row stored", async () => {
    const workId = await seedWorkWithTs();
    await expect(addLine(workId, { rate: "0" })).rejects.toThrow(/INVALID_AMOUNT/);
    await expect(addLine(workId, { rate: "-500" })).rejects.toThrow(/INVALID_AMOUNT/);
    await expect(addLine(workId, { quantity: -2 })).rejects.toThrow(/INVALID_AMOUNT/);
    expect(await linesOf(workId)).toHaveLength(0);
  });

  it("the same item code again is DUPLICATE_BOQ_LINE (case-insensitive), the route's synchronous pre-check agrees with it", async () => {
    const workId = await seedWorkWithTs();
    await addLine(workId, { itemCode: "SR-77", itemDescription: "PCC" });
    await expect(addLine(workId, { itemCode: "sr-77", itemDescription: "Something else" })).rejects.toThrow(/DUPLICATE_BOQ_LINE/);
    const refs = await runWithTenant(TENANT, () => boqRepo.listBoqLineRefs(TENANT, workId));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ workId, itemCode: "SR-77" });
  });
});

describe("recapitulation is computed on the stored lines (real DB, BOQ-WORKID-05)", () => {
  it("work amount = sum of line amounts to the paisa; grand total follows from it; a client-sent workAmount is ignored", async () => {
    const workId = await seedWorkWithTs();
    await addLine(workId, { itemCode: "R-1", rate: "12500", quantity: 3 });       // 12500 x 3        = 37500
    await addLine(workId, { itemCode: "R-2", rate: "99999", quantity: 2.5 });     // 99999 x 2.5      = 249997 (249997.5 truncated)
    const totals = await runWithTenant(TENANT, () => boqRepo.boqWorkTotals(TENANT, workId));
    expect(totals).toEqual({ lines: 2, totalMinor: 287497n });

    await deliver(COMMANDS.boqRecapitulate, msg(MAKER, {
      id: randomUUID(), workId, workAmount: "1",            // a bogus figure that must have no effect
      contingencyPercent: 3, turnoverTaxPercent: 1, workChargePercent: 2, qualityControlPercent: 1, centagePercent: 12.5,
      otherCharges: "5000",
    }));
    const [recap] = await inTx((tx) => tx.select().from(recapitulation).where(eq(recapitulation.workId, workId)));
    expect(recap!.workAmount).toBe(287497n);
    // 287497 + 3% (8624) + 1% (2874) + 2% (5749) + 1% (2874) + 12.5% (35937) + 5000 other charges, each % truncated to a paisa
    expect(recap!.grandTotal).toBe(348555n);
    expect(await outbox(EVENTS.boqRecapitulated, { workId })).toHaveLength(1);
  });

  it("a work with no BoQ lines cannot be recapitulated (BOQ_EMPTY) and no recap row is written", async () => {
    const workId = await seedWorkWithTs();
    await expect(deliver(COMMANDS.boqRecapitulate, msg(MAKER, {
      id: randomUUID(), workId, contingencyPercent: 3, turnoverTaxPercent: 0, workChargePercent: 0, qualityControlPercent: 0, centagePercent: 0,
    }))).rejects.toThrow(/BOQ_EMPTY/);
    expect(await inTx((tx) => tx.select().from(recapitulation).where(eq(recapitulation.workId, workId)))).toHaveLength(0);
  });

  it("another tenant's lines never count toward this work's amount (tenant isolation of the sum)", async () => {
    const workId = await seedWorkWithTs();
    await addLine(workId, { itemCode: "T-1", rate: "1000", quantity: 1 });
    const other = "dddddddd-6666-4000-8000-0000000000e9";
    const total = await runWithTenant(other, () => boqRepo.boqWorkTotals(other, workId));
    expect(total).toEqual({ lines: 0, totalMinor: 0n });
  });
});

describe("a work has ONE recapitulation (real DB, BOQ-WORKID-05 repeat semantics)", () => {
  const PCT = { contingencyPercent: 3, turnoverTaxPercent: 1, workChargePercent: 2, qualityControlPercent: 1, centagePercent: 12.5 };
  const recap = (workId: string, over: Record<string, unknown> = {}) =>
    deliver(COMMANDS.boqRecapitulate, msg(MAKER, { id: randomUUID(), workId, ...PCT, otherCharges: "5000", ...over }));
  const recapsOf = (workId: string) => inTx((tx) => tx.select().from(recapitulation).where(eq(recapitulation.workId, workId)));
  async function seedTwoLines(): Promise<string> {
    const workId = await seedWorkWithTs();
    await addLine(workId, { itemCode: "S-1", rate: "12500", quantity: 3 });     // 37500
    await addLine(workId, { itemCode: "S-2", rate: "99999", quantity: 2.5 });   // 249997  -> work amount 287497
    return workId;
  }

  it("a second recapitulation of the same work is refused, the first stays to the paisa, no second event is raised", async () => {
    const workId = await seedTwoLines();
    await recap(workId);
    // The BoQ then changes and different percentages are asked for. Whether that may REPLACE the recapitulation is an
    // undecided product question, so today it is refused and the stored figures do not move.
    await addLine(workId, { itemCode: "S-3", rate: "10000", quantity: 1 });      // work amount would now be 297497
    const again = { centagePercent: 0, contingencyPercent: 0, otherCharges: "0" };
    await expect(recap(workId, again)).rejects.toBeInstanceOf(NonRetryableError);
    await expect(recap(workId, again)).rejects.toThrow(/RECAP_EXISTS/);
    const rows = await recapsOf(workId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workAmount).toBe(287497n);
    expect(rows[0]!.grandTotal).toBe(348555n);
    expect(rows[0]!.centagePercent).toBe("12.50");
    const read = await runWithTenant(TENANT, () => boqRepo.getRecapitulation(TENANT, workId));
    expect(read!.id).toBe(rows[0]!.id);
    expect(read!.grandTotal).toBe(348555n);
    expect(await outbox(EVENTS.boqRecapitulated, { workId })).toHaveLength(1);
  });

  it("two recapitulate commands racing at the same instant (a double submit): exactly one applies, one row, one event", async () => {
    const workId = await seedTwoLines();
    const results = await Promise.allSettled([recap(workId), recap(workId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(NonRetryableError);
    expect(String(rejected[0]!.reason)).toMatch(/RECAP_EXISTS/);
    const rows = await recapsOf(workId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.grandTotal).toBe(348555n);
    expect(await outbox(EVENTS.boqRecapitulated, { workId })).toHaveLength(1);
  });

  it("another work is unaffected: each work gets its own recapitulation", async () => {
    const a = await seedTwoLines();
    const b = await seedWorkWithTs();
    await addLine(b, { itemCode: "B-1", rate: "100000", quantity: 4 });          // 400000
    await recap(a);
    await recap(b, { contingencyPercent: 0, turnoverTaxPercent: 0, workChargePercent: 0, qualityControlPercent: 0, centagePercent: 0, otherCharges: "0" });
    expect((await recapsOf(a))[0]!.grandTotal).toBe(348555n);
    expect((await recapsOf(b))[0]!.grandTotal).toBe(400000n);
  });

  it("the read returns the highest version when rows from before this rule hold more than one, whatever their insert order", async () => {
    const zero = { contingencyPercent: "0", turnoverTaxPercent: "0", workChargePercent: "0", qualityControlPercent: "0", centagePercent: "0" };
    const newer = { workAmount: 287497n, ...zero, grandTotal: 348555n, version: 2 };
    const older = { workAmount: 100000n, ...zero, grandTotal: 120000n, version: 1 };
    // one work whose older row was stored first, one whose newer row was stored first: a plain scan returns the first
    // stored row, so only an ORDER BY version DESC gets both right
    for (const [label, rows] of [["older-first", [older, newer]], ["newer-first", [newer, older]]] as const) {
      const workId = await seedWorkWithTs();
      await inTx(async (tx) => {
        for (const r of rows) await tx.insert(recapitulation).values({ id: randomUUID(), tenantId: TENANT, workId, ...r });
      });
      const read = await runWithTenant(TENANT, () => boqRepo.getRecapitulation(TENANT, workId));
      expect(read!.version, label).toBe(2);
      expect(read!.grandTotal, label).toBe(348555n);
      // and a new command still refuses: the work already has a recapitulation
      await expect(recap(workId)).rejects.toThrow(/RECAP_EXISTS/);
    }
  });
});

// ── Contractors ──────────────────────────────────────────────────────────────
async function seedContractor(name: string): Promise<string> {
  const id = randomUUID();
  await inTx(async (tx) => {
    await tx.insert(contractors).values({ id, tenantId: TENANT, name, pan: "AAAPZ1234C", createdBy: MAKER, updatedBy: MAKER } as never);
  });
  return id;
}
const rate = (actor: string, contractorId: string, over: Record<string, unknown> = {}) =>
  deliver(COMMANDS.contractorRate, msg(actor, { id: contractorId, tenantId: TENANT, rating: 4, comment: "on time, clean finish", ...over }));
const ratingsOf = (id: string) => inTx((tx) => tx.select().from(contractorRatings).where(eq(contractorRatings.contractorId, id)));

describe("contractor register paging (real DB, CONTRACTORS-03 / -06)", () => {
  it("countContractors is the true active size and listContractors honours limit/offset over it", async () => {
    const before = await runWithTenant(TENANT, () => contractorRepo.countContractors(TENANT));
    await seedContractor("Reg Co 1");
    await seedContractor("Reg Co 2");
    await seedContractor("Reg Co 3");
    expect(await runWithTenant(TENANT, () => contractorRepo.countContractors(TENANT))).toBe(before + 3);
    const total = before + 3;
    const page2 = await runWithTenant(TENANT, () => contractorRepo.listContractors(TENANT, { limit: 2, offset: 2 }));
    expect(page2).toHaveLength(Math.min(2, Math.max(0, total - 2)));
    const all = await runWithTenant(TENANT, () => contractorRepo.listContractors(TENANT, { limit: 200, offset: 0 }));
    expect(all).toHaveLength(total);
  });
});

describe("contractor rating (real DB, DETAIL-04)", () => {
  it("with no cooldown configured the same officer may rate again; every rating is in the history", async () => {
    const id = await seedContractor("No Cooldown Co");
    await rate(MAKER, id);
    await rate(MAKER, id, { rating: 2 });
    expect(await ratingsOf(id)).toHaveLength(2);
  });

  it("the audit event carries the stated reason and the rating, never the PAN", async () => {
    const id = await seedContractor("Audit Co");
    await rate(MAKER, id, { rating: 5, comment: "Handed over two weeks early" });
    const audit = await outbox("audit.event.record", { resourceId: id, action: "rate" });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload).toMatchObject({ reason: "Handed over two weeks early", rating: 5, outcome: "success" });
    expect(JSON.stringify(audit[0]!.payload)).not.toContain("AAAPZ1234C");
  });

  it("with a 30-day cooldown a repeat rating by the same officer is refused in the transaction; another officer is not", async () => {
    process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS = "30";
    const id = await seedContractor("Cooldown Co");
    await rate(MAKER, id);
    await expect(rate(MAKER, id, { rating: 1 })).rejects.toBeInstanceOf(NonRetryableError);
    await expect(rate(MAKER, id, { rating: 1 })).rejects.toThrow(/RATING_COOLDOWN/);
    const rows = await ratingsOf(id);
    expect(rows).toHaveLength(1);
    const [c] = await inTx((tx) => tx.select().from(contractors).where(eq(contractors.id, id)));
    expect(c!.ratingCount).toBe(1);
    expect(c!.performanceRating).toBe(4);
    // a different officer is unaffected
    await rate(CHECKER, id, { rating: 2 });
    expect(await ratingsOf(id)).toHaveLength(2);
    // latestRatingByActor reads the same history the check uses
    const last = await runWithTenant(TENANT, () => contractorRepo.latestRatingByActor(TENANT, id, MAKER));
    expect(last).not.toBeNull();
    expect(await runWithTenant(TENANT, () => contractorRepo.latestRatingByActor(TENANT, id, OTHER_OFFICER))).toBeNull();
  });

  it("two rate commands from the same officer racing at the same instant: the row lock serialises them, only one is stored", async () => {
    process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS = "30";
    const id = await seedContractor("Race Co");
    const results = await Promise.allSettled([rate(MAKER, id, { rating: 4 }), rate(MAKER, id, { rating: 2 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(NonRetryableError);
    expect(String(rejected[0]!.reason)).toMatch(/RATING_COOLDOWN/);
    expect(await ratingsOf(id)).toHaveLength(1);
    const [c] = await inTx((tx) => tx.select().from(contractors).where(eq(contractors.id, id)));
    expect(c!.ratingCount).toBe(1);
    expect(await outbox("audit.event.record", { resourceId: id, action: "rate" })).toHaveLength(1);
  });

  it("two officers rating at the same instant both succeed: the lock serialises them, it does not refuse them", async () => {
    process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS = "30";
    const id = await seedContractor("Two Officers Co");
    await Promise.all([rate(MAKER, id, { rating: 4 }), rate(CHECKER, id, { rating: 2 })]);
    expect(await ratingsOf(id)).toHaveLength(2);
    const [c] = await inTx((tx) => tx.select().from(contractors).where(eq(contractors.id, id)));
    expect(c!.ratingCount).toBe(2);
    expect(c!.performanceRating).toBe(3);
  });

  it("rating a contractor that does not exist in this tenant is refused as CONTRACTOR_NOT_FOUND, nothing written", async () => {
    await expect(rate(MAKER, randomUUID())).rejects.toBeInstanceOf(NonRetryableError);
    await expect(rate(MAKER, randomUUID())).rejects.toThrow(/CONTRACTOR_NOT_FOUND/);
  });

  it("once the window has passed the same officer may rate again", async () => {
    process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS = "30";
    const id = await seedContractor("Window Co");
    await rate(MAKER, id);
    // age that rating beyond the window
    await inTx(async (tx) => {
      await tx.update(contractorRatings).set({ ratedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) }).where(eq(contractorRatings.contractorId, id));
    });
    await rate(MAKER, id, { rating: 3 });
    expect(await ratingsOf(id)).toHaveLength(2);
  });

  it("a rating can name the work it is about: stored, audited, and returned with the work number in the history", async () => {
    const id = await seedContractor("Linked Co");
    const workId = randomUUID();
    await inTx(async (tx) => {
      await tx.insert(workProposals).values({
        id: workId, tenantId: TENANT, workNumber: "WRK/2026/0042", category: "regular", description: "Retaining wall, ward 7",
        workTypeId: randomUUID(), estimatedCostMinor: 5000000n, createdBy: MAKER, updatedBy: MAKER,
      });
    });
    await rate(MAKER, id, { workId });
    const history = await runWithTenant(TENANT, () => contractorRepo.listRatingHistory(TENANT, id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ workId, workNumber: "WRK/2026/0042", rating: 4, note: "on time, clean finish" });
    const audit = await outbox("audit.event.record", { resourceId: id, action: "rate" });
    expect(audit[0]!.payload.workId).toBe(workId);
  });

  it("a rating naming a work that does not exist in this tenant is refused and nothing is written", async () => {
    const id = await seedContractor("Bad Link Co");
    await expect(rate(MAKER, id, { workId: randomUUID() })).rejects.toThrow(/WORK_NOT_FOUND/);
    expect(await ratingsOf(id)).toHaveLength(0);
    const [c] = await inTx((tx) => tx.select().from(contractors).where(eq(contractors.id, id)));
    expect(c!.ratingCount).toBe(0);
  });

  it("an unlinked rating has workId and workNumber null in the history", async () => {
    const id = await seedContractor("Unlinked Co");
    await rate(MAKER, id);
    const history = await runWithTenant(TENANT, () => contractorRepo.listRatingHistory(TENANT, id));
    expect(history[0]).toMatchObject({ workId: null, workNumber: null });
  });
});

