/**
 * CLOS3-S4-01: e-invoice IRN generation must not call NIC again on a redelivered message, and a
 * late NIC error must never overwrite a `generated` row.
 *
 * Real Postgres (non-superuser billing_svc, RLS enforced); only the NIC client and the invoice
 * reader are mocked. Fails loudly when Postgres is unreachable (never silently skips).
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
if (!reachable) throw new Error(`closure3-s4-01: Postgres not reachable (DATABASE_URL=${DSN === "" ? "unset" : DSN.replace(/:[^:@/]+@/, ":***@")}); CI bootstraps it, locally run scripts/ci/bootstrap-postgres.sh`);

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

function genMsg(id: string, invoiceId: string, messageId: string) {
  return { messageId, correlationId: "c", tenantId: TENANT, actorId: ACTOR, payload: { id, invoiceId, tenantId: TENANT } };
}
const gen = (m: unknown) => handlers.get(COMMANDS.einvoiceGenerate)!(m);

const rowOf = (id: string) =>
  asTenant(() => db.transaction(async (tx) => (await tx.select().from(einvoiceRequests).where(eq(einvoiceRequests.id, id)))[0]));
const seed = (v: Partial<typeof einvoiceRequests.$inferInsert> & { id: string; invoiceId: string }) =>
  asTenant(() => db.transaction(async (tx) => { await tx.insert(einvoiceRequests).values({ tenantId: TENANT, createdBy: ACTOR, updatedBy: ACTOR, ...v }); }));

const nicOk = () => ({ irn: `irn-${randomUUID()}`, ackNo: "1", ackDate: new Date().toISOString(), signedInvoice: "s", signedQrCode: "q" });

describe("CLOS3-S4-01 e-invoice redelivery (real Postgres)", () => {
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

  it("S4-01: same messageId delivered twice calls NIC once and the row stays generated", async () => {
    const id = randomUUID(); const inv = randomUUID();
    await gen(genMsg(id, inv, MID("m1")));
    await gen(genMsg(id, inv, MID("m1")));
    expect(H.generateIrn).toHaveBeenCalledTimes(1);
    expect((await rowOf(id))?.status).toBe("generated");
  });

  it("S4-01: a crash after the pending row commits is recovered on redelivery (still one NIC call)", async () => {
    const id = randomUUID(); const inv = randomUUID();
    H.findInvoice.mockRejectedValueOnce(new Error("crash"));
    await expect(gen(genMsg(id, inv, MID("m2")))).rejects.toThrow("crash");
    expect((await rowOf(id))?.status).toBe("pending");
    await gen(genMsg(id, inv, MID("m2")));
    expect(H.generateIrn).toHaveBeenCalledTimes(1);
    expect((await rowOf(id))?.status).toBe("generated");
  });

  it("S4-01: a late NIC duplicate error never overwrites a generated row", async () => {
    const id = randomUUID(); const inv = randomUUID();
    H.generateIrn.mockImplementationOnce(async () => {
      // another worker generated the IRN while this call was in flight
      await asTenant(() => db.transaction(async (tx) => {
        await tx.update(einvoiceRequests).set({ status: "generated", irn: "irn-other" }).where(eq(einvoiceRequests.id, id));
      }));
      throw new Error("Duplicate IRN");
    });
    await gen(genMsg(id, inv, MID("m3")));
    const row = await rowOf(id);
    expect(row?.status).toBe("generated");
    expect(row?.irn).toBe("irn-other");
  });

  it("S4-01: a redelivery for an already failed request does not call NIC", async () => {
    const id = randomUUID(); const inv = randomUUID();
    await seed({ id, invoiceId: inv, status: "failed" });
    await gen(genMsg(id, inv, MID("m4")));
    expect(H.generateIrn).not.toHaveBeenCalled();
    expect((await rowOf(id))?.status).toBe("failed");
  });
});
