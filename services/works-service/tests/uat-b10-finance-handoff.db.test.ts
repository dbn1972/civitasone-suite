/**
 * UAT bundle 10, F93 (T6-05), review follow-up: the works -> finance bill hand-off fails VISIBLY and, where it can,
 * synchronously (real DB, works_svc under FORCE RLS).
 *
 *  - The DO step on a bill whose award has no contractor is refused by the ROUTE with 422 AWARD_NO_CONTRACTOR (it
 *    used to answer 202 and then roll back in the consumer). Nothing is published.
 *  - When finance refuses the bill (finance.bill.rejected), the works bill itself records it (financeStatus
 *    "rejected" + code + reason) and the bill API returns it, so the web bill page can show why.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { CONSUMED_EVENTS, COMMANDS } from "../src/topics.js";
import { awards } from "../src/modules/tender/schema.js";
import { bills } from "../src/modules/billing/schema.js";
import { contractors } from "../src/modules/contractor/schema.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();

const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: CHECKER, tid: TENANT, roles: ["works_admin"], sid: "s" }, SECRET, 3600)}`,
});
const inTx = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

type Handler = (m: unknown) => Promise<void>;
const handlers: Record<string, Handler> = {};
registerBillingConsumers({ subscribe: (t: string, fn: Handler) => { handlers[t] = fn; } } as never);

let app: FastifyInstance;

async function seedBill(withContractor: boolean): Promise<{ billId: string; workId: string }> {
  const awardId = randomUUID();
  const workId = randomUUID();
  const billId = randomUUID();
  const contractorId = withContractor ? randomUUID() : null;
  await inTx(async (tx) => {
    if (contractorId) {
      await tx.insert(contractors).values({ id: contractorId, tenantId: TENANT, name: "B10 Co", createdBy: MAKER, updatedBy: MAKER } as never);
    }
    await tx.insert(awards).values({ id: awardId, tenantId: TENANT, workId, contractorId, contractorName: "B10 Co", acceptedAmountMinor: 100000000n, createdBy: MAKER });
    await tx.insert(bills).values({
      id: billId, tenantId: TENANT, workId, awardId, billMode: "abstract", billNumber: `RA-${billId.slice(0, 6)}`,
      grossAmountMinor: 30000n, netPayableMinor: 30000n, status: "dao_finalized", createdBy: MAKER,
    });
  });
  return { billId, workId };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const t of ["works.bills", "works.awards", "works.contractors"]) await sql.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`);
  });
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  await app.close();
  await sqlClient.end();
});

describe("F93: the DO finalize route refuses an award with no contractor synchronously", () => {
  it("422 AWARD_NO_CONTRACTOR, nothing published, the bill stays at dao_finalized", async () => {
    const { billId } = await seedBill(false);
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await app.inject({ method: "POST", url: `/v1/works/billing/bills/${billId}/finalize`, headers: hdr(), payload: { nextStatus: "do_finalized" } });
      expect(res.statusCode).toBe(422);
      expect(JSON.stringify(res.json())).toContain("AWARD_NO_CONTRACTOR");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    const [row] = await inTx((tx) => tx.select().from(bills).where(eq(bills.id, billId)));
    expect(row!.status).toBe("dao_finalized");
  });

  it("an award with a contractor gets 202 (control)", async () => {
    const { billId } = await seedBill(true);
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const res = await app.inject({ method: "POST", url: `/v1/works/billing/bills/${billId}/finalize`, headers: hdr(), payload: { nextStatus: "do_finalized" } });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("F93: a finance refusal is recorded on the works bill and returned by the bill API", () => {
  it("DO finalize marks the bill 'sent'; finance.bill.rejected flips it to 'rejected' with the code and reason", async () => {
    const { billId } = await seedBill(true);
    const base = { tenantId: TENANT, actorId: CHECKER, schemaVersion: "1.0" };
    await runWithTenant(TENANT, () => handlers[COMMANDS.billFinalize]!({
      ...base, messageId: randomUUID(), correlationId: randomUUID(), payload: { id: billId, nextStatus: "do_finalized" },
    }));
    let [row] = await inTx((tx) => tx.select().from(bills).where(eq(bills.id, billId)));
    expect(row!.financeStatus).toBe("sent");

    await runWithTenant(TENANT, () => handlers[CONSUMED_EVENTS.financeBillRejected]!({
      ...base, messageId: randomUUID(), correlationId: randomUUID(),
      payload: { billId: randomUUID(), code: "UNKNOWN_VENDOR", reason: "UNKNOWN_VENDOR: not found in vendor master for tenant", worksBillId: billId },
    }));
    [row] = await inTx((tx) => tx.select().from(bills).where(eq(bills.id, billId)));
    expect(row).toMatchObject({ financeStatus: "rejected", financeRejectionCode: "UNKNOWN_VENDOR" });
    expect(row!.financeRejectedAt).toBeInstanceOf(Date);

    const res = await app.inject({ method: "GET", url: "/v1/works/billing/bills?pageSize=100", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const listed = (res.json().data as Array<Record<string, unknown>>).find((b) => b.id === billId);
    expect(listed).toMatchObject({ financeStatus: "rejected", financeRejectionCode: "UNKNOWN_VENDOR", financeRejectionReason: expect.stringContaining("vendor master") });
  });
});
