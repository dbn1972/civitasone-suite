/**
 * Wave 2 works part 1: REAL consumers against the REAL Postgres (works_svc,
 * NOBYPASSRLS, FORCE RLS) prove the transactional rules added for
 *  - GAP-WORKS-BILLING-WORKID-03: bill / MB finalize maker-checker enforced in
 *    the consumer (a command published past the route pre-check still fails),
 *  - GAP-WORKS-BILLING-NEW-MB-03: duplicate MB number per work refused,
 *  - GAP-WORKS-TENDERS-DETAIL-01: quotation contractorId validated + persisted,
 *  - GAP-WORKS-TENDERS-NEW-06: duplicate pre-tender reference refused.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { awards } from "../src/modules/tender/schema.js";
import { bills, measurementBooks } from "../src/modules/billing/schema.js";
import { contractors } from "../src/modules/contractor/schema.js";
import { registerTenderConsumers } from "../src/modules/tender/consumer.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";

const TENANT = "dddddddd-6666-4000-8000-0000000000d1";
const MAKER = "00000000-aaaa-4000-8000-0000000000f1";
const CHECKER = "00000000-aaaa-4000-8000-0000000000f2";

type Handler = (msg: unknown) => Promise<void>;
function collect(register: (q: never) => void): Record<string, Handler> {
  const h: Record<string, Handler> = {};
  register({ subscribe: (t: string, fn: Handler) => { h[t] = fn; } } as never);
  return h;
}
const handlers = { ...collect(registerTenderConsumers as never), ...collect(registerBillingConsumers as never) };

function msg(actorId: string, payload: Record<string, unknown>, messageId = randomUUID()) {
  return { messageId, tenantId: TENANT, actorId, correlationId: `w2p1-${messageId}`, schemaVersion: "1.0", payload };
}
function deliver(command: string, m: ReturnType<typeof msg>): Promise<void> {
  return runWithTenant(TENANT, () => handlers[command]!(m));
}
const inTx = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const t of ["works.bills", "works.measurement_books", "works.quotations", "works.pre_tenders", "works.awards", "works.contractors"]) {
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
    await tx.insert(awards).values({ id: awardId, tenantId: TENANT, workId, contractorName: "Acme", acceptedAmountMinor: 1000000n, createdBy: MAKER });
  });
  return { awardId, workId };
}

describe("MB issue / finalize rules (real DB)", () => {
  it("refuses a duplicate MB number for the same work, allows the same number on another work", async () => {
    const a = await seedAward();
    await deliver(COMMANDS.mbIssue, msg(MAKER, { id: randomUUID(), workId: a.workId, awardId: a.awardId, mbNumber: "MB-DUP" }));
    const dup = msg(MAKER, { id: randomUUID(), workId: a.workId, awardId: a.awardId, mbNumber: "MB-DUP" });
    await expect(deliver(COMMANDS.mbIssue, dup)).rejects.toBeInstanceOf(NonRetryableError);
    await expect(deliver(COMMANDS.mbIssue, dup)).rejects.toThrow(/DUPLICATE_MB_NUMBER/);
    const b = await seedAward();
    await deliver(COMMANDS.mbIssue, msg(MAKER, { id: randomUUID(), workId: b.workId, awardId: b.awardId, mbNumber: "MB-DUP" }));
  });

  it("the MB issuer cannot finalize their own MB (row untouched); a different actor can", async () => {
    const a = await seedAward();
    const mbId = randomUUID();
    await deliver(COMMANDS.mbIssue, msg(MAKER, { id: mbId, workId: a.workId, awardId: a.awardId, mbNumber: "MB-SOD" }));
    const self = msg(MAKER, { id: mbId, nextStatus: "so_finalized" });
    await expect(deliver(COMMANDS.mbFinalize, self)).rejects.toThrow(/SELF_APPROVAL_FORBIDDEN/);
    const [still] = await inTx((tx) => tx.select().from(measurementBooks).where(eq(measurementBooks.id, mbId)));
    expect(still!.status).toBe("draft");
    await deliver(COMMANDS.mbFinalize, msg(CHECKER, { id: mbId, nextStatus: "so_finalized" }));
    const [after] = await inTx((tx) => tx.select().from(measurementBooks).where(eq(measurementBooks.id, mbId)));
    expect(after!.status).toBe("so_finalized");
  });
});

describe("bill finalize maker-checker (real DB)", () => {
  it("the bill creator cannot finalize it; another actor can", async () => {
    const a = await seedAward();
    const billId = randomUUID();
    await inTx(async (tx) => {
      await tx.insert(bills).values({
        id: billId, tenantId: TENANT, workId: a.workId, awardId: a.awardId, billMode: "abstract",
        billNumber: "RA-1", grossAmountMinor: 1000n, netPayableMinor: 1000n, createdBy: MAKER,
      });
    });
    await expect(deliver(COMMANDS.billFinalize, msg(MAKER, { id: billId, nextStatus: "so_finalized" }))).rejects.toThrow(/SELF_APPROVAL_FORBIDDEN/);
    const [still] = await inTx((tx) => tx.select().from(bills).where(eq(bills.id, billId)));
    expect(still!.status).toBe("draft");
    await deliver(COMMANDS.billFinalize, msg(CHECKER, { id: billId, nextStatus: "so_finalized" }));
    const [after] = await inTx((tx) => tx.select().from(bills).where(eq(bills.id, billId)));
    expect(after!.status).toBe("so_finalized");
  });
});

describe("tender rules (real DB)", () => {
  it("refuses a duplicate pre-tender reference number", async () => {
    await deliver(COMMANDS.preTenderCreate, msg(MAKER, { id: randomUUID(), workId: randomUUID(), referenceNumber: "NIT/DUP" }));
    const dup = msg(MAKER, { id: randomUUID(), workId: randomUUID(), referenceNumber: "NIT/DUP" });
    await expect(deliver(COMMANDS.preTenderCreate, dup)).rejects.toThrow(/DUPLICATE_REFERENCE/);
  });

  it("persists a validated contractorId on a quotation and rejects a name mismatch", async () => {
    const cId = randomUUID();
    await inTx(async (tx) => {
      await tx.insert(contractors).values({ id: cId, tenantId: TENANT, name: "Real Firm", createdBy: MAKER, updatedBy: MAKER } as never);
    });
    const tenderId = randomUUID();
    await deliver(COMMANDS.preTenderCreate, msg(MAKER, { id: tenderId, workId: randomUUID() }));
    const qId = randomUUID();
    await deliver(COMMANDS.quotationAdd, msg(MAKER, { id: qId, tenderId, contractorId: cId, contractorName: "real firm", method: "item_rate" }));
    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`SELECT contractor_id FROM works.quotations WHERE id = ${qId}`;
    });
    expect((rows as unknown as Array<{ contractor_id: string }>)[0]!.contractor_id).toBe(cId);
    await expect(
      deliver(COMMANDS.quotationAdd, msg(MAKER, { id: randomUUID(), tenderId, contractorId: cId, contractorName: "Other Firm", method: "item_rate" })),
    ).rejects.toThrow(/CONTRACTOR_NAME_MISMATCH/);
  });
});
