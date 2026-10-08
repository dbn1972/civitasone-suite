/**
 * DB-backed route tests for the h3 batch:
 *  - POST /v1/finance/accounts parentId (tenant-scoped, one level up)  [CHART-OF-ACCOUNTS-NEW-02]
 *  - PATCH /v1/finance/accounts/:id/hoa reason + audit row + 404       [CHART-OF-ACCOUNTS-NEW-01]
 *  - GET /v1/finance/dashboard?fy= validation and FY scoping           [DASHBOARD-02]
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { registerApprovalsConsumers } from "../src/modules/approvals/consumer.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { financeLedger } from "../src/modules/gl/schema.js";
import { setFinanceSettings, clearFinanceSettings } from "./_finance-settings.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = randomUUID();
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const HOA = "210100101010101010";
const HOA2 = "210100101010101011";

// GAP2-FINANCE-CHART-OF-ACCOUNTS-07: POST/PATCH /v1/finance/accounts are now
// CQRS'd — the route publishes and these budget consumers (registered on the
// shared queue singleton the routes publish to, wrapped in runWithTenant like
// worker.ts) perform the write. Drain after a create before reading it back.
type Drainable = { subscribe: (topic: string, handler: (msg: any) => Promise<void>) => void; drain(): Promise<void> };
const qShared = queue as unknown as Drainable;
const rawSub = qShared.subscribe.bind(qShared);
qShared.subscribe = (topic, handler) =>
  rawSub(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
registerBudgetConsumers(queue);


function auth(tenant: string) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["finance_officer"], sid: "s1" }, SECRET)}` };
}

// The single-officer HoA path is under test here; the second-approver path is in tests/fp01-change-requests.test.ts.
beforeAll(async () => { await setFinanceSettings(TENANT_A, { makerCheckerEnabled: false }); });
afterAll(async () => { await clearFinanceSettings(TENANT_A); await sqlClient.end(); });

async function createHead(app: Awaited<ReturnType<typeof buildApp>>, tenant: string, body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/finance/accounts", headers: auth(tenant), payload: body });
}

describe("POST /v1/finance/accounts -- parent hierarchy", () => {
  it("accepts a parent one level up, lists level/parentId, and rejects bad hierarchies", async () => {
    const app = await buildApp();
    try {
      const major = await createHead(app, TENANT_A, { code: `M${Date.now() % 100000}`, name: "Major head", level: 0 });
      expect(major.statusCode).toBe(202);
      await qShared.drain();
      const majorId = major.json().id as string;

      const minor = await createHead(app, TENANT_A, { code: `m${Date.now() % 100000}`, name: "Minor head", level: 1, parentId: majorId });
      expect(minor.statusCode).toBe(202);
      expect(minor.json().parentId).toBe(majorId);
      await qShared.drain();

      const noParent = await createHead(app, TENANT_A, { code: "np1", name: "No parent", level: 1 });
      expect(noParent.statusCode).toBe(400);
      expect(noParent.json().code ?? noParent.body).toMatch(/HEAD_PARENT_REQUIRED/);

      const wrongLevel = await createHead(app, TENANT_A, { code: "wl1", name: "Wrong level", level: 2, parentId: majorId });
      expect(wrongLevel.statusCode).toBe(400);
      expect(wrongLevel.body).toMatch(/HEAD_PARENT_LEVEL_MISMATCH/);

      const majorWithParent = await createHead(app, TENANT_A, { code: "mp1", name: "Major w parent", level: 0, parentId: majorId });
      expect(majorWithParent.statusCode).toBe(400);
      expect(majorWithParent.body).toMatch(/HEAD_PARENT_NOT_ALLOWED/);

      // tenant-scoped lookup: another tenant's head is not a valid parent
      const foreign = await createHead(app, TENANT_B, { code: `F${Date.now() % 100000}`, name: "Foreign major", level: 0 });
      expect(foreign.statusCode).toBe(202);
      await qShared.drain();
      const crossTenant = await createHead(app, TENANT_A, { code: "ct1", name: "Cross tenant", level: 1, parentId: foreign.json().id });
      expect(crossTenant.statusCode).toBe(400);
      expect(crossTenant.body).toMatch(/HEAD_PARENT_NOT_FOUND/);

      const list = await app.inject({ method: "GET", url: "/v1/finance/accounts?limit=500", headers: auth(TENANT_A) });
      expect(list.statusCode).toBe(200);
      const rows = list.json().data as Array<{ id: string; level: number; parentId: string | null }>;
      const m = rows.find((r) => r.id === minor.json().id)!;
      expect(m.level).toBe(1);
      expect(m.parentId).toBe(majorId);
    } finally {
      await app.close();
    }
  });
});

describe("PATCH /v1/finance/accounts/:id/hoa", () => {
  it("requires a reason, 404s for unknown / other-tenant heads, and writes an audit row with old and new codes", async () => {
    const app = await buildApp();
    try {
      const head = await createHead(app, TENANT_A, { code: `H${Date.now() % 100000}`, name: "HoA head", level: 0, hoaCode: HOA });
      expect(head.statusCode).toBe(202);
      await qShared.drain();
      const id = head.json().id as string;
      const url = `/v1/finance/accounts/${id}/hoa`;

      const noReason = await app.inject({ method: "PATCH", url, headers: auth(TENANT_A), payload: { hoaCode: HOA2 } });
      expect(noReason.statusCode).toBe(400);

      const unknown = await app.inject({ method: "PATCH", url: `/v1/finance/accounts/${randomUUID()}/hoa`, headers: auth(TENANT_A), payload: { hoaCode: HOA2, reason: "Aligning with PFMS" } });
      expect(unknown.statusCode).toBe(404);
      const otherTenant = await app.inject({ method: "PATCH", url, headers: auth(TENANT_B), payload: { hoaCode: HOA2, reason: "Aligning with PFMS" } });
      expect(otherTenant.statusCode).toBe(404);

      const published: Array<{ topic: string; env: any }> = [];
      const spy = vi.spyOn(queue, "publish").mockImplementation(async (topic: string, env: any) => { published.push({ topic, env }); return undefined as never; });
      const ok = await app.inject({ method: "PATCH", url, headers: auth(TENANT_A), payload: { hoaCode: HOA2, reason: "Aligning with PFMS mapping" } });
      spy.mockRestore();
      expect(ok.statusCode).toBe(202);
      expect(ok.json().status).toBe("accepted");
      // applied by the consumer (the request handler no longer writes): run it
      const q = new MemoryQueue({ maxAttempts: 1 });
      const raw = q.subscribe.bind(q);
      q.subscribe = ((topic: string, handler: Handler) => raw(topic, (m: Parameters<Handler>[0]) => runWithTenant(m.tenantId, () => handler(m)))) as typeof q.subscribe;
      registerApprovalsConsumers(q);
      await q.start();
      for (const p of published) await q.publish(p.topic, p.env);
      await q.drain();

      const rows = await runWithTenant(TENANT_A, () =>
        db.transaction(async (tx) => {
          const r: any = await tx.execute(
            sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT_A}::uuid AND payload->>'action' = 'head_hoa_changed' AND payload->>'resourceId' = ${id}`,
          );
          return (Array.isArray(r) ? r : r.rows ?? []) as Array<{ payload: any }>;
        }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payload.details).toMatchObject({ oldHoaCode: HOA, newHoaCode: HOA2, reason: "Aligning with PFMS mapping" });
    } finally {
      await app.close();
    }
  });
});

describe("GET /v1/finance/dashboard?fy=", () => {
  it("rejects a malformed fiscal year and scopes expenditure to the requested FY", async () => {
    const app = await buildApp();
    try {
      for (const bad of ["2026-28", "abc", "2026-27;drop"]) {
        const r = await app.inject({ method: "GET", url: `/v1/finance/dashboard?fy=${encodeURIComponent(bad)}`, headers: auth(TENANT_A) });
        expect(r.statusCode).toBe(400);
      }

      const headId = randomUUID();
      await runWithTenant(TENANT_A, () =>
        db.transaction(async (tx) => {
          await tx.insert(financeLedger).values([
            { tenantId: TENANT_A, headId, debitMinor: 100000n, voucherNo: "FY-A-1", postingDate: "2025-06-15", createdBy: ACTOR, updatedBy: ACTOR },
            { tenantId: TENANT_A, headId, debitMinor: 250000n, voucherNo: "FY-B-1", postingDate: "2026-06-15", createdBy: ACTOR, updatedBy: ACTOR },
          ]);
        }),
      );

      const fy25 = await app.inject({ method: "GET", url: "/v1/finance/dashboard?fy=2025-26", headers: auth(TENANT_A) });
      const fy26 = await app.inject({ method: "GET", url: "/v1/finance/dashboard?fy=2026-27", headers: auth(TENANT_A) });
      const all = await app.inject({ method: "GET", url: "/v1/finance/dashboard", headers: auth(TENANT_A) });
      expect(fy25.json().totalExpenditure).toBe(100000);
      expect(fy26.json().totalExpenditure).toBe(250000);
      expect(all.json().totalExpenditure).toBe(350000);
    } finally {
      await app.close();
    }
  });
});
