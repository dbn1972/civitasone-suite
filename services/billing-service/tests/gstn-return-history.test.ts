/**
 * GAP-BILLING-GSTN-05 (UAT B4): filing history. A return filed through POST /v1/billing/gstn/returns
 * is recorded per tenant; GET /v1/billing/gstn/returns lists it (filter by GSTIN / period / type),
 * which is what the console's history tab and the duplicate-period warning read. Real Postgres
 * (FORCE RLS), real Fastify; only the outbound GSTN adapter calls are stubbed.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingGstnReturns } from "../src/modules/gstn/schema.js";

const adapter = vi.hoisted(() => ({ n: 0, nextStatus: "filed" as "submitted" | "processing" | "filed" | "rejected" }));
vi.mock("../src/modules/gstn/adapter.js", async (orig) => {
  const real = await orig<typeof import("../src/modules/gstn/adapter.js")>();
  return {
    ...real,
    submitGstReturn: vi.fn(async (r: { gstin: string; returnPeriod: string }) => ({
      referenceId: `REF-${++adapter.n}-${r.returnPeriod.replace("/", "")}`, status: "submitted", gstin: r.gstin, returnPeriod: r.returnPeriod, submittedAt: new Date().toISOString(),
    })),
    fetchReturnStatus: vi.fn(async (ref: string) => ({ referenceId: ref, status: adapter.nextStatus, returnPeriod: "07/2026", lastUpdated: new Date().toISOString() })),
  };
});

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const G1 = "22AAAAA0000A1Z5";
const G2 = "27AAAAA0000A1Z7";
const bearer = (roles: string[], tid = T) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-g5" }, SECRET, 3600)}` });
let app: Awaited<ReturnType<typeof buildApp>>;

const file = (gstin: string, returnPeriod: string, returnType = "GSTR3B", tid = T) =>
  app.inject({ method: "POST", url: "/v1/billing/gstn/returns", headers: bearer(["finance_officer"], tid), payload: { gstin, returnPeriod, returnType, totalTaxableValue: "1000000", totalCgst: "90000", totalSgst: "90000", totalIgst: "0" } });
const list = (qs: string, roles = ["finance_officer"], tid = T) => app.inject({ method: "GET", url: `/v1/billing/gstn/returns${qs}`, headers: bearer(roles, tid) });

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  for (const t of [T, OTHER]) await runWithTenant(t, () => db.transaction((tx) => tx.delete(billingGstnReturns).where(eq(billingGstnReturns.tenantId, t))));
  await app.close();
  await sqlClient.end();
});

describe("GST return filing history", () => {
  it("a filed return appears in the history with paise strings, newest first", async () => {
    expect((await file(G1, "07/2026")).statusCode).toBe(201);
    expect((await file(G1, "08/2026", "GSTR1")).statusCode).toBe(201);
    expect((await file(G2, "07/2026")).statusCode).toBe(201);
    const all = (await list("")).json().data as Array<Record<string, string>>;
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({ gstin: G2, returnPeriod: "07/2026", returnType: "GSTR3B", status: "submitted", totalTaxableMinor: "1000000", totalCgstMinor: "90000", totalIgstMinor: "0" });
    expect(all[0]!.referenceId).toMatch(/^REF-/);
  });

  it("filters by GSTIN, by period and by return type", async () => {
    expect(((await list(`?gstin=${G1}`)).json().data as unknown[]).length).toBe(2);
    expect(((await list(`?gstin=${G1}&period=${encodeURIComponent("07/2026")}`)).json().data as unknown[]).length).toBe(1);
    expect(((await list(`?returnType=GSTR1`)).json().data as Array<{ gstin: string }>).map((r) => r.gstin)).toEqual([G1]);
  });

  it("is scoped to the caller's tenant", async () => {
    expect(((await list("", ["finance_officer"], OTHER)).json().data as unknown[]).length).toBe(0);
    await file(G1, "09/2026", "GSTR3B", OTHER);
    expect(((await list("", ["finance_officer"], OTHER)).json().data as unknown[]).length).toBe(1);
    expect(((await list("")).json().data as unknown[]).length).toBe(3);
  });

  it("looking up a return's status updates the stored status", async () => {
    const first = (await list(`?gstin=${G1}&period=${encodeURIComponent("07/2026")}`)).json().data[0] as { referenceId: string };
    adapter.nextStatus = "filed";
    expect((await app.inject({ method: "GET", url: `/v1/billing/gstn/returns/${first.referenceId}/status`, headers: bearer(["finance_officer"]) })).statusCode).toBe(200);
    expect((await list(`?gstin=${G1}&period=${encodeURIComponent("07/2026")}`)).json().data[0].status).toBe("filed");
  });

  it("rejects a malformed filter with 400 and a plain tenant user with 403", async () => {
    expect((await list("?period=13/2026")).statusCode).toBe(400);
    expect((await list("?gstin=short")).statusCode).toBe(400);
    expect((await list("", ["viewer"])).statusCode).toBe(403);
  });
});
