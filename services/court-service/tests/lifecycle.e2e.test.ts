/**
 * FULL-LIFECYCLE walkthrough — one real run composing the whole adjudication
 * chain through the REAL stack (route → in-memory queue → worker → consumer →
 * db.transaction under RLS), as the non-superuser court_svc role:
 *   create court → register case (+party) → schedule hearing → submit filing →
 *   record order → submit-for-approval → approve+issue (maker-checker) →
 *   request certified copy.
 * Plus a NEGATIVE proof: the order maker cannot self-issue (§35.5) end to end.
 *
 * Opt-in via COURT_E2E=1. Default `vitest run` skips (DB is mocked there).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { subscribeConsumers } from "../src/worker.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const MAKER = "aaaa0001-0000-4000-8000-000000000001";  // records/submits the order
const CHECKER = "bbbb0002-0000-4000-8000-000000000002"; // approves+issues (must differ)

function tok(actor: string): string {
  return signToken({ sub: actor, tid: TENANT, roles: ["super_admin"], sid: "sess-lc" }, SECRET, 3600);
}
function cnr(): string {
  return ("DLHC" + randomUUID().replace(/-/g, "")).slice(0, 16).toUpperCase();
}

let app: FastifyInstance;

async function POST(url: string, actor: string, body: unknown): Promise<{ code: number; json: any }> {
  const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok(actor)}`, "content-type": "application/json" }, payload: body as object });
  return { code: res.statusCode, json: res.statusCode < 300 ? res.json() : undefined };
}
async function PATCH(url: string, actor: string, body: unknown): Promise<number> {
  const res = await app.inject({ method: "PATCH", url, headers: { authorization: `Bearer ${tok(actor)}`, "content-type": "application/json" }, payload: body as object });
  return res.statusCode;
}
async function GET(url: string, actor = MAKER): Promise<{ code: number; json: any }> {
  const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok(actor)}` } });
  return { code: res.statusCode, json: res.statusCode < 300 ? res.json() : undefined };
}
async function waitFor(pred: () => Promise<boolean>, tries = 60, gap = 25): Promise<boolean> {
  for (let i = 0; i < tries; i++) { if (await pred()) return true; await new Promise((r) => setTimeout(r, gap)); }
  return false;
}

describe.skipIf(!RUN)("court-service FULL-LIFECYCLE walkthrough (e2e, real stack, RLS)", () => {
  let courtId = "";
  let caseId = "";
  let orderId = "";

  beforeAll(async () => {
    subscribeConsumers();
    await queue.start();
    app = await buildApp();
  });
  afterAll(async () => {
    await queue.stop();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      for (const t of ["certified_copies", "orders", "filings", "hearings", "case_parties", "case_state_transitions", "cases", "courts"]) {
        await sql.unsafe(`delete from court.${t} where tenant_id = $1`, [TENANT]);
      }
    });
    await app.close();
    await sqlClient.end();
  });

  it("1. creates a court", async () => {
    const r = await POST("/v1/court/courts", MAKER, { name: "Lifecycle Tehsildar Court", courtType: "tehsildar" });
    expect(r.code).toBe(202);
    courtId = r.json.courtId;
    expect(await waitFor(async () => (await GET("/v1/court/courts")).json.items.some((c: any) => c.id === courtId))).toBe(true);
  });

  it("2. registers a case with a party", async () => {
    const r = await POST("/v1/court/cases", MAKER, {
      cnrNumber: cnr(), caseType: "civil", filingDate: "2026-07-11", title: "Ramesh v. State", courtId,
      parties: [{ partyRole: "petitioner", name: "Ramesh Kumar" }],
    });
    expect(r.code).toBe(202);
    caseId = r.json.caseId;
    expect(await waitFor(async () => (await GET(`/v1/court/cases/${caseId}`)).code === 200)).toBe(true);
  });

  it("3. schedules a hearing", async () => {
    const r = await POST(`/v1/court/cases/${caseId}/hearings`, MAKER, { scheduledAt: "2026-08-01T10:30:00.000Z", purpose: "arguments" });
    expect(r.code).toBe(202);
    expect(await waitFor(async () => ((await GET(`/v1/court/cases/${caseId}/hearings`)).json.items?.length ?? 0) >= 1)).toBe(true);
  });

  it("4. submits a filing", async () => {
    const r = await POST(`/v1/court/cases/${caseId}/filings`, MAKER, { filingType: "petition", filingFeeMinor: 0, courtFeeMinor: 0 });
    expect(r.code).toBe(202);
    expect(await waitFor(async () => ((await GET(`/v1/court/cases/${caseId}/filings`)).json.items?.length ?? 0) >= 1)).toBe(true);
  });

  it("5. records an order (draft)", async () => {
    const r = await POST(`/v1/court/cases/${caseId}/orders`, MAKER, { orderType: "final_order", orderText: "Petition allowed.", orderDate: "2026-08-15" });
    expect(r.code).toBe(202);
    orderId = r.json.orderId;
    expect(await waitFor(async () => (await GET(`/v1/court/orders/${orderId}`)).json?.status === "draft")).toBe(true);
  });

  it("6. submits the order for approval → pending_approval", async () => {
    const cur = (await GET(`/v1/court/orders/${orderId}`)).json;
    expect(await PATCH(`/v1/court/orders/${orderId}/submit-for-approval`, MAKER, { expectedVersion: cur.version })).toBe(202);
    expect(await waitFor(async () => (await GET(`/v1/court/orders/${orderId}`)).json?.status === "pending_approval")).toBe(true);
  });

  it("7. a DIFFERENT officer approves + issues (maker-checker satisfied) → issued", async () => {
    const cur = (await GET(`/v1/court/orders/${orderId}`)).json;
    expect(await PATCH(`/v1/court/orders/${orderId}/approve-issue`, CHECKER, { dscSignature: "DSC:checker-signed", issuedDate: "2026-08-16", expectedVersion: cur.version })).toBe(202);
    expect(await waitFor(async () => (await GET(`/v1/court/orders/${orderId}`)).json?.status === "issued")).toBe(true);
  });

  it("8. requests a certified copy of the issued order", async () => {
    const r = await POST(`/v1/court/cases/${caseId}/certified-copies`, MAKER, { caseId, orderId, applicantName: "Ramesh Kumar", copiesCount: 2 });
    expect(r.code).toBe(202);
    const copyId = r.json.copyId;
    expect(await waitFor(async () => (await GET(`/v1/court/certified-copies/${copyId}`)).json?.item?.status === "requested")).toBe(true);
  });

  it("NEGATIVE: the order MAKER cannot self-issue (§35.5) — stays pending_approval", async () => {
    // record + submit a second order as MAKER, then MAKER tries to approve-issue it.
    const rec = await POST(`/v1/court/cases/${caseId}/orders`, MAKER, { orderType: "interim", orderText: "Interim relief.", orderDate: "2026-08-20" });
    const oid = rec.json.orderId;
    expect(await waitFor(async () => (await GET(`/v1/court/orders/${oid}`)).json?.status === "draft")).toBe(true);
    const v1 = (await GET(`/v1/court/orders/${oid}`)).json.version;
    await PATCH(`/v1/court/orders/${oid}/submit-for-approval`, MAKER, { expectedVersion: v1 });
    expect(await waitFor(async () => (await GET(`/v1/court/orders/${oid}`)).json?.status === "pending_approval")).toBe(true);
    const v2 = (await GET(`/v1/court/orders/${oid}`)).json.version;
    // MAKER (== created_by) approves — maker-checker must REJECT (dead-lettered).
    await PATCH(`/v1/court/orders/${oid}/approve-issue`, MAKER, { dscSignature: "DSC:self", issuedDate: "2026-08-21", expectedVersion: v2 });
    const became = await waitFor(async () => (await GET(`/v1/court/orders/${oid}`)).json?.status === "issued", 12, 25);
    expect(became).toBe(false); // never issued — self-approval blocked end to end
    expect((await GET(`/v1/court/orders/${oid}`)).json.status).toBe("pending_approval");
  });
});
