/**
 * CLOS3-S4-02: e-invoice IRN cancel must not call NIC again on a redelivered or concurrent
 * message (row-locked claim generated -> cancelling, lease for crashed attempts).
 *
 * Real Postgres (non-superuser billing_svc, RLS enforced); only the NIC client and the invoice
 * reader are mocked. Skips when Postgres is unreachable.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";

const DSN = process.env["DATABASE_URL"] ?? "";
async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try { await client`SELECT 1 FROM einvoice.billing_einvoice_requests LIMIT 1`; return true; } catch { return false; }
  finally { await client.end({ timeout: 1 }).catch(() => undefined); }
}
const reachable = DSN !== "" && (await probe());

const H = vi.hoisted(() => ({
  generateIrn: vi.fn(),
  cancelIrn: vi.fn(),
  findInvoice: vi.fn(),
}));

vi.mock("../src/modules/einvoice/nic-client.js", () => ({
  generateIrn: H.generateIrn,
  cancelIrn: H.cancelIrn,
}));
vi.mock("../src/modules/invoices/repo.js", () => ({
  findById: H.findInvoice,
  itemsByInvoice: vi.fn(async () => [
    { description: "Svc", quantity: "1", amountMinor: 100000n },
  ]),
}));

const { db, sqlClient } = await import("../src/shared/db.js");
const { runWithTenant } = await import("@civitasone/db");
const { markProcessed } = await import("../src/shared/outbox.js");
const { registerEInvoiceConsumers } = await import("../src/modules/einvoice/consumer.js");
const { einvoiceRequests } = await import("../src/modules/einvoice/schema.js");
const { COMMANDS } = await import("../src/topics.js");

type Handler = (msg: unknown) => Promise<void>;
const handlers = new Map<string, Handler>();
registerEInvoiceConsumers({
  subscribe: (topic: string, h: Handler) => { handlers.set(topic, h); },
  publish: async () => undefined,
} as unknown as Queue);

const mids = new Map<string, string>();
const MID = (k: string): string => { if (!mids.has(k)) mids.set(k, randomUUID()); return mids.get(k)!; };
const TENANT = randomUUID();
const ACTOR = randomUUID();
const asTenant = <T>(fn: () => Promise<T>): Promise<T> => Promise.resolve(runWithTenant(TENANT, fn));

function cancelMsg(id: string, invoiceId: string, messageId: string) {
  return { messageId, correlationId: "c", tenantId: TENANT, actorId: ACTOR, payload: { id, invoiceId, tenantId: TENANT, reason: "dup" } };
}
const cancel = (m: unknown) => handlers.get(COMMANDS.einvoiceCancel)!(m);

const rowOf = (id: string) =>
  asTenant(() => db.transaction(async (tx) => (await tx.select().from(einvoiceRequests).where(eq(einvoiceRequests.id, id)))[0]));
const seed = (v: Partial<typeof einvoiceRequests.$inferInsert> & { id: string; invoiceId: string }) =>
  asTenant(() => db.transaction(async (tx) => { await tx.insert(einvoiceRequests).values({ tenantId: TENANT, createdBy: ACTOR, updatedBy: ACTOR, ...v }); }));

const nicOk = () => ({ irn: `irn-${randomUUID()}`, ackNo: "1", ackDate: new Date().toISOString(), signedInvoice: "s", signedQrCode: "q" });

describe.skipIf(!reachable)("CLOS3-S4-02 e-invoice cancel redelivery (real Postgres)", () => {
  beforeEach(() => {
    H.generateIrn.mockReset().mockImplementation(async () => nicOk());
    H.cancelIrn.mockReset().mockResolvedValue(undefined);
    H.findInvoice.mockReset().mockImplementation(async (id: string) => ({
      id, tenantId: TENANT, totalMinor: 118000n, taxMinor: 18000n, createdAt: new Date(),
    }));
  });
  afterAll(async () => {
    await asTenant(() => db.transaction(async (tx) => { await tx.delete(einvoiceRequests).where(eq(einvoiceRequests.tenantId, TENANT)); })).catch(() => undefined);
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  });

  async function seedGenerated(): Promise<{ id: string; inv: string }> {
    const id = randomUUID(); const inv = randomUUID();
    await seed({ id, invoiceId: inv, status: "generated", irn: `irn-${id}`, ackDate: new Date() });
    return { id, inv };
  }

  it("S4-02: the same cancel message redelivered while NIC is still being called does not call NIC twice", async () => {
    const { id, inv } = await seedGenerated();
    let redelivered = false;
    H.cancelIrn.mockImplementation(async () => {
      if (!redelivered) {
        redelivered = true;
        await cancel(cancelMsg(id, inv, MID("c1"))); // redelivery arrives mid-call
      }
    });
    await cancel(cancelMsg(id, inv, MID("c1")));
    expect(H.cancelIrn).toHaveBeenCalledTimes(1);
    expect((await rowOf(id))?.status).toBe("cancelled");
  });

  it("S4-02: cancel delivered twice sequentially calls NIC once; row ends cancelled", async () => {
    const { id, inv } = await seedGenerated();
    await cancel(cancelMsg(id, inv, MID("c5")));
    await cancel(cancelMsg(id, inv, MID("c5")));
    expect(H.cancelIrn).toHaveBeenCalledTimes(1);
    expect((await rowOf(id))?.status).toBe("cancelled");
  });

  it("S4-02: concurrent duplicate deliveries call NIC once", async () => {
    const { id, inv } = await seedGenerated();
    H.cancelIrn.mockImplementation(() => new Promise((r) => setTimeout(r, 150)));
    await Promise.all([cancel(cancelMsg(id, inv, MID("c2"))), cancel(cancelMsg(id, inv, MID("c2")))]);
    expect(H.cancelIrn).toHaveBeenCalledTimes(1);
    expect((await rowOf(id))?.status).toBe("cancelled");
  });

  it("S4-02: a claim left behind by a crashed attempt is retried once the lease has expired", async () => {
    const { id, inv } = await seedGenerated();
    // simulated process crash: claim + inbox row committed, NIC result never stored
    await asTenant(() => db.transaction(async (tx) => {
      await tx.update(einvoiceRequests).set({ status: "cancelling", updatedAt: new Date(Date.now() - 3_600_000) }).where(eq(einvoiceRequests.id, id));
      await markProcessed(tx, MID("c3"));
    }));
    await cancel(cancelMsg(id, inv, MID("c3")));
    expect(H.cancelIrn).toHaveBeenCalledTimes(1);
    expect((await rowOf(id))?.status).toBe("cancelled");
  });

  it("S4-02: a fresh claim (attempt still in flight) is not retried by a redelivery", async () => {
    const { id, inv } = await seedGenerated();
    await asTenant(() => db.transaction(async (tx) => {
      await tx.update(einvoiceRequests).set({ status: "cancelling", updatedAt: new Date() }).where(eq(einvoiceRequests.id, id));
      await markProcessed(tx, MID("c4"));
    }));
    await cancel(cancelMsg(id, inv, MID("c4")));
    expect(H.cancelIrn).not.toHaveBeenCalled();
    expect((await rowOf(id))?.status).toBe("cancelling");
  });
});
