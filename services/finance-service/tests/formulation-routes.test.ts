/**
 * SVC-031 — budget formulation HTTP integration against the dev DB.
 *
 * Proves: create → submit → review → maker-checker approve (self-approve blocked),
 * revision versioning, consolidation aggregate, RLS isolation, role gating.
 *
 * F3 CQRS: every mutation here (create/submit/review/revise/approve) publishes
 * a command and returns 202 immediately — see formulation-routes.ts, every
 * handler ends `reply.code(202).send({ data: { id, status: "accepted" } })`.
 * That envelope is generic, not the created/updated resource, so any assertion
 * on domain fields (status, version, parentId, breachMinor, ...) is rewritten
 * below to drain() the queue (MemoryQueue.publish is fire-and-forget — see
 * @civitasone/queue-service's bus.ts) and then GET the resource. Consumers are
 * registered in beforeAll, mirroring supplementary-routes.test.ts.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { scoped } from "./_tenant.js";
import { financeBudgetProposals } from "../src/modules/budget/formulation-schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000fa031";
const TENANT_B = "aaaaaaaa-1111-4000-8000-0000000fb031";
const MAKER   = "00000000-aaaa-4000-8000-00000000a031";
const CHECKER = "00000000-aaaa-4000-8000-00000000c031";
const HEAD_1  = "00000000-bbbb-4000-8000-00000000a031";
const HEAD_2  = "00000000-bbbb-4000-8000-00000000b031";

function token(tenant: string, roles: string[], sub: string) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-frm" }, SECRET);
}
async function cleanup() {
  for (const t of [TENANT_A, TENANT_B]) {
    await scoped(t, (tx) => tx.delete(financeBudgetProposals).where(eq(financeBudgetProposals.fy, "2026-27")));
  }
}
async function drain() {
  await (queue as MemoryQueue).drain();
}

beforeAll(() => {
  registerBudgetConsumers(queue);
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

const officer = (t = TENANT_A, sub = MAKER) => ({ authorization: `Bearer ${token(t, ["finance_officer"], sub)}` });
const admin = (t = TENANT_A, sub = CHECKER) => ({ authorization: `Bearer ${token(t, ["finance_admin"], sub)}` });

describe("SVC-031 formulation — flow", () => {
  it("create(within ceiling) → submit → review accept → checker approves + event", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST", url: "/v1/finance/budget-proposals", headers: officer(),
        payload: { fy: "2026-27", deptCode: "PWD", headId: HEAD_1, ceilingMinor: 100000000, proposedMinor: 90000000, justification: "" },
      });
      expect(created.statusCode).toBe(202);
      const id = created.json().data.id as string;
      await drain();

      const afterCreate = await app.inject({ method: "GET", url: `/v1/finance/budget-proposals/${id}`, headers: officer() });
      expect(afterCreate.json().data.status).toBe("draft");
      expect(afterCreate.json().data.breachMinor).toBe("0");

      expect((await app.inject({ method: "PATCH", url: `/v1/finance/budget-proposals/${id}/submit`, headers: officer() })).statusCode).toBe(202);
      await drain();

      const rev = await app.inject({
        method: "PATCH", url: `/v1/finance/budget-proposals/${id}/review`, headers: admin(),
        payload: { decision: "accept", note: "ceilings respected, recommend approval" },
      });
      expect(rev.statusCode).toBe(202);
      await drain();
      expect((await app.inject({ method: "GET", url: `/v1/finance/budget-proposals/${id}`, headers: officer() })).json().data.status)
        .toBe("under_review");

      // maker cannot self-approve — assertProposalApproverDistinct now runs
      // synchronously in the route (see formulation-routes.ts), so this is
      // rejected before ever reaching the queue: no drain() needed here.
      const self = await app.inject({
        method: "PATCH", url: `/v1/finance/budget-proposals/${id}/approve`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
      });
      expect(self.statusCode).toBe(409);
      expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
      // Confirm the self-approve attempt did not change state.
      expect((await app.inject({ method: "GET", url: `/v1/finance/budget-proposals/${id}`, headers: officer() })).json().data.status)
        .toBe("under_review");

      const appr = await app.inject({ method: "PATCH", url: `/v1/finance/budget-proposals/${id}/approve`, headers: admin() });
      expect(appr.statusCode).toBe(202);
      await drain();
      expect((await app.inject({ method: "GET", url: `/v1/finance/budget-proposals/${id}`, headers: officer() })).json().data.status)
        .toBe("approved");

      const events = await scoped(TENANT_A, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A)));
      expect(events.some((e) => e.eventType === "finance.budget.proposal_approved"
        && (e.payload as { proposalId?: string }).proposalId === id)).toBe(true);
    } finally { await app.close(); }
  });

  it("rejects an unjustified ceiling breach with 400", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/budget-proposals", headers: officer(),
        payload: { fy: "2026-27", deptCode: "PWD", headId: HEAD_1, ceilingMinor: 100000000, proposedMinor: 150000000, justification: "" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("CEILING_BREACH");
    } finally { await app.close(); }
  });

  it("revision creates a new version linked to its parent", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST", url: "/v1/finance/budget-proposals", headers: officer(),
        payload: { fy: "2026-27", deptCode: "EDU", headId: HEAD_2, ceilingMinor: 50000000, proposedMinor: 40000000, justification: "" },
      });
      const id = created.json().data.id as string;
      await drain();
      await app.inject({ method: "PATCH", url: `/v1/finance/budget-proposals/${id}/submit`, headers: officer() });
      await drain();
      await app.inject({ method: "PATCH", url: `/v1/finance/budget-proposals/${id}/review`, headers: admin(), payload: { decision: "return", note: "trim by 10%" } });
      await drain();

      const revised = await app.inject({
        method: "POST", url: `/v1/finance/budget-proposals/${id}/revise`, headers: officer(),
        payload: { proposedMinor: 36000000, justification: "revised down per review" },
      });
      expect(revised.statusCode).toBe(202);
      const newId = revised.json().data.id as string;
      await drain();

      const got = await app.inject({ method: "GET", url: `/v1/finance/budget-proposals/${newId}`, headers: officer() });
      expect(got.json().data.version).toBe(2);
      expect(got.json().data.parentId).toBe(id);
      expect(got.json().data.proposedMinor).toBe("36000000");
    } finally { await app.close(); }
  });

  it("consolidation sums approved proposals for the FY", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      async function approve(dept: string, head: string, ceiling: number, proposed: number) {
        const c = await app.inject({
          method: "POST", url: "/v1/finance/budget-proposals", headers: officer(),
          payload: { fy: "2026-27", deptCode: dept, headId: head, ceilingMinor: ceiling, proposedMinor: proposed, justification: proposed > ceiling ? "justified breach for consolidation test" : "" },
        });
        const id = c.json().data.id as string;
        await drain();
        await app.inject({ method: "PATCH", url: `/v1/finance/budget-proposals/${id}/submit`, headers: officer() });
        await drain();
        await app.inject({ method: "PATCH", url: `/v1/finance/budget-proposals/${id}/approve`, headers: admin() });
        await drain();
      }
      await approve("PWD", HEAD_1, 100000000, 120000000);
      await approve("EDU", HEAD_2, 200000000, 150000000);

      const cons = await app.inject({ method: "GET", url: "/v1/finance/budget-proposals/consolidation?fy=2026-27", headers: admin() });
      expect(cons.statusCode).toBe(200);
      const body = cons.json();
      expect(body.count).toBe(2);
      expect(body.totalCeilingMinor).toBe("300000000");
      expect(body.totalProposedMinor).toBe("270000000");
      expect(body.totalBreachMinor).toBe("0"); // aggregate demand within aggregate ceiling
    } finally { await app.close(); }
  });

  it("RLS: tenant B cannot see tenant A proposals", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      await app.inject({
        method: "POST", url: "/v1/finance/budget-proposals", headers: officer(),
        payload: { fy: "2026-27", deptCode: "PWD", headId: HEAD_1, ceilingMinor: 100000000, proposedMinor: 90000000, justification: "" },
      });
      await drain();
      const listB = await app.inject({ method: "GET", url: "/v1/finance/budget-proposals?fy=2026-27", headers: admin(TENANT_B, CHECKER) });
      expect(listB.statusCode).toBe(200);
      expect((listB.json().data as unknown[]).length).toBe(0);
    } finally { await app.close(); }
  });

  it("403 for a non-finance role", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/budget-proposals",
        headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"], MAKER)}` },
        payload: { fy: "2026-27", deptCode: "PWD", headId: HEAD_1, ceilingMinor: 1, proposedMinor: 1, justification: "" },
      });
      expect(res.statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
