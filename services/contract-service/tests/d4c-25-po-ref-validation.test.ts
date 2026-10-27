/**
 * D4c #25 (GAP-PROCUREMENT-CONTRACTS-NEW-06): when a contract quotes a purchase
 * order reference, contract-service checks with procurement-service that the PO
 * really exists. Unknown -> 422 PO_NOT_FOUND; procurement unreachable -> 503
 * PO_VALIDATION_UNAVAILABLE (retryable, fail closed); no poRef -> no call.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { contractContracts } from "../src/modules/contracts/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const PO_ID = randomUUID();
let app: Awaited<ReturnType<typeof buildApp>>;

const token = () => signToken({ sub: randomUUID(), tid: TENANT, roles: ["procurement_admin"], sid: "s" }, SECRET);
const body = (extra: Record<string, unknown> = {}) => ({
  contractNo: `CON-D4C25-${randomUUID().slice(0, 8)}`, vendorId: randomUUID(), title: "PO ref probe", valueMinor: 500000,
  currency: "INR", startDate: "2026-04-01", expiry: "2027-03-31", ...extra,
});
const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/contract/contracts", headers: { authorization: `Bearer ${token()}` }, payload });

/** Only the procurement call is faked; app.inject does not go through global fetch. */
function fakeProcurement(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => handler(String(input), init as RequestInit | undefined));
}

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(contractContracts).where(eq(contractContracts.tenantId, TENANT))));
  await app.close();
  await sqlClient.end();
});

describe("contract create validates poRef against procurement-service", () => {
  it("accepts (202) a poRef that procurement resolves, calling it with the tenant and the internal secret", async () => {
    process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? randomUUID();
    const spy = fakeProcurement(() => new Response(JSON.stringify({ data: { id: PO_ID, poNo: "PO/1", status: "approved" } }), { status: 200 }));
    const res = await post(body({ poRef: `procurement_po:${PO_ID}` }));
    expect(res.statusCode).toBe(202);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain("/v1/procurement/pos/resolve?ref=procurement_po%3A" + PO_ID);
    const h = (init as RequestInit).headers as Record<string, string>;
    expect(h["x-tenant-id"]).toBe(TENANT);
    expect(h["x-internal"]).toBe("1");
    expect(h["x-service-secret"]).toBe(process.env.INTERNAL_SERVICE_SECRET);
  });

  it("rejects (422 PO_NOT_FOUND) a poRef procurement does not know, and does not enqueue", async () => {
    fakeProcurement(() => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }));
    const res = await post(body({ poRef: "PO/DOES/NOT/EXIST" }));
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PO_NOT_FOUND");
  });

  it("fails closed (503 PO_VALIDATION_UNAVAILABLE, retryable) when procurement is unreachable or errors", async () => {
    fakeProcurement(() => { throw new Error("connect ECONNREFUSED"); });
    const a = await post(body({ poRef: "PO/1" }));
    expect(a.statusCode).toBe(503);
    expect(a.json().code).toBe("PO_VALIDATION_UNAVAILABLE");
    expect(a.json().retryable).toBe(true);
    vi.restoreAllMocks();
    fakeProcurement(() => new Response(null, { status: 500 }));
    expect((await post(body({ poRef: "PO/1" }))).statusCode).toBe(503);
  });

  it("makes no procurement call when there is no poRef (or a blank one)", async () => {
    const spy = fakeProcurement(() => new Response(null, { status: 500 }));
    expect((await post(body())).statusCode).toBe(202);
    expect((await post(body({ poRef: "   " }))).statusCode).toBe(202);
    expect(spy).not.toHaveBeenCalled();
  });
});
