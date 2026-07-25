/** CAP-025 — authority routes: maker-checker, escalation check, RLS. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a5000000-1111-4000-8000-000000000001";
const TENANT_B = "a5000000-1111-4000-8000-000000000002";
const MAKER = "a5000000-2222-4000-8000-000000000001";
const CHECKER = "a5000000-2222-4000-8000-000000000002";

function token(actorId: string, tid = TENANT, roles = ["workflow_admin"]) {
  return signToken({ sub: actorId, tid, roles, sid: "s" }, SECRET);
}

afterEach(async () => {
  await db.execute(sql`DELETE FROM workflow.authority_limits WHERE tenant_id IN (${TENANT}, ${TENANT_B})`);
});
afterAll(async () => { await sqlClient.end(); });

async function createLimit(app: Awaited<ReturnType<typeof buildApp>>, actor: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST", url: "/v1/workflow/authority/limits",
    headers: { authorization: `Bearer ${token(actor)}` }, payload: body,
  });
}

describe("CAP-025 authority maker-checker", () => {
  it("creates a limit in draft (maker) and forbids self-approval (checker must differ)", async () => {
    const app = await buildApp();
    const res = await createLimit(app, MAKER, {
      scopeType: "role", scopeRef: "officer", authorityType: "financial",
      maxAmount: 100000, effectiveFrom: "2025-01-01",
      escalateToScopeType: "role", escalateToRef: "director",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("draft");
    const id = res.json().data.id;

    const self = await app.inject({
      method: "POST", url: `/v1/workflow/authority/limits/${id}/approve`,
      headers: { authorization: `Bearer ${token(MAKER)}` },
    });
    expect(self.statusCode).toBe(409); // SELF_APPROVAL_FORBIDDEN

    const ok = await app.inject({
      method: "POST", url: `/v1/workflow/authority/limits/${id}/approve`,
      headers: { authorization: `Bearer ${token(CHECKER)}` },
    });
    await app.close();
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.status).toBe("active");
    expect(ok.json().data.approvedBy).toBe(CHECKER);
  });
});

describe("CAP-025 authority check (limit-exceed escalation)", () => {
  it("routes an over-limit amount to the escalation approver", async () => {
    const app = await buildApp();
    // officer(100k)→director(1M); both active
    for (const [ref, amt, escRef] of [["officer", 100000, "director"], ["director", 1000000, null]] as const) {
      const c = await createLimit(app, MAKER, {
        scopeType: "role", scopeRef: ref, maxAmount: amt, effectiveFrom: "2025-01-01",
        ...(escRef ? { escalateToScopeType: "role", escalateToRef: escRef } : {}),
      });
      await app.inject({
        method: "POST", url: `/v1/workflow/authority/limits/${c.json().data.id}/approve`,
        headers: { authorization: `Bearer ${token(CHECKER)}` },
      });
    }
    const res = await app.inject({
      method: "POST", url: "/v1/workflow/authority/check",
      headers: { authorization: `Bearer ${token(MAKER)}` },
      payload: { authorityType: "financial", amount: 500000, onDate: "2025-06-01", scopes: [{ scopeType: "role", scopeRef: "officer" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.withinActorAuthority).toBe(false);
    expect(d.requiresEscalation).toBe(true);
    expect(d.finalApprover.scopeRef).toBe("director");
    expect(d.covered).toBe(true);
  });
});

describe("CAP-025 RLS — cross-tenant isolation", () => {
  it("does not leak tenant A's limits to tenant B", async () => {
    const app = await buildApp();
    await createLimit(app, MAKER, { scopeType: "role", scopeRef: "officer", maxAmount: 1000, effectiveFrom: "2025-01-01" });
    const listB = await app.inject({
      method: "GET", url: "/v1/workflow/authority/limits",
      headers: { authorization: `Bearer ${token(randomUUID(), TENANT_B)}` },
    });
    await app.close();
    expect(listB.statusCode).toBe(200);
    expect(listB.json().data).toEqual([]);
  });
});
