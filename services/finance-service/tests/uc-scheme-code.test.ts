/**
 * GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-03 / GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05 -- a utilization
 * certificate is linked to its scheme by the Scheme Tracking CODE, stored in its own column (migration 0154), instead of riding
 * in the free-text grant reference where a typed grant reference silently displaced it.
 *
 * Real Postgres, RLS on:
 *   - POST /v1/finance/utilization-certificates: an unknown scheme code is a synchronous 400 UNKNOWN_SCHEME naming the field; a
 *     code that belongs to ANOTHER tenant is equally unknown (tenant-scoped lookup); a real code is accepted (202).
 *   - the ucCreate consumer stores scheme_code and grant_ref independently, so a typed grant reference does not drop the
 *     scheme; a scheme code that does not resolve is dead-lettered and no certificate row is written.
 *   - the older free-text `scheme` field is still accepted and still lands in grant_ref (existing clients keep working).
 *   - GET /v1/finance/utilization-certificates returns schemeCode, and omits it for a certificate that has none.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeUC } from "../src/modules/payments/schema.js";
import { financeSchemes } from "../src/modules/budget/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { COMMANDS } from "../src/topics.js";

// vitest.config.ts injects JWT_SECRET for the suite; no literal secret here (CI gitleaks scans every commit).
const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-1111-4000-8000-00000000f406";
const OTHER_TENANT = "aaaaaaaa-1111-4000-8000-00000000f499";
const ACTOR = "00000000-aaaa-4000-8000-00000000f406";
const CORR = "corr-f406-uc-scheme";

const SCHEME_ID = "f4060000-aaaa-4000-8000-000000000001";
const SCHEME_OTHER_ID = "f4060000-aaaa-4000-8000-000000000002";

const UC = {
  both:   { id: "f4060000-cccc-4000-8000-000000000001", msg: "f4060000-dddd-4000-8000-000000000001" },
  bare:   { id: "f4060000-cccc-4000-8000-000000000002", msg: "f4060000-dddd-4000-8000-000000000002" },
  legacy: { id: "f4060000-cccc-4000-8000-000000000003", msg: "f4060000-dddd-4000-8000-000000000003" },
  bogus:  { id: "f4060000-cccc-4000-8000-000000000004", msg: "f4060000-dddd-4000-8000-000000000004" },
};
const ALL_UC = Object.values(UC).map((u) => u.id);

const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-f406" }, SECRET);

async function clean() {
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, CORR)));
  for (const u of Object.values(UC)) await db.delete(processed).where(eq(processed.messageId, u.msg));
  await scoped(TENANT, (tx) => tx.delete(financeUC).where(inArray(financeUC.id, ALL_UC)));
  await scoped(TENANT, (tx) => tx.delete(financeSchemes).where(eq(financeSchemes.id, SCHEME_ID)));
  await scoped(OTHER_TENANT, (tx) => tx.delete(financeSchemes).where(eq(financeSchemes.id, SCHEME_OTHER_ID)));
}

const body = (over: Record<string, unknown> = {}) => ({
  ucNo: "UC-F406", purpose: "Q1 utilisation", grantee: "Gram Panchayat Rampur", declaration: true,
  amountMinor: "750000", currency: "INR", ...over,
});

async function post(payload: Record<string, unknown>) {
  const app = await buildApp();
  try {
    return await app.inject({
      method: "POST", url: "/v1/finance/utilization-certificates",
      headers: { authorization: `Bearer ${token(["finance_officer"])}`, "content-type": "application/json" },
      payload,
    });
  } finally { await app.close(); }
}

beforeAll(async () => {
  await clean();
  await scoped(TENANT, (tx) => tx.insert(financeSchemes).values({
    id: SCHEME_ID, tenantId: TENANT, code: "PMAY-F406", name: "Housing Scheme", outlayMinor: 100000000n, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(OTHER_TENANT, (tx) => tx.insert(financeSchemes).values({
    id: SCHEME_OTHER_ID, tenantId: OTHER_TENANT, code: "OTHER-F406", name: "Another Office Scheme", outlayMinor: 100n, createdBy: ACTOR, updatedBy: ACTOR,
  }));
});
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("POST /v1/finance/utilization-certificates -- schemeCode", () => {
  it("400 UNKNOWN_SCHEME, on the schemeCode field, for a code that is not one of the office's schemes", async () => {
    const res = await post(body({ schemeCode: "NOPE" }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("UNKNOWN_SCHEME");
    expect(JSON.stringify(res.json())).toContain("schemeCode");
  });

  it("400 for a code that exists only in ANOTHER tenant (the lookup is tenant-scoped)", async () => {
    const res = await post(body({ schemeCode: "OTHER-F406" }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("UNKNOWN_SCHEME");
  });

  it("202 for one of the office's scheme codes", async () => {
    const res = await post(body({ schemeCode: "PMAY-F406" }));
    expect(res.statusCode).toBe(202);
  });

  it("202 with no scheme at all (an office without schemes can still certify)", async () => {
    const res = await post(body());
    expect(res.statusCode).toBe(202);
  });
});

describe("ucCreate consumer -- the scheme is stored in its own column", () => {
  async function create(u: { id: string; msg: string }, extra: Record<string, unknown>) {
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.ucCreate, {
      messageId: u.msg, type: COMMANDS.ucCreate, tenantId: TENANT, actorId: ACTOR, correlationId: CORR, schemaVersion: "1.0",
      payload: { id: u.id, tenantId: TENANT, ...body({ ucNo: `UC-${u.id.slice(-4)}` }), ...extra },
    });
    await q.drain();
    await q.stop();
    return q;
  }
  const readUc = async (id: string) => (await scoped(TENANT, (tx) => tx.select().from(financeUC).where(eq(financeUC.id, id))))[0];

  it("keeps the scheme code AND the typed grant reference (the grant reference used to displace the scheme)", async () => {
    const q = await create(UC.both, { schemeCode: "PMAY-F406", grantRef: "SAN/2026/77" });
    expect(q.dlq).toHaveLength(0);
    const row = await readUc(UC.both.id);
    expect(row?.schemeCode).toBe("PMAY-F406");
    expect(row?.grantRef).toBe("SAN/2026/77");
    expect(row?.status).toBe("submitted");
  });

  it("with only a scheme code, grant_ref stays empty instead of being filled with a scheme name", async () => {
    const q = await create(UC.bare, { schemeCode: "PMAY-F406" });
    expect(q.dlq).toHaveLength(0);
    const row = await readUc(UC.bare.id);
    expect(row?.schemeCode).toBe("PMAY-F406");
    expect(row?.grantRef).toBeNull();
  });

  it("the older free-text `scheme` field still works and lands in grant_ref, with no scheme code", async () => {
    const q = await create(UC.legacy, { scheme: "Housing Scheme" });
    expect(q.dlq).toHaveLength(0);
    const row = await readUc(UC.legacy.id);
    expect(row?.grantRef).toBe("Housing Scheme");
    expect(row?.schemeCode).toBeNull();
  });

  it("dead-letters a scheme code that does not resolve for the tenant and writes no certificate", async () => {
    const q = await create(UC.bogus, { schemeCode: "OTHER-F406" });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toMatch(/UNKNOWN_SCHEME/);
    expect(await readUc(UC.bogus.id)).toBeUndefined();
  });
});

describe("GET /v1/finance/utilization-certificates -- schemeCode", () => {
  it("returns the stored scheme code, and omits it for a certificate without one", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/utilization-certificates?limit=100", headers: { authorization: `Bearer ${token(["finance_officer"])}` } });
      expect(res.statusCode).toBe(200);
      const byId = new Map((res.json() as Array<{ id: string; schemeCode?: string; grantRef?: string }>).map((u) => [u.id, u]));
      expect(byId.get(UC.both.id)?.schemeCode).toBe("PMAY-F406");
      expect(byId.get(UC.both.id)?.grantRef).toBe("SAN/2026/77");
      expect(byId.get(UC.legacy.id)).toBeDefined();
      expect(byId.get(UC.legacy.id)?.schemeCode).toBeUndefined();
    } finally { await app.close(); }
  });
});
