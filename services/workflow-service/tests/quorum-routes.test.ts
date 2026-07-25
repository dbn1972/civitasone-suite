/** CAP-026 — committee/quorum routes: voting, majority decision, idempotency. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a6000000-1111-4000-8000-000000000001";

function token(actorId: string, roles = ["workflow_admin"]) {
  return signToken({ sub: actorId, tid: TENANT, roles, sid: "s" }, SECRET);
}

afterEach(async () => {
  await db.execute(sql`DELETE FROM workflow.committee_votes WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM workflow.committee_decisions WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

async function openDecision(app: Awaited<ReturnType<typeof buildApp>>, body: Record<string, unknown>) {
  return app.inject({
    method: "POST", url: "/v1/workflow/committee-decisions",
    headers: { authorization: `Bearer ${token(randomUUID())}` }, payload: body,
  });
}

describe("CAP-026 quorum majority via votes", () => {
  it("settles a 3-of-5 majority once the third approval lands", async () => {
    const app = await buildApp();
    const d = await openDecision(app, { subject: "Award tender", rule: "majority", totalMembers: 5 });
    const id = d.json().data.id;

    const vote = (voter: string, choice: string) => app.inject({
      method: "POST", url: `/v1/workflow/committee-decisions/${id}/votes`,
      headers: { authorization: `Bearer ${token(voter)}` }, payload: { vote: choice },
    });

    const r1 = await vote(randomUUID(), "approve");
    expect(r1.json().data.tally.decided).toBe(false);
    await vote(randomUUID(), "approve");
    const r3 = await vote(randomUUID(), "approve");
    await app.close();
    expect(r3.json().data.tally.decided).toBe(true);
    expect(r3.json().data.tally.outcome).toBe("approve");
    expect(r3.json().data.decision.status).toBe("decided");
  });
});

describe("CAP-026 unanimous decision", () => {
  it("rejects the instant a member rejects", async () => {
    const app = await buildApp();
    const d = await openDecision(app, { subject: "Bylaw", rule: "unanimous", totalMembers: 3 });
    const id = d.json().data.id;
    await app.inject({ method: "POST", url: `/v1/workflow/committee-decisions/${id}/votes`, headers: { authorization: `Bearer ${token(randomUUID())}` }, payload: { vote: "approve" } });
    const rej = await app.inject({ method: "POST", url: `/v1/workflow/committee-decisions/${id}/votes`, headers: { authorization: `Bearer ${token(randomUUID())}` }, payload: { vote: "reject" } });
    await app.close();
    expect(rej.json().data.tally.outcome).toBe("reject");
  });
});

describe("CAP-026 vote idempotency", () => {
  it("counts a voter once even on repeat submission", async () => {
    const app = await buildApp();
    const d = await openDecision(app, { subject: "X", rule: "threshold", threshold: 2, totalMembers: 3 });
    const id = d.json().data.id;
    const voter = randomUUID();
    await app.inject({ method: "POST", url: `/v1/workflow/committee-decisions/${id}/votes`, headers: { authorization: `Bearer ${token(voter)}` }, payload: { vote: "approve" } });
    const dup = await app.inject({ method: "POST", url: `/v1/workflow/committee-decisions/${id}/votes`, headers: { authorization: `Bearer ${token(voter)}` }, payload: { vote: "approve" } });
    await app.close();
    expect(dup.json().message).toMatch(/already voted/);
    expect(dup.json().data.tally.approvals).toBe(1); // not double-counted
    expect(dup.json().data.tally.decided).toBe(false);
  });
});
