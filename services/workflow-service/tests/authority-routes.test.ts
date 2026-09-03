/** CAP-025 — authority routes: maker-checker, escalation check, RLS. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAuthorityConsumers } from "../src/modules/authority/consumer.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a5000000-1111-4000-8000-000000000001";
const TENANT_B = "a5000000-1111-4000-8000-000000000002";
const MAKER = "a5000000-2222-4000-8000-000000000001";
const CHECKER = "a5000000-2222-4000-8000-000000000002";

function token(actorId: string, tid = TENANT, roles = ["workflow_admin"]) {
  return signToken({ sub: actorId, tid, roles, sid: "s" }, SECRET);
}

registerAuthorityConsumers(queue);
await queue.start();

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

type LimitView = { id: string; scopeRef: string; status: string; approvedBy: string | null };

async function findLimit(app: Awaited<ReturnType<typeof buildApp>>, actor: string, scopeRef: string): Promise<LimitView> {
  return waitFor(async () => {
    const g = await app.inject({
      method: "GET", url: "/v1/workflow/authority/limits",
      headers: { authorization: `Bearer ${token(actor)}` },
    });
    const rows = g.json().data as LimitView[];
    return rows.find((r) => r.scopeRef === scopeRef) ?? null;
  });
}

afterEach(async () => {
  // RLS (workflow_svc is NOBYPASSRLS, #146): a bare db.execute() runs with no
  // app.tenant_id GUC set, so the fail-closed policy silently matches ZERO
  // rows and this cleanup would no-op, leaking limits into every later run
  // against the shared test DB. Must go through sqlAsTenant per tenant.
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.authority_limits WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT_B, sql`DELETE FROM workflow.authority_limits WHERE tenant_id = ${TENANT_B}`);
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
    expect(res.statusCode).toBe(202);
    const draft = await findLimit(app, MAKER, "officer");
    expect(draft.status).toBe("draft");
    const id = draft.id;

    const self = await app.inject({
      method: "POST", url: `/v1/workflow/authority/limits/${id}/approve`,
      headers: { authorization: `Bearer ${token(MAKER)}` },
    });
    expect(self.statusCode).toBe(409); // SELF_APPROVAL_FORBIDDEN

    const ok = await app.inject({
      method: "POST", url: `/v1/workflow/authority/limits/${id}/approve`,
      headers: { authorization: `Bearer ${token(CHECKER)}` },
    });
    expect(ok.statusCode).toBe(202);
    const active = await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: "/v1/workflow/authority/limits",
        headers: { authorization: `Bearer ${token(MAKER)}` },
      });
      const rows = g.json().data as LimitView[];
      const row = rows.find((r) => r.id === id);
      return row && row.status === "active" ? row : null;
    });
    await app.close();
    expect(active.status).toBe("active");
    expect(active.approvedBy).toBe(CHECKER);
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
      expect(c.statusCode).toBe(202);
      const draft = await findLimit(app, MAKER, ref);
      const appr = await app.inject({
        method: "POST", url: `/v1/workflow/authority/limits/${draft.id}/approve`,
        headers: { authorization: `Bearer ${token(CHECKER)}` },
      });
      expect(appr.statusCode).toBe(202);
      await waitFor(async () => {
        const g = await app.inject({
          method: "GET", url: "/v1/workflow/authority/limits",
          headers: { authorization: `Bearer ${token(MAKER)}` },
        });
        const rows = g.json().data as LimitView[];
        const row = rows.find((r) => r.id === draft.id);
        return row && row.status === "active" ? row : null;
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
