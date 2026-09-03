/**
 * SVC-033 — allocation distribution HTTP integration against the dev DB.
 *
 * Proves: original allocation → distribution to subordinate offices, the
 * over-distribution guard (availability recompute), issue + effective-dating,
 * acknowledgement SoD (self-acknowledge blocked), the outbox event, RLS
 * isolation, role gating.
 *
 * F3 CQRS: budget-allocations and allocation-distributions mutations publish a
 * command and return 202 immediately (see allocation-routes.ts /
 * distribution-routes.ts — every mutating handler ends
 * `reply.code(202).send({ data: { id, status: "accepted" } })`). That envelope
 * is generic, not the created/updated resource, so any assertion on domain
 * fields is rewritten below to drain() the queue (MemoryQueue.publish is
 * fire-and-forget — see @civitasone/queue-service's bus.ts) and then GET the
 * resource. Consumers are registered in beforeAll, mirroring
 * supplementary-routes.test.ts.
 *
 * Two synchronous pre-accept checks were added to distribution-routes.ts in
 * this change (mirroring the consumer's own guards) so this file's over-
 * distribution and self-acknowledge assertions can stay meaningful at the
 * HTTP layer instead of only observable after a drain():
 *   - POST /allocation-distributions: parent allocation existence + within-
 *     headroom (assertWithinAllocation), read-only, no lock.
 *   - PATCH /allocation-distributions/:id/acknowledge: acknowledger-distinct
 *     (assertAcknowledgerDistinct), read-only, no lock.
 * See the "concurrent distributions" test below for why the create-side check
 * narrows but cannot fully close the TOCTOU window, unlike the acknowledge
 * check which fully closes its (non-racy, identity-only) gap.
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
import { financeAllocationDistributions } from "../src/modules/budget/distribution-schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000fa033";
const TENANT_B = "aaaaaaaa-1111-4000-8000-0000000fb033";
const ISSUER   = "00000000-aaaa-4000-8000-00000000a033";
const RECEIVER = "00000000-aaaa-4000-8000-00000000c033";
const HEAD     = "00000000-bbbb-4000-8000-00000000a033";
const OFFICE_HQ = "00000000-cccc-4000-8000-000000000001";
const OFFICE_A  = "00000000-cccc-4000-8000-000000000002";
const OFFICE_B  = "00000000-cccc-4000-8000-000000000003";
const OFFICE_C  = "00000000-cccc-4000-8000-000000000004";
const FY = "2027-28";

function token(tenant: string, roles: string[], sub: string) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-dist" }, SECRET);
}
const officer = (t = TENANT_A, sub = ISSUER) => ({ authorization: `Bearer ${token(t, ["finance_officer"], sub)}` });

async function drain() {
  await (queue as MemoryQueue).drain();
}

async function cleanup() {
  for (const t of [TENANT_A, TENANT_B]) {
    await scoped(t, (tx) => tx.delete(financeAllocationDistributions).where(eq(financeAllocationDistributions.fy, FY)));
    await scoped(t, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.headId, HEAD)));
  }
}

// budget.finance_budget_allocation.head_id carries an FK to budget.finance_heads
// (migrations/0055_add_foreign_keys.sql, fk_falloc_head) — discovered while
// fixing this file: makeAllocation()'s POST was accepted (202) and drained
// clean, but the async consumer's insert then silently failed this FK and
// landed in the DLQ (never surfacing to the HTTP caller — the fire-and-forget
// queue.publish already returned 202 by then), so every downstream read of the
// allocation 404'd. Seed the referenced head row once, same shape as the
// established pattern in bigint-precision.test.ts.
async function seedHead() {
  await scoped(TENANT_A, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT_A, code: "SVC-033-TEST-HEAD", name: "SVC-033 distribution test head",
    level: 1, createdBy: ISSUER, updatedBy: ISSUER,
  }).onConflictDoNothing());
}

beforeAll(async () => {
  registerBudgetConsumers(queue);
  await seedHead();
});
afterAll(async () => {
  await cleanup();
  await scoped(TENANT_A, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD))).catch(() => {});
  await sqlClient.end();
});

async function makeAllocation(app: Awaited<ReturnType<typeof buildApp>>, tenant: string, sub: string): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/finance/budget-allocations",
    headers: { authorization: `Bearer ${token(tenant, ["finance_officer"], sub)}` },
    payload: { headId: HEAD, fy: FY, allocatedMinor: 1000000000 },
  });
  expect(res.statusCode).toBe(202);
  const id = res.json().data.id as string;
  await drain();
  return id;
}

describe("SVC-033 allocation distribution — flow", () => {
  it("distributes within the allocation, blocks over-distribution, recomputes availability", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const allocationId = await makeAllocation(app, TENANT_A, ISSUER);

      // distribute 600 of 1000
      const d1 = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_A, amountMinor: 600000000, conditions: "utilise by Q3" },
      });
      expect(d1.statusCode).toBe(202);
      const distId = d1.json().data.id as string;
      await drain();

      const afterD1 = await app.inject({ method: "GET", url: `/v1/finance/allocation-distributions/${distId}`, headers: officer() });
      expect(afterD1.json().data.status).toBe("draft");
      expect(afterD1.json().data.conditions).toBe("utilise by Q3");

      // distribute 500 more → exceeds remaining 400. The route's synchronous
      // pre-check (added in this change) rejects this before ever publishing,
      // so no drain() is needed to observe it.
      const d2 = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_B, amountMinor: 500000000 },
      });
      expect(d2.statusCode).toBe(409);
      expect(d2.json().code).toBe("DISTRIBUTION_EXCEEDS_ALLOCATION");

      // distribute remaining 400 → ok
      const d3 = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_C, amountMinor: 400000000 },
      });
      expect(d3.statusCode).toBe(202);
      await drain();

      // summary: distributed 1000, remaining 0
      const summary = await app.inject({
        method: "GET", url: `/v1/finance/budget-allocations/${allocationId}/distribution-summary`, headers: officer(),
      });
      expect(summary.statusCode).toBe(200);
      expect(summary.json().distributedMinor).toBe("1000000000");
      expect(summary.json().remainingMinor).toBe("0");

      // issue d1 → event
      const issued = await app.inject({ method: "PATCH", url: `/v1/finance/allocation-distributions/${distId}/issue`, headers: officer() });
      expect(issued.statusCode).toBe(202);
      await drain();
      const afterIssue = await app.inject({ method: "GET", url: `/v1/finance/allocation-distributions/${distId}`, headers: officer() });
      expect(afterIssue.json().data.status).toBe("issued");

      const events = await scoped(TENANT_A, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A)));
      expect(events.some((e) => e.eventType === "finance.budget.allocation_distributed"
        && (e.payload as { distributionId?: string }).distributionId === distId)).toBe(true);

      // issuer cannot self-acknowledge — assertAcknowledgerDistinct now runs
      // synchronously in the route (see distribution-routes.ts), so this is
      // rejected before ever reaching the queue: no drain() needed here.
      const selfAck = await app.inject({
        method: "PATCH", url: `/v1/finance/allocation-distributions/${distId}/acknowledge`, headers: officer(),
        payload: { note: "self ack" },
      });
      expect(selfAck.statusCode).toBe(409);
      expect(selfAck.json().code).toBe("MAKER_CHECKER_VIOLATION");

      // receiving office (distinct) acknowledges
      const ack = await app.inject({
        method: "PATCH", url: `/v1/finance/allocation-distributions/${distId}/acknowledge`,
        headers: officer(TENANT_A, RECEIVER), payload: { note: "received and noted" },
      });
      expect(ack.statusCode).toBe(202);
      await drain();
      const afterAck = await app.inject({ method: "GET", url: `/v1/finance/allocation-distributions/${distId}`, headers: officer() });
      expect(afterAck.json().data.status).toBe("acknowledged");
      expect(afterAck.json().data.acknowledgeNote).toBe("received and noted");
    } finally { await app.close(); }
  });

  // SVC-033 over-distribution TOCTOU regression. Two distributions that each fit
  // the remaining headroom individually (600 + 600) but jointly exceed the 1000
  // allocation are fired concurrently via Promise.all.
  //
  // FLAGGED (see PR description for the full writeup): this test originally
  // expected the two HTTP responses themselves to carry the race decision
  // (codes === [201, 409]), on the assumption that a synchronous transaction
  // with a FOR UPDATE lock served the request directly. That assumption no
  // longer holds — this route is F3 CQRS: POST publishes a command and returns
  // 202 immediately via a genuinely fire-and-forget queue.publish
  // (MemoryQueue.publish schedules delivery with setTimeout(0) and returns
  // before any handler runs — see @civitasone/queue-service's bus.ts). The
  // synchronous pre-check added in this change (existence + headroom, see
  // distribution-routes.ts) reads the CURRENTLY LANDED distributed sum. Most
  // of the time that is 0 for both concurrent requests (neither has been
  // applied by the consumer yet), so both legitimately receive 202 — but
  // because the pre-check itself does two real, awaited DB round trips, real
  // scheduling/IO jitter between the two requests occasionally lets one
  // request's async apply land (via the consumer's own FOR UPDATE lock)
  // before the other's pre-check reads the sum, in which case the second
  // request's pre-check *correctly* returns a synchronous 409 too — it isn't
  // wrong when that happens, it's just not guaranteed either way. So this
  // test intentionally does not assert a specific pair of HTTP status codes;
  // it only pins each individual response to a legitimate outcome (202
  // accepted, or 409 caught early) and then asserts the one thing that IS
  // deterministic: the persisted invariant, checked below.
  //
  // This is not a test gap to paper over: taking a lock inside the pre-check
  // itself would not fix it either, because the lock would guard only the
  // read-then-compare, not the actual persist (which happens later, inside the
  // consumer's own separate transaction via lockAllocationByIdTx in
  // distribution-repo.ts) — a second request's pre-check would still observe
  // distributed=0 after the first's lock is released and the first's write
  // still hasn't landed. Truly closing this race requires either performing
  // the write synchronously in the route (abandoning the CQRS/async-apply
  // model for this endpoint) or having the route block on consumer delivery
  // (abandoning fire-and-forget) — both are real architectural decisions, so
  // left as a follow-up rather than guessed at here.
  //
  // What we CAN and do verify: the consumer's own FOR UPDATE lock still
  // correctly serialises the two ASYNC applies, so the invariant this test
  // actually cares about — the allocation is never jointly overdrawn — holds
  // once both requests have drained, even though neither HTTP response can
  // reflect that outcome synchronously.
  it("concurrent distributions cannot jointly overdraw the allocation (TOCTOU race)", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const allocationId = await makeAllocation(app, TENANT_A, ISSUER);
      const mk = (toOfficeId: string) => app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId, amountMinor: 600000000 },
      });
      // 600M + 600M = 1200M > 1000M allocated: at most one may ultimately persist.
      const [r1, r2] = await Promise.all([mk(OFFICE_A), mk(OFFICE_B)]);
      // Each response is independently either "accepted" (202 — the common
      // case, decided later by the consumer's row lock) or "caught early"
      // (409 — possible but not guaranteed, see comment above). Neither
      // response can be relied on to reflect the OTHER request's outcome.
      for (const r of [r1, r2]) expect([202, 409]).toContain(r.statusCode);
      await drain();

      // Persisted, committed sum must be within the allocation (exactly one 600M row).
      const rows = await scoped(TENANT_A, (tx) => tx.select().from(financeAllocationDistributions)
        .where(eq(financeAllocationDistributions.allocationId, allocationId)));
      expect(rows.length).toBe(1);
      const persisted = rows.reduce((acc, r) => acc + BigInt(r.amountMinor as unknown as string), 0n);
      expect(persisted <= 1000000000n).toBe(true);
    } finally { await app.close(); }
  });

  it("RLS: tenant B cannot see tenant A distributions", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const allocationId = await makeAllocation(app, TENANT_A, ISSUER);
      await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_A, amountMinor: 100000000 },
      });
      await drain();
      const listB = await app.inject({
        method: "GET", url: `/v1/finance/allocation-distributions?fy=${FY}`,
        headers: officer(TENANT_B, RECEIVER),
      });
      expect(listB.statusCode).toBe(200);
      expect((listB.json().data as unknown[]).length).toBe(0);
    } finally { await app.close(); }
  });

  it("rejects a distribution to the same office (distinct-office guard)", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const allocationId = await makeAllocation(app, TENANT_A, ISSUER);
      const res = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_HQ, amountMinor: 1000 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_DISTRIBUTION");
    } finally { await app.close(); }
  });

  it("403 for a non-finance role", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions",
        headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"], ISSUER)}` },
        payload: { allocationId: OFFICE_A, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_A, amountMinor: 1 },
      });
      expect(res.statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
