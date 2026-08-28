/**
 * Synchronous pre-check verification — e2e against the REAL stack (route ->
 * queue -> worker -> DB) for case-lifecycle, hearing, and order-issuance.
 *
 * Proves that a foreseeable rejection (an illegal state transition, a
 * self-approval attempt) is now an IMMEDIATE 4xx from the route's own
 * synchronous pre-check, not a 202 {accepted:true} that silently
 * dead-letters in the consumer with zero signal back to the caller. Opt-in
 * via COURT_E2E=1 (same convention as public-lookup.e2e.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { subscribeConsumers } from "../src/worker.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const MAKER = "11111111-1111-4111-8111-111111111111";
const CHECKER = "22222222-2222-4222-8222-222222222222";

function tok(sub: string): string {
  return signToken(
    { sub, tid: TENANT, roles: ["registrar", "judge", "court_admin", "super_admin"], sid: "s" },
    SECRET, 3600,
  );
}
function cnr(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
}

let app: FastifyInstance;
type Resp = { code: number; body: any };
async function jpost(url: string, body: unknown, sub: string): Promise<Resp> {
  const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok(sub)}` }, payload: body as object });
  return { code: res.statusCode, body: res.statusCode < 500 ? res.json() : undefined };
}
async function jpatch(url: string, body: unknown, sub: string): Promise<Resp> {
  const res = await app.inject({ method: "PATCH", url, headers: { authorization: `Bearer ${tok(sub)}` }, payload: body as object });
  return { code: res.statusCode, body: res.statusCode < 500 ? res.json() : undefined };
}
async function jget(url: string, sub: string): Promise<Resp> {
  const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok(sub)}` } });
  return { code: res.statusCode, body: res.statusCode < 500 ? res.json() : undefined };
}
async function waitFor(pred: () => Promise<boolean>, tries = 80, gap = 25): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, gap));
  }
  return false;
}

async function seedCourt(tenant: string): Promise<string> {
  const courtId = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    await sql`insert into court.courts (id, tenant_id, name, court_type) values (${courtId}, ${tenant}, ${"Precheck Test Court"}, ${"civil"})`;
  });
  return courtId;
}

async function registerCase(courtId: string, title: string): Promise<string> {
  const reg = await jpost("/v1/court/cases", {
    cnrNumber: cnr(), caseType: "civil", filingDate: "2026-01-01", title,
    courtId, parties: [{ partyRole: "petitioner", name: "Precheck Petitioner" }],
  }, MAKER);
  expect(reg.code).toBe(202);
  const caseId = reg.body.caseId as string;
  await waitFor(async () => (await jget(`/v1/court/cases/${caseId}`, MAKER)).code === 200);
  return caseId;
}

describe.skipIf(!RUN)("synchronous pre-checks for illegal state transitions", () => {
  let courtId: string;

  beforeAll(async () => {
    subscribeConsumers();
    await queue.start();
    app = await buildApp();
    courtId = await seedCourt(TENANT);
  });

  afterAll(async () => {
    await queue.stop();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      // Children before parents: case_parties/hearings/orders all FK-reference cases.
      await sql`delete from court.case_parties where tenant_id = ${TENANT}`;
      await sql`delete from court.hearings where tenant_id = ${TENANT}`;
      await sql`delete from court.orders where tenant_id = ${TENANT}`;
      await sql`delete from court.case_state_transitions where tenant_id = ${TENANT}`;
      await sql`delete from court.cases where tenant_id = ${TENANT}`;
      await sql`delete from court.courts where tenant_id = ${TENANT}`;
    });
    await app.close();
  });

  it("case-lifecycle: rejects an illegal status transition immediately (409), not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Case Status");

    // filed -> disposed directly is illegal (skips registered/admitted/pending/...).
    const illegal = await jpatch(`/v1/court/cases/${caseId}/status`, { toStatus: "disposed", expectedVersion: 1 }, MAKER);
    expect(illegal.code).toBe(409);
    expect(illegal.body.error.code).toBe("ILLEGAL_TRANSITION");

    const untouched = await jget(`/v1/court/cases/${caseId}`, MAKER);
    expect(untouched.body.status).toBe("filed");
    expect(untouched.body.version).toBe(1);

    // A legal transition still works and actually applies.
    const legal = await jpatch(`/v1/court/cases/${caseId}/status`, { toStatus: "registered", expectedVersion: 1 }, MAKER);
    expect(legal.code).toBe(202);
    expect(await waitFor(async () => (await jget(`/v1/court/cases/${caseId}`, MAKER)).body.status === "registered")).toBe(true);
  });

  it("case-lifecycle: rejects a malformed CNR with 400, not a raw 500", async () => {
    const res = await jpost("/v1/court/cases", {
      cnrNumber: "NOT-A-VALID-CNR", caseType: "civil", filingDate: "2026-01-01",
      title: "Bad CNR", courtId, parties: [{ partyRole: "petitioner", name: "P" }],
    }, MAKER);
    expect(res.code).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CNR");
  });

  it("hearing: rejects recording an outcome on an already-terminal hearing immediately (409), not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Hearing Case");

    const sched = await jpost(`/v1/court/cases/${caseId}/hearings`, { scheduledAt: "2026-09-15T10:00:00Z" }, MAKER);
    expect(sched.code).toBe(202);
    const hearingId = sched.body.hearingId as string;
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/hearings`, MAKER)).body.items?.some((h: any) => h.id === hearingId),
    )).toBe(true);

    const held = await jpatch(`/v1/court/hearings/${hearingId}/outcome`, { outcome: "held", expectedVersion: 1 }, MAKER);
    expect(held.code).toBe(202);
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/hearings`, MAKER)).body.items?.find((h: any) => h.id === hearingId)?.status === "held",
    )).toBe(true);

    // held is TERMINAL for this row -- recording another outcome must be an immediate 409.
    const again = await jpatch(`/v1/court/hearings/${hearingId}/outcome`, { outcome: "cancelled", expectedVersion: 2 }, MAKER);
    expect(again.code).toBe(409);
    expect(again.body.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("order-issuance: rejects a self-approval attempt immediately (403), not a fake 202 -- the maker-checker integrity crux", async () => {
    const caseId = await registerCase(courtId, "Precheck Order Case");

    const order = await jpost(`/v1/court/cases/${caseId}/orders`, { orderType: "interim", orderText: "Precheck order text" }, MAKER);
    expect(order.code).toBe(202);
    const orderId = order.body.orderId as string;
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/orders`, MAKER)).body.items?.some((o: any) => o.id === orderId),
    )).toBe(true);

    const submit = await jpatch(`/v1/court/orders/${orderId}/submit-for-approval`, { expectedVersion: 1 }, MAKER);
    expect(submit.code).toBe(202);
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/orders`, MAKER)).body.items?.find((o: any) => o.id === orderId)?.status === "pending_approval",
    )).toBe(true);

    // SAME actor (the maker) attempts to approve+issue their own order.
    const selfApprove = await jpatch(`/v1/court/orders/${orderId}/approve-issue`, { dscSignature: "fake-dsc-for-test", expectedVersion: 2 }, MAKER);
    expect(selfApprove.code).toBe(403);
    expect(selfApprove.body.error.code).toBe("MAKER_CHECKER_VIOLATION");

    // Confirm the order is untouched -- still pending_approval, no approver recorded.
    const afterSelf = await jget(`/v1/court/cases/${caseId}/orders`, MAKER);
    const orderRow = afterSelf.body.items.find((o: any) => o.id === orderId);
    expect(orderRow.status).toBe("pending_approval");
    expect(orderRow.approvedBy ?? null).toBeNull();

    // A recall attempt on a non-issued order is also an immediate 409.
    const badRecall = await jpatch(`/v1/court/orders/${orderId}/recall`, { recallReason: "test", expectedVersion: 2 }, MAKER);
    expect(badRecall.code).toBe(409);

    // A DIFFERENT actor (the checker) can legitimately approve + issue.
    const realApprove = await jpatch(`/v1/court/orders/${orderId}/approve-issue`, { dscSignature: "fake-dsc-for-test", expectedVersion: 2 }, CHECKER);
    expect(realApprove.code).toBe(202);
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/orders`, MAKER)).body.items.find((o: any) => o.id === orderId)?.status === "issued",
    )).toBe(true);
  });
});
