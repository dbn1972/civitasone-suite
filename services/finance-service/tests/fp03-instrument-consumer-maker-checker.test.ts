/**
 * GAP-FINANCE-TREASURY-CHEQUES-03 -- the queue path (finance.instrument.transition) enforces the same
 * maker != checker rule as the HTTP routes, against a real DB, so it cannot be used to get around it.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeInstruments } from "../src/modules/treasury/schema.js";
import { registerInstrumentsConsumers } from "../src/modules/instruments/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "aaaaaaaa-1111-4000-8000-0000000003c1";
const MAKER = "00000000-aaaa-4000-8000-0000000003c1";
const CHECKER = "00000000-aaaa-4000-8000-0000000003c2";

type Handler = (msg: any) => Promise<void>;
class TestQueue { h = new Map<string, Handler>(); subscribe(t: string, f: Handler) { this.h.set(t, f); } deliver(t: string, m: any) { return this.h.get(t)!(m); } }
const q = new TestQueue();
const msg = (actorId: string, payload: Record<string, unknown>) => ({ messageId: randomUUID(), tenantId: TENANT, actorId, correlationId: randomUUID(), payload: { tenantId: TENANT, ...payload } });

async function seed(status: string) {
  const id = randomUUID();
  await scoped(TENANT, (tx) => tx.insert(financeInstruments).values({
    id, tenantId: TENANT, instrumentType: "cheque", instrumentNo: randomUUID().slice(0, 12), bankName: "SBI", payee: "P",
    amountMinor: 1000n, issueDate: "2026-09-01", status, createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}
const statusOf = async (id: string) => (await scoped(TENANT, (tx) => tx.select({ s: financeInstruments.status }).from(financeInstruments).where(eq(financeInstruments.id, id))))[0]!.s;

beforeAll(() => registerInstrumentsConsumers(tenantScoped(q as any)));
afterAll(async () => {
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM treasury.finance_instruments WHERE tenant_id = ${TENANT}::uuid`));
  await sqlClient.end();
});

describe("finance.instrument.transition maker-checker", () => {
  it("refuses the issuer clearing or bouncing their own instrument and leaves it unchanged", async () => {
    const id = await seed("presented");
    await expect(q.deliver("finance.instrument.transition", msg(MAKER, { id, action: "clear" }))).rejects.toThrow(/MAKER_CHECKER_VIOLATION/);
    await expect(q.deliver("finance.instrument.transition", msg(MAKER, { id, action: "bounce", reason: "x" }))).rejects.toThrow(/MAKER_CHECKER_VIOLATION/);
    expect(await statusOf(id)).toBe("presented");
  });
  it("lets a different officer clear it, and lets the issuer present or cancel their own", async () => {
    const id = await seed("presented");
    await q.deliver("finance.instrument.transition", msg(CHECKER, { id, action: "clear" }));
    expect(await statusOf(id)).toBe("cleared");
    const own = await seed("issued");
    await q.deliver("finance.instrument.transition", msg(MAKER, { id: own, action: "present" }));
    expect(await statusOf(own)).toBe("presented");
  });
});
