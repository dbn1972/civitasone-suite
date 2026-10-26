/**
 * GAP-LEGAL-CASES-NEW-02 (owner decision #10): a seeded court/tribunal master
 * (Supreme Court, High Courts, district courts, tribunals) replaces free-text court
 * entry; "Other" free text is allowed but marked unverified; filing date and
 * department are required on case creation.
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
import { legalCases } from "../src/modules/cases/schema.js";
import { registerCaseConsumers } from "../src/modules/cases/consumer.js";
import { COURT_MASTER } from "../src/config/courts.js";
import { setOrgClient } from "../src/shared/org-client.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { fakeOrg, useFakeOrg, TEST_DEPT_ID, TEST_DEPT_NAME } from "./helpers/org-fake.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitas_32chr_xx".padEnd(32, "x");
const TENANT = "11111111-aaaa-4000-8000-0000000d1101";
const ACTOR = "00000000-aaaa-4000-8000-0000000d1101";
const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, process.env.JWT_SECRET ?? SECRET, 3600);
const auth = (roles: string[] = ["legal_officer"]) => ({ authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT });
const drain = () => new Promise<void>((r) => setTimeout(r, 400));
const today = new Date().toISOString().slice(0, 10);

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
  }));
  for (const r of ["case", "cases"]) await cache.invalidateResource(TENANT, r);
}

const body = (over: Record<string, unknown> = {}) => ({
  caseNo: `WP/${Math.floor(Math.random() * 1e9)}/2026`, title: "State v. Example",
  courtCode: "hc_delhi", filingDate: today, departmentId: TEST_DEPT_ID, ...over,
});

let app: FastifyInstance;
beforeAll(async () => {
  await wipe();
  useFakeOrg();
  const raw = queue.subscribe.bind(queue);
  queue.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof queue.subscribe;
  registerCaseConsumers(queue);
  app = await buildApp();
});
beforeEach(async () => { await wipe(); useFakeOrg(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("court / tribunal master (decision #10)", () => {
  it("is seeded with the Supreme Court, High Courts, district courts and tribunals with unique codes", () => {
    const codes = COURT_MASTER.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    const kinds = new Set(COURT_MASTER.map((c) => c.kind));
    for (const k of ["supreme", "high_court", "district", "tribunal"]) expect(kinds.has(k as never)).toBe(true);
    expect(COURT_MASTER.find((c) => c.code === "sc_india")!.name).toBe("Supreme Court of India");
    expect(COURT_MASTER.filter((c) => c.kind === "high_court").length).toBeGreaterThanOrEqual(25);
    expect(codes).not.toContain("other");
  });

  it("GET /v1/legal/courts serves the master to legal and audit readers only", async () => {
    const ok = await app.inject({ method: "GET", url: "/v1/legal/courts", headers: auth() });
    expect(ok.statusCode).toBe(200);
    const items = (ok.json() as { items: Array<{ code: string; name: string; kind: string }> }).items;
    expect(items.some((c) => c.code === "hc_delhi" && c.name === "High Court of Delhi")).toBe(true);
    expect((await app.inject({ method: "GET", url: "/v1/legal/courts", headers: auth(["audit_officer"]) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/legal/courts", headers: auth(["citizen"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/legal/courts" })).statusCode).toBe(401);
  });
});

describe("create case: court, filing date, department (decision #10)", () => {
  it("a master court is stored by its canonical name, marked verified, with filing date and department", async () => {
    const payload = body({ caseNo: "WP/1001/2026", filingDate: "2026-03-15" });
    const res = await app.inject({ method: "POST", url: "/v1/legal/cases", headers: auth(), payload });
    expect(res.statusCode).toBe(202);
    await drain();
    const row = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCases).where(eq(legalCases.caseNo, "WP/1001/2026")))))[0]!;
    expect(row.court).toBe("High Court of Delhi");
    expect(row.courtCode).toBe("hc_delhi");
    expect(row.courtVerified).toBe(true);
    expect(String(row.filingDate)).toBe("2026-03-15");
    expect(row.departmentId).toBe(TEST_DEPT_ID);
  });

  it("variants of the same court normalise to ONE court value", async () => {
    await app.inject({ method: "POST", url: "/v1/legal/cases", headers: auth(), payload: body({ caseNo: "WP/1/2026", court: "high court delhi" }) });
    await app.inject({ method: "POST", url: "/v1/legal/cases", headers: auth(), payload: body({ caseNo: "WP/2/2026", court: "HC Delhi" }) });
    await drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCases).where(eq(legalCases.tenantId, TENANT))));
    expect(new Set(rows.map((r) => r.court))).toEqual(new Set(["High Court of Delhi"]));
  });

  it("'Other' free text is accepted and marked unverified", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/legal/cases", headers: auth(), payload: body({ caseNo: "OTH/1/2026", courtCode: "other", court: "Local Lok Adalat, Block 7" }) });
    expect(res.statusCode).toBe(202);
    await drain();
    const row = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCases).where(eq(legalCases.caseNo, "OTH/1/2026")))))[0]!;
    expect(row.court).toBe("Local Lok Adalat, Block 7");
    expect(row.courtCode).toBe("other");
    expect(row.courtVerified).toBe(false);
  });

  it("rejects: unknown court code, 'Other' without text, missing/future filing date, missing department", async () => {
    const post = (p: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/legal/cases", headers: auth(), payload: p });
    const unknown = await post(body({ courtCode: "hc_atlantis" }));
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe("UNKNOWN_COURT");
    expect((await post(body({ courtCode: "other" }))).statusCode).toBe(400);
    const { filingDate: _f, ...noDate } = body();
    expect((await post(noDate)).statusCode).toBe(400);
    expect((await post(body({ filingDate: "2999-01-01" }))).statusCode).toBe(400);
    const { departmentId: _d, ...noDept } = body();
    expect((await post(noDept)).statusCode).toBe(400);
  });

  it("rejects a department that is not in the org hierarchy (422) and fails closed (503) when the org service is down", async () => {
    const unknown = await app.inject({ method: "POST", url: "/v1/legal/cases", headers: auth(), payload: body({ departmentId: "99999999-aaaa-4000-8000-0000000d10ff" }) });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().code).toBe("UNKNOWN_DEPARTMENT");
    const { OrgServiceError } = await import("../src/shared/org-client.js");
    setOrgClient({ async listDepartments() { throw new OrgServiceError("unavailable", "ECONNREFUSED hrms secret"); } });
    const down = await app.inject({ method: "POST", url: "/v1/legal/cases", headers: auth(), payload: body() });
    useFakeOrg();
    expect(down.statusCode).toBe(503);
    expect(JSON.stringify(down.json())).not.toContain("ECONNREFUSED");
    expect(down.json().retryable).toBe(true);
  });

  it("case detail shows the filing date, the resolved department name and whether the court is verified", async () => {
    await app.inject({ method: "POST", url: "/v1/legal/cases", headers: auth(), payload: body({ caseNo: "WP/77/2026", filingDate: "2026-02-02", courtCode: "other", court: "Special Forum" }) });
    await drain();
    const row = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCases).where(eq(legalCases.caseNo, "WP/77/2026")))))[0]!;
    const detail = await app.inject({ method: "GET", url: `/v1/legal/cases/${row.id}`, headers: auth() });
    const j = detail.json() as { filedDate: string; department?: string; courtVerified: boolean; court: string };
    expect(j.filedDate).toBe("2026-02-02");
    expect(j.department).toBe(TEST_DEPT_NAME);
    expect(j.courtVerified).toBe(false);
    expect(j.court).toBe("Special Forum");
  });

  it("GET /v1/legal/departments lists the org hierarchy for legal readers (id + name)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/legal/departments", headers: auth() });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: Array<{ id: string; name: string }> }).items;
    expect(items.find((d) => d.id === TEST_DEPT_ID)!.name).toBe(TEST_DEPT_NAME);
    expect((await app.inject({ method: "GET", url: "/v1/legal/departments", headers: auth(["citizen"]) })).statusCode).toBe(403);
    expect(fakeOrg).toBeDefined();
  });
});
