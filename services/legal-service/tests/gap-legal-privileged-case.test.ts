/**
 * GAP-LEGAL-CASES-DETAIL-06 (owner decision #12): no party-name masking for legal roles, and a
 * privileged/confidential flag that restricts a case to its assigned officers and the legal
 * head (legal_admin). Everyone else gets 404 (existence is not leaked) on the case, its
 * sub-resources and the lists/aggregates that would otherwise expose it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { legalCases, legalParties } from "../src/modules/cases/schema.js";
import { legalHearings, legalOrders } from "../src/modules/hearings/schema.js";
import { legalReminders } from "../src/modules/reminders/schema.js";
import { legalOpinions } from "../src/modules/opinions/schema.js";
import { registerCaseConsumers } from "../src/modules/cases/consumer.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { setDocumentClient, type DocumentServiceClient } from "../src/shared/document-client.js";
import { useFakeOrg, TEST_DEPT_ID } from "./helpers/org-fake.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000d1401";
const OFFICER_A = "00000000-aaaa-4000-8000-0000000d1401";
const OFFICER_B = "00000000-aaaa-4000-8000-0000000d1402";
const HEAD = "00000000-aaaa-4000-8000-0000000d1403";
const AUDITOR = "00000000-aaaa-4000-8000-0000000d1404";
const PRIV = "22222222-bbbb-4000-8000-0000000d1401";
const OPEN = "22222222-bbbb-4000-8000-0000000d1402";
const tok = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET, 3600)}`, "x-tenant-id": TENANT });
const asA = () => tok(OFFICER_A, ["legal_officer"]);
const asB = () => tok(OFFICER_B, ["legal_officer"]);
const asHead = () => tok(HEAD, ["legal_admin"]);
const asAuditor = () => tok(AUDITOR, ["audit_officer"]);
const drain = () => new Promise<void>((r) => setTimeout(r, 400));
const FUTURE = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

const noDoc: DocumentServiceClient = {
  async createBatch() { throw new Error("must not be reached for an inaccessible case"); },
  async requestUpload() { throw new Error("unreachable"); },
  async completeUpload() { throw new Error("unreachable"); },
  async getFileState() { throw new Error("unreachable"); },
  async getDownloadUrl() { throw new Error("unreachable"); },
};

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(legalReminders).where(eq(legalReminders.tenantId, TENANT));
    await tx.delete(legalOpinions).where(eq(legalOpinions.tenantId, TENANT));
    await tx.delete(legalOrders).where(eq(legalOrders.tenantId, TENANT));
    await tx.delete(legalHearings).where(eq(legalHearings.tenantId, TENANT));
    await tx.delete(legalParties).where(eq(legalParties.tenantId, TENANT));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
  }));
  for (const r of ["case", "cases", "hearings", "court_orders", "opinion", "opinions"]) await cache.invalidateResource(TENANT, r);
}

let app: FastifyInstance;
beforeAll(async () => {
  await wipe();
  setDocumentClient(noDoc);
  const raw = queue.subscribe.bind(queue);
  queue.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof queue.subscribe;
  registerCaseConsumers(queue);
  app = await buildApp();
});
beforeEach(async () => {
  await wipe();
  useFakeOrg();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(legalCases).values([
      { id: PRIV, tenantId: TENANT, caseNo: "WP/SECRET/2026", title: "Confidential matter", court: "High Court of Delhi", privileged: true, assignedOfficerIds: [OFFICER_A], createdBy: OFFICER_A, updatedBy: OFFICER_A },
      { id: OPEN, tenantId: TENANT, caseNo: "WP/OPEN/2026", title: "Ordinary matter", court: "High Court of Delhi", privileged: false, assignedOfficerIds: [OFFICER_A], createdBy: OFFICER_A, updatedBy: OFFICER_A },
    ]);
    await tx.insert(legalParties).values([
      { id: "44444444-dddd-4000-8000-0000000d1401", tenantId: TENANT, caseId: PRIV, name: "Asha Verma", role: "respondent", createdBy: OFFICER_A, updatedBy: OFFICER_A },
      { id: "44444444-dddd-4000-8000-0000000d1402", tenantId: TENANT, caseId: OPEN, name: "Ravi Kumar", role: "respondent", createdBy: OFFICER_A, updatedBy: OFFICER_A },
    ]);
    await tx.insert(legalHearings).values([
      { id: "55555555-eeee-4000-8000-0000000d1401", tenantId: TENANT, caseId: PRIV, hearingDate: FUTURE, court: "High Court of Delhi", status: "scheduled", createdBy: OFFICER_A, updatedBy: OFFICER_A },
      { id: "55555555-eeee-4000-8000-0000000d1402", tenantId: TENANT, caseId: OPEN, hearingDate: FUTURE, court: "High Court of Delhi", status: "scheduled", createdBy: OFFICER_A, updatedBy: OFFICER_A },
    ]);
    await tx.insert(legalOrders).values([
      { id: "66666666-ffff-4000-8000-0000000d1401", tenantId: TENANT, caseId: PRIV, orderType: "judgment", summary: "secret order", orderDate: "2026-01-01", complianceRequired: true, createdBy: OFFICER_A, updatedBy: OFFICER_A },
      { id: "66666666-ffff-4000-8000-0000000d1402", tenantId: TENANT, caseId: OPEN, orderType: "judgment", summary: "open order", orderDate: "2026-01-02", complianceRequired: true, createdBy: OFFICER_A, updatedBy: OFFICER_A },
    ]);
  }));
});
afterAll(async () => { await wipe(); setDocumentClient(null); await app.close(); await sqlClient.end(); });

const get = (url: string, h: Record<string, string>) => app.inject({ method: "GET", url, headers: h });
const detail = (id: string, h: Record<string, string>) => get(`/v1/legal/cases/${id}`, h);

describe("party names are not masked for legal roles (decision #12)", () => {
  it("legal_officer, legal_admin see the full respondent name; the audit reader sees an ordinary case", async () => {
    for (const h of [asA(), asB(), asHead(), asAuditor()]) {
      const r = await detail(OPEN, h);
      expect(r.statusCode).toBe(200);
      expect((r.json() as { respondent?: string }).respondent).toBe("Ravi Kumar");
    }
  });
});

describe("privileged / confidential case (decision #12)", () => {
  it("the case detail is visible to an assigned officer and the legal head, with the flag", async () => {
    for (const h of [asA(), asHead()]) {
      const r = await detail(PRIV, h);
      expect(r.statusCode).toBe(200);
      const j = r.json() as { respondent?: string; privileged?: boolean };
      expect(j.respondent).toBe("Asha Verma");
      expect(j.privileged).toBe(true);
    }
  });

  it("any other legal officer and the audit reader get 404 (existence not leaked)", async () => {
    expect((await detail(PRIV, asB())).statusCode).toBe(404);
    expect((await detail(PRIV, asAuditor())).statusCode).toBe(404);
  });

  it("the cases list hides it from non-assigned viewers but shows ordinary cases to everyone", async () => {
    const ids = async (h: Record<string, string>) => ((await get("/v1/legal/cases", h)).json() as { items: Array<{ id: string }> }).items.map((i) => i.id).sort();
    expect(await ids(asB())).toEqual([OPEN]);
    expect(await ids(asAuditor())).toEqual([OPEN]);
    expect(await ids(asA())).toEqual([OPEN, PRIV].sort());
    expect(await ids(asHead())).toEqual([OPEN, PRIV].sort());
  });

  it("sub-resources are 404 for a non-assigned officer and work for an assigned one", async () => {
    const order = { orderType: "interim", summary: "x", orderDate: "2026-02-02" };
    expect((await app.inject({ method: "POST", url: `/v1/legal/cases/${PRIV}/orders`, headers: asB(), payload: order })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/legal/cases/${PRIV}/orders`, headers: asA(), payload: order })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: `/v1/legal/cases/${PRIV}/hearings`, headers: asB(), payload: { hearingDate: FUTURE, court: "HC" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/v1/legal/cases/${PRIV}/dispose`, headers: asB(), payload: { disposition: "x" } })).statusCode).toBe(404);
    expect((await get(`/v1/legal/cases/${PRIV}/reminders`, asB())).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/legal/cases/${PRIV}/reminder`, headers: asB(), payload: { remindAt: "2099-01-01T00:00:00.000Z", message: "m" } })).statusCode).toBe(404);
    expect((await get(`/v1/legal/cases/${PRIV}/affidavits`, asB())).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/legal/cases/${PRIV}/affidavits`, headers: asB(), payload: { fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 } })).statusCode).toBe(404);
    expect((await get(`/v1/legal/cases/${PRIV}/reminders`, asA())).statusCode).toBe(200);
    expect((await get(`/v1/legal/cases/${PRIV}/reminders`, asHead())).statusCode).toBe(200);
  });

  it("hearings, court orders (items, total and stats) and upcoming hearings exclude it for a non-assigned viewer", async () => {
    const hB = (await get("/v1/legal/hearings", asB())).json() as Array<{ caseId: string }>;
    expect(hB.map((h) => h.caseId)).toEqual([OPEN]);
    const hA = (await get("/v1/legal/hearings", asA())).json() as Array<{ caseId: string }>;
    expect(hA.map((h) => h.caseId).sort()).toEqual([OPEN, PRIV].sort());

    const oB = (await get("/v1/legal/court-orders?limit=50", asB())).json() as { items: Array<{ caseId: string }>; total: number; stats: { total: number; pendingCompliance: number } };
    expect(oB.items.map((o) => o.caseId)).toEqual([OPEN]);
    expect(oB.total).toBe(1);
    expect(oB.stats.total).toBe(1);
    expect(oB.stats.pendingCompliance).toBe(1);
    const oA = (await get("/v1/legal/court-orders?limit=50", asA())).json() as { total: number };
    expect(oA.total).toBe(2);

    const upB = (await get("/v1/legal/hearings/upcoming", asB())).json() as { data: Array<{ caseId: string }> };
    expect(upB.data.map((h) => h.caseId)).toEqual([OPEN]);
  });
});

describe("creating a privileged case (decision #12)", () => {
  const body = (o: Record<string, unknown>) => ({ caseNo: `WP/P${Math.floor(Math.random() * 1e8)}/2026`, title: "T", courtCode: "hc_delhi", filingDate: "2026-03-01", departmentId: TEST_DEPT_ID, ...o });

  it("assigns the creator when privileged and no officer is named (never created legal-head-only)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/legal/cases", headers: asA(), payload: body({ caseNo: "WP/PRIVDEF/2026", privileged: true }) });
    expect(r.statusCode).toBe(202);
    await drain();
    const row = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCases).where(eq(legalCases.caseNo, "WP/PRIVDEF/2026")))))[0]!;
    expect(row.privileged).toBe(true);
    expect(row.assignedOfficerIds).toEqual([OFFICER_A]);
    expect((await detail(row.id, asA())).statusCode).toBe(200);
    expect((await detail(row.id, asB())).statusCode).toBe(404);
  });

  it("stores the flag and the assigned officers", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/legal/cases", headers: asA(), payload: body({ caseNo: "WP/PRIVNEW/2026", privileged: true, assignedOfficerIds: [OFFICER_A] }) });
    expect(r.statusCode).toBe(202);
    await drain();
    const row = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCases).where(eq(legalCases.caseNo, "WP/PRIVNEW/2026")))))[0]!;
    expect(row.privileged).toBe(true);
    expect(row.assignedOfficerIds).toEqual([OFFICER_A]);
  });
});

describe("dashboard aggregates and opinions honour the privileged flag (decision #12)", () => {
  const OP_PRIV = "33333333-cccc-4000-8000-0000000d1401";
  const OP_OPEN = "33333333-cccc-4000-8000-0000000d1402";
  const OP_FREE = "33333333-cccc-4000-8000-0000000d1403";
  const dash = async (h: Record<string, string>) => (await get("/v1/legal/dashboard", h)).json() as { activeCases: number; totalCases: number; hearingsThisWeek: number; ordersPending: number; disposedCases: number };
  const seedOpinions = () => runWithTenant(TENANT, () => db.transaction(async (tx) => {
    const base = { tenantId: TENANT, question: "q", createdBy: OFFICER_A, updatedBy: OFFICER_A };
    await tx.insert(legalOpinions).values([
      { ...base, id: OP_PRIV, caseId: PRIV, opinionNo: "OP/SECRET/1", subject: "Secret subject" },
      { ...base, id: OP_OPEN, caseId: OPEN, opinionNo: "OP/OPEN/1", subject: "Open subject" },
      { ...base, id: OP_FREE, caseId: null, opinionNo: "OP/FREE/1", subject: "Standalone subject" },
    ]);
  }));

  it("dashboard counters for a non-assigned officer exclude the privileged case; assigned officer and head see it", async () => {
    const b = await dash(asB());
    expect(b.totalCases).toBe(1);
    expect(b.activeCases).toBe(1);
    expect(b.ordersPending).toBe(1);
    const listB = ((await get("/v1/legal/cases", asB())).json() as { items: unknown[] }).items.length;
    expect(b.totalCases).toBe(listB);
    for (const h of [asA(), asHead()]) {
      const d = await dash(h);
      expect(d.totalCases).toBe(2);
      expect(d.activeCases).toBe(2);
      expect(d.ordersPending).toBe(2);
    }
  });

  it("a privileged hearing this week is not counted for a non-assigned officer", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.update(legalHearings).set({ hearingDate: today }).where(eq(legalHearings.tenantId, TENANT))));
    expect((await dash(asB())).hearingsThisWeek).toBe(1);
    expect((await dash(asA())).hearingsThisWeek).toBe(2);
  });

  it("opinion detail on a privileged case is 404 for a non-assigned officer and the audit reader, 200 for assigned/head", async () => {
    await seedOpinions();
    expect((await get(`/v1/legal/opinions/${OP_PRIV}`, asB())).statusCode).toBe(404);
    expect((await get(`/v1/legal/opinions/${OP_PRIV}`, asAuditor())).statusCode).toBe(404);
    expect((await get(`/v1/legal/opinions/${OP_PRIV}`, asA())).statusCode).toBe(200);
    expect((await get(`/v1/legal/opinions/${OP_PRIV}`, asHead())).statusCode).toBe(200);
    expect((await get(`/v1/legal/opinions/${OP_OPEN}`, asB())).statusCode).toBe(200);
    expect((await get(`/v1/legal/opinions/${OP_FREE}`, asB())).statusCode).toBe(200);
  });

  it("opinion list hides privileged-case opinions (and caseId filter is 404) for a non-assigned officer", async () => {
    await seedOpinions();
    const ids = async (h: Record<string, string>) => ((await get("/v1/legal/opinions", h)).json() as { items: Array<{ id: string }> }).items.map((i) => i.id).sort();
    expect(await ids(asB())).toEqual([OP_OPEN, OP_FREE].sort());
    expect(await ids(asA())).toEqual([OP_PRIV, OP_OPEN, OP_FREE].sort());
    expect(await ids(asHead())).toEqual([OP_PRIV, OP_OPEN, OP_FREE].sort());
    expect((await get(`/v1/legal/opinions?caseId=${PRIV}`, asB())).statusCode).toBe(404);
    expect((await get(`/v1/legal/opinions?caseId=${PRIV}`, asA())).statusCode).toBe(200);
  });

  it("opinion write routes on a privileged case are 404 for a non-assigned officer, 202 for assigned/head", async () => {
    await seedOpinions();
    const send = (method: "POST" | "PATCH", url: string, h: Record<string, string>, payload?: unknown) => app.inject({ method, url, headers: h, payload: payload as Record<string, unknown> });
    const seek = { subject: "s", question: "q", caseId: PRIV, addressee: { type: "external", name: "Law Dept" } };
    const draft = { counselName: "Adv. X", opinionText: "text" };
    const routes: Array<[string, "POST" | "PATCH", string, unknown]> = [
      ["seek", "POST", "/v1/legal/opinions", seek],
      ["draft", "PATCH", `/v1/legal/opinions/${OP_PRIV}/draft`, draft],
      ["issue", "PATCH", `/v1/legal/opinions/${OP_PRIV}/issue`, {}],
      ["submit-approval", "POST", `/v1/legal/opinions/${OP_PRIV}/submit-approval`, undefined],
    ];
    for (const [name, method, url, payload] of routes) {
      expect((await send(method, url, asB(), payload)).statusCode, `${name} as non-assigned officer`).toBe(404);
      expect((await send(method, url, asA(), payload)).statusCode, `${name} as assigned officer`).toBe(202);
      expect((await send(method, url, asHead(), payload)).statusCode, `${name} as legal head`).toBe(202);
    }
    // Ordinary-case and standalone opinions stay writable by any legal officer.
    expect((await send("PATCH", `/v1/legal/opinions/${OP_OPEN}/draft`, asB(), draft)).statusCode).toBe(202);
    expect((await send("PATCH", `/v1/legal/opinions/${OP_FREE}/draft`, asB(), draft)).statusCode).toBe(202);
    expect((await send("POST", "/v1/legal/opinions", asB(), { ...seek, caseId: OPEN })).statusCode).toBe(202);
  });
});
