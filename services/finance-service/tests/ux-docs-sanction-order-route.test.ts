/**
 * PR #2463 review: GET /v1/finance/sanctions/:id/pdf route behaviour, and blocker 2 (the order is
 * signed and dated by the approver of record, which a bill booked afterwards does not change).
 * Real DB (disposable), real budget consumers on the in-memory queue, real Chromium render;
 * HRMS / identity / tenant-service lookups are stubbed at fetch.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq, sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { closePdfRenderer } from "@civitasone/render";
import { resetDocIdentityCache } from "@civitasone/render/official";
import { pdfFlatText } from "@civitasone/render/testing";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import * as budgetRepo from "../src/modules/budget/repo.js";
import { financeHeads, financeSanctions } from "../src/modules/budget/schema.js";
import { scoped } from "./_tenant.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-0000000d0c51";
const OTHER_T = "aaaaaaaa-1111-4000-8000-0000000d0c52";
const MAKER = "00000000-aaaa-4000-8000-0000000d0c01";
const CHECKER = "00000000-aaaa-4000-8000-0000000d0c02";
const CLERK = "00000000-aaaa-4000-8000-0000000d0c03";
const STRANGER = "00000000-aaaa-4000-8000-0000000d0c04";
const HEAD = "00000000-bbbb-4000-8000-0000000d0c01";
const S_APPROVE = "00000000-cccc-4000-8000-0000000d0c01";
const S_PENDING = "00000000-cccc-4000-8000-0000000d0c02";
const S_LEGACY = "00000000-cccc-4000-8000-0000000d0c03";
const S_UNRESOLVED = "00000000-cccc-4000-8000-0000000d0c04";
const S_OUTAGE = "00000000-cccc-4000-8000-0000000d0c05";

const tok = (roles: string[], sub = MAKER, tid = T) => ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s-so" }, SECRET)}` });
let app: Awaited<ReturnType<typeof buildApp>>;
const realFetch = globalThis.fetch;

/** HRMS knows the checker and the clerk; identity knows nobody else; tenant-service gives the header. */
function stubPeople() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/employee-summaries")) {
      return new Response(JSON.stringify([
        { fullName: "Asha Rao", designationName: "Under Secretary (Finance)", userRef: CHECKER },
        { fullName: "Bill Clerk", designationName: "Upper Division Clerk", userRef: CLERK },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/tenants/")) return new Response(JSON.stringify({ name: "UAT Department", settings: { documentIdentity: { ministry: "Ministry of Test" } } }), { status: 200 });
    if (u.includes("/user-summaries")) return new Response("[]", { status: 200 });
    return realFetch(url);
  }));
}

async function clean() {
  for (const t of [T, OTHER_T]) {
    await scoped(t, (tx) => tx.delete(financeSanctions).where(eq(financeSanctions.headId, HEAD)));
    await scoped(t, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD)));
  }
}

beforeAll(async () => {
  registerBudgetConsumers(queue);
  app = await buildApp();
  await clean();
  await scoped(T, (tx) => tx.insert(financeHeads).values({ id: HEAD, tenantId: T, code: "SO-UX-01", name: "Office Expenses", level: 2, createdBy: MAKER, updatedBy: MAKER }));
  const base = { tenantId: T, headId: HEAD, amountMinor: 1_234_500n, createdBy: MAKER, updatedBy: MAKER };
  await scoped(T, (tx) => tx.insert(financeSanctions).values([
    { ...base, id: S_APPROVE, sanctionNo: "SO-UX-APPROVE", purpose: "desktop computers for the e-Office cell", status: "pending_approval" },
    { ...base, id: S_PENDING, sanctionNo: "SO-UX-PENDING", purpose: "pending one", status: "pending_approval" },
    { ...base, id: S_LEGACY, sanctionNo: "SO-UX-LEGACY", purpose: "approved before migration 0162", status: "approved", updatedBy: CHECKER },
    { ...base, id: S_UNRESOLVED, sanctionNo: "SO-UX-UNRESOLVED", purpose: "approver unknown to HRMS", status: "approved", approvedBy: STRANGER, approvedAt: new Date("2026-10-01T05:00:00Z") },
    { ...base, id: S_OUTAGE, sanctionNo: "SO-UX-OUTAGE", purpose: "tenant-service outage", status: "approved", approvedBy: CHECKER, approvedAt: new Date("2026-10-02T05:00:00Z") },
  ]));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await clean();
  await app.close();
  await closePdfRenderer();
  await sqlClient.end();
});

const row = async (id: string) => (await scoped(T, (tx) => tx.select().from(financeSanctions).where(eq(financeSanctions.id, id))))[0]!;
const pdf = (id: string, h = tok(["finance_officer"])) => app.inject({ method: "GET", url: `/v1/finance/sanctions/${id}/pdf`, headers: h });

describe("sanction approval of record (migration 0162)", () => {
  it("approval writes approved_by/approved_at; a bill booked later changes updated_by but never the approver", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/finance/sanctions/${S_APPROVE}/approve`, headers: tok(["finance_admin"], CHECKER), payload: {} });
    expect(r.statusCode).toBe(202);
    await (queue as MemoryQueue).drain();
    const approved = await row(S_APPROVE);
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(CHECKER);
    expect(approved.approvedAt).toBeInstanceOf(Date);
    const approvedAt = approved.approvedAt!.toISOString();

    // payments consumer path: a bill booked against the sanction by a clerk
    await new Promise((res) => setTimeout(res, 20));
    expect(await scoped(T, (tx) => budgetRepo.incrementSanctionUtilisedGuarded(tx, S_APPROVE, 100_000n, CLERK))).toBe(true);
    // and any write that tries to change the approver is ignored by the 0162 trigger
    await scoped(T, (tx) => tx.execute(sql`UPDATE budget.finance_sanctions SET approved_by = ${CLERK}::uuid, approved_at = now() WHERE id = ${S_APPROVE}::uuid`));
    const after = await row(S_APPROVE);
    expect(after.updatedBy).toBe(CLERK);
    expect(after.approvedBy).toBe(CHECKER);
    expect(after.approvedAt!.toISOString()).toBe(approvedAt);

    stubPeople();
    const res = await pdf(S_APPROVE);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const text = await pdfFlatText(res.rawPayload);
    expect(text).toContain("(Asha Rao) Under Secretary (Finance)");
    expect(text).not.toContain("Bill Clerk");
    expect(text).not.toMatch(/Unknown officer/i);
    expect(text).toContain("No. SO-UX-APPROVE");
    expect(text).toContain("Rupees Twelve Thousand Three Hundred Forty Five Only");
  }, 60_000);
});

describe("GET /v1/finance/sanctions/:id/pdf refusals", () => {
  it("409 SANCTION_NOT_APPROVED for a pending sanction", async () => {
    const r = await pdf(S_PENDING);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SANCTION_NOT_APPROVED");
  });
  it("422 SANCTION_APPROVAL_NOT_RECORDED for an approved sanction with no approver of record (never falls back to updated_by)", async () => {
    stubPeople();
    const r = await pdf(S_LEGACY);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("SANCTION_APPROVAL_NOT_RECORDED");
  });
  it("422 SANCTIONING_OFFICER_UNRESOLVED when the approver has no name on record", async () => {
    stubPeople();
    const r = await pdf(S_UNRESOLVED);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("SANCTIONING_OFFICER_UNRESOLVED");
  });
  it("404 for another tenant, 403 for a role outside the sanction readers, 401 without a token", async () => {
    expect((await pdf(S_APPROVE, tok(["finance_officer"], MAKER, OTHER_T))).statusCode).toBe(404);
    expect((await pdf(S_APPROVE, tok(["employee"]))).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/finance/sanctions/${S_APPROVE}/pdf` })).statusCode).toBe(401);
  });
});

describe("tenant-service unavailable fails closed (PR #2463 delta: resolveDocIdentity)", () => {
  /** HRMS knows the approver; tenant-service answers with `tenant`. */
  function stubWith(tenant: () => Response | Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/employee-summaries")) {
        return new Response(JSON.stringify([{ fullName: "Asha Rao", designationName: "Under Secretary (Finance)", userRef: CHECKER }]), { status: 200 });
      }
      if (u.includes("/v1/tenants/")) return tenant();
      if (u.includes("/user-summaries")) return new Response("[]", { status: 200 });
      return realFetch(url);
    }));
  }
  it.each([
    ["500", () => new Response("{}", { status: 500 })],
    ["404", () => new Response("{}", { status: 404 })],
    ["connection error", () => { throw new TypeError("fetch failed"); }],
    ["unreadable body", () => new Response("not json", { status: 200 })],
    ["non-object body", () => new Response("null", { status: 200 })],
  ] as const)("tenant-service %s -> 503 TENANT_IDENTITY_UNAVAILABLE, no PDF", async (_n, reply) => {
    resetDocIdentityCache();
    stubWith(reply);
    const r = await pdf(S_OUTAGE);
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe("TENANT_IDENTITY_UNAVAILABLE");
    expect(r.headers["content-type"]).not.toBe("application/pdf");
  });
  it("a failure is not cached: the next request, with tenant-service back, issues the order", async () => {
    resetDocIdentityCache();
    stubWith(() => new Response("{}", { status: 500 }));
    expect((await pdf(S_OUTAGE)).statusCode).toBe(503);
    stubWith(() => new Response(JSON.stringify({ name: "UAT Department", settings: { documentIdentity: { ministry: "Ministry of Test" } } }), { status: 200 }));
    const ok = await pdf(S_OUTAGE);
    expect(ok.statusCode, ok.body.slice(0, 300)).toBe(200);
    expect(ok.headers["content-type"]).toBe("application/pdf");
  }, 60_000);
  it("a successful read of a tenant with no documentIdentity is not an outage: the order still issues (not-configured rules stay per document)", async () => {
    resetDocIdentityCache();
    stubWith(() => new Response(JSON.stringify({ data: { settings: {} } }), { status: 200 }));
    const r = await pdf(S_OUTAGE);
    expect(r.statusCode).not.toBe(503);
  }, 60_000);
});
