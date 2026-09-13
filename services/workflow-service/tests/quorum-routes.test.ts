/** CAP-026 — committee/quorum routes: voting, majority decision, idempotency. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { getCapturedErrorCountByService } from "@civitasone/observability";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerQuorumConsumers } from "../src/modules/quorum/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a6000000-1111-4000-8000-000000000001";

function token(actorId: string, roles = ["workflow_admin"]) {
  return signToken({ sub: actorId, tid: TENANT, roles, sid: "s" }, SECRET);
}

registerQuorumConsumers(queue);
await queue.start();

afterEach(async () => {
  await db.execute(sql`DELETE FROM workflow.committee_votes WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM workflow.committee_decisions WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

async function openDecision(app: Awaited<ReturnType<typeof buildApp>>, body: Record<string, unknown>) {
  const res = await app.inject({
    method: "POST", url: "/v1/workflow/committee-decisions",
    headers: { authorization: `Bearer ${token(randomUUID())}` }, payload: body,
  });
  expect(res.statusCode).toBe(202);
  const id = res.json().id as string;
  // The decision must actually be persisted before votes (which 404 on a
  // missing decision) can be cast against it.
  await waitFor(async () => {
    const g = await app.inject({ method: "GET", url: `/v1/workflow/committee-decisions/${id}`, headers: { authorization: `Bearer ${token(randomUUID())}` } });
    return g.statusCode === 200 ? g : null;
  });
  return id;
}

async function castVoteAndWaitForTally(app: Awaited<ReturnType<typeof buildApp>>, id: string, voter: string, choice: string, minCast: number) {
  const res = await app.inject({
    method: "POST", url: `/v1/workflow/committee-decisions/${id}/votes`,
    headers: { authorization: `Bearer ${token(voter)}` }, payload: { vote: choice },
  });
  expect(res.statusCode).toBe(202);
  return waitFor(async () => {
    const g = await app.inject({ method: "GET", url: `/v1/workflow/committee-decisions/${id}`, headers: { authorization: `Bearer ${token(voter)}` } });
    const data = g.json().data;
    return data.tally.cast >= minCast ? data : null;
  });
}

describe("CAP-026 quorum majority via votes", () => {
  it("settles a 3-of-5 majority once the third approval lands", async () => {
    const app = await buildApp();
    const id = await openDecision(app, { subject: "Award tender", rule: "majority", totalMembers: 5 });

    const r1 = await castVoteAndWaitForTally(app, id, randomUUID(), "approve", 1);
    expect(r1.tally.decided).toBe(false);
    await castVoteAndWaitForTally(app, id, randomUUID(), "approve", 2);
    const r3 = await castVoteAndWaitForTally(app, id, randomUUID(), "approve", 3);
    await app.close();
    expect(r3.tally.decided).toBe(true);
    expect(r3.tally.outcome).toBe("approve");
    expect(r3.decision.status).toBe("decided");
  });
});

describe("CAP-026 unanimous decision", () => {
  it("rejects the instant a member rejects", async () => {
    const app = await buildApp();
    const id = await openDecision(app, { subject: "Bylaw", rule: "unanimous", totalMembers: 3 });
    await castVoteAndWaitForTally(app, id, randomUUID(), "approve", 1);
    const r2 = await castVoteAndWaitForTally(app, id, randomUUID(), "reject", 2);
    await app.close();
    expect(r2.tally.outcome).toBe("reject");
    // REL-025: this rule/outcome combination (reject via unanimity-broken,
    // rather than majority approve) was never asserted here, so a status-
    // persistence regression specific to the reject path could have hidden
    // behind a passing test. Investigated as part of REL-025 and found to
    // already pass reliably (repeated local runs against an isolated,
    // freshly migrated Postgres) -- asserted permanently so it stays proven.
    expect(r2.decision.status).toBe("decided");
  });
});

describe("CAP-026 threshold decision", () => {
  it("settles the instant the threshold is met", async () => {
    const app = await buildApp();
    const id = await openDecision(app, { subject: "Emergency spend", rule: "threshold", threshold: 2, totalMembers: 4 });
    await castVoteAndWaitForTally(app, id, randomUUID(), "approve", 1);
    const r2 = await castVoteAndWaitForTally(app, id, randomUUID(), "approve", 2);
    await app.close();
    expect(r2.tally.decided).toBe(true);
    expect(r2.tally.outcome).toBe("approve");
    // REL-025's DoD covers all three rules (majority/unanimous/threshold);
    // this was the one rule with no test at all for the decided-status
    // transition. Investigated as part of REL-025 and found to already pass
    // reliably -- asserted permanently so it stays proven.
    expect(r2.decision.status).toBe("decided");
  });
});

describe("CAP-026 vote idempotency", () => {
  it("counts a voter once even on repeat submission", async () => {
    const app = await buildApp();
    const id = await openDecision(app, { subject: "X", rule: "threshold", threshold: 2, totalMembers: 3 });
    const voter = randomUUID();
    await castVoteAndWaitForTally(app, id, voter, "approve", 1);
    // A repeat vote from the same voter is answered synchronously (see
    // routes.ts's duplicate-vote pre-check) -- no async wait needed.
    const dup = await app.inject({ method: "POST", url: `/v1/workflow/committee-decisions/${id}/votes`, headers: { authorization: `Bearer ${token(voter)}` }, payload: { vote: "approve" } });
    await app.close();
    expect(dup.json().message).toMatch(/already voted/);
    expect(dup.json().data.tally.approvals).toBe(1); // not double-counted
    expect(dup.json().data.tally.decided).toBe(false);
  });
});

describe("REL-031 late vote after decision settled", () => {
  it("never silently drops a vote cast after the decision is already decided", async () => {
    const app = await buildApp();
    // threshold=1 so a single approve vote immediately decides it, leaving
    // the decision "decided" for every voter after the first.
    const id = await openDecision(app, { subject: "Emergency grant", rule: "threshold", threshold: 1, totalMembers: 5 });
    const firstVoter = randomUUID();
    const r1 = await castVoteAndWaitForTally(app, id, firstVoter, "approve", 1);
    expect(r1.tally.decided).toBe(true);
    expect(r1.decision.status).toBe("decided");

    const before = getCapturedErrorCountByService("workflow-service");

    // A SECOND, brand-new voter (never voted -- this is NOT the "already
    // voted" duplicate path covered above) casts a vote after the decision
    // has already settled. routes.ts's synchronous pre-check only short-
    // circuits a REPEAT vote from the SAME voter, so this one is accepted
    // (202) and dispatched to the async consumer exactly like any other
    // vote -- which is exactly the path castVoteTx's `else if (decision.
    // status === "open")` guard used to drop with zero trace.
    const lateVoter = randomUUID();
    const res = await app.inject({
      method: "POST", url: `/v1/workflow/committee-decisions/${id}/votes`,
      headers: { authorization: `Bearer ${token(lateVoter)}` }, payload: { vote: "approve" },
    });
    expect(res.statusCode).toBe(202);

    // REL-031: before this fix, the late vote vanished here with zero trace
    // -- not inserted, no thrown error, no log, no metric. If the fix
    // regresses, this poll runs to its full timeout and throws -- that IS
    // the failure this regression test exists to catch.
    await waitFor(async () => {
      const n = getCapturedErrorCountByService("workflow-service");
      return n > before ? n : null;
    });

    // Visibility only -- REL-031 explicitly does NOT decide whether a late
    // vote should ever count toward the tally (a committee-governance /
    // product call, out of scope here). Assert the pre-existing "not
    // counted" behavior is unchanged: still 1 vote, still the first voter's.
    const g = await app.inject({ method: "GET", url: `/v1/workflow/committee-decisions/${id}`, headers: { authorization: `Bearer ${token(lateVoter)}` } });
    await app.close();
    const data = g.json().data as { votes: Array<{ voterId: string }>; tally: { cast: number }; decision: { status: string } };
    expect(data.votes).toHaveLength(1);
    expect(data.votes.some((v) => v.voterId === lateVoter)).toBe(false);
    expect(data.tally.cast).toBe(1);
    expect(data.decision.status).toBe("decided");
  });
});
