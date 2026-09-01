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
      await sql`delete from court.appeals where tenant_id = ${TENANT}`;
      await sql`delete from court.notice_service where tenant_id = ${TENANT}`;
      await sql`delete from court.notices where tenant_id = ${TENANT}`;
      await sql`delete from court.evidence where tenant_id = ${TENANT}`;
      await sql`delete from court.compliance_directions where tenant_id = ${TENANT}`;
      await sql`delete from court.case_defect where tenant_id = ${TENANT}`;
      await sql`delete from court.case_scrutiny where tenant_id = ${TENANT}`;
      await sql`delete from court.case_parcels where tenant_id = ${TENANT}`;
      await sql`delete from court.config_entries where tenant_id = ${TENANT}`;
      await sql`delete from court.case_state_transitions where tenant_id = ${TENANT}`;
      await sql`delete from court.cases where tenant_id = ${TENANT}`;
      await sql`delete from court.courts where tenant_id = ${TENANT}`;
    });
    await app.close();
  });

  it("case-lifecycle: rejects an illegal status transition immediately (422), not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Case Status");

    // A stale expectedVersion is checked BEFORE transition legality -- a real
    // version conflict (409), the one branch of assertVersionAndTransition
    // nothing else in this file exercises.
    const staleVersion = await jpatch(`/v1/court/cases/${caseId}/status`, { toStatus: "registered", expectedVersion: 99 }, MAKER);
    expect(staleVersion.code).toBe(409);
    expect(staleVersion.body.error.code).toBe("CASE_VERSION_CONFLICT");

    // filed -> disposed directly is illegal (skips registered/admitted/pending/...).
    const illegal = await jpatch(`/v1/court/cases/${caseId}/status`, { toStatus: "disposed", expectedVersion: 1 }, MAKER);
    expect(illegal.code).toBe(422);
    expect(illegal.body.error.code).toBe("CASE_INVALID_TRANSITION");

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

  it("hearing: rejects recording an outcome on an already-terminal hearing immediately (422), not a fake 202", async () => {
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

    // held is TERMINAL for this row -- recording another outcome must be an immediate 422
    // (HEARING_INVALID_TRANSITION; a stale-version 409 is the OTHER branch, covered by
    // the case-lifecycle test above using the same shared assertVersionAndTransition).
    const again = await jpatch(`/v1/court/hearings/${hearingId}/outcome`, { outcome: "cancelled", expectedVersion: 2 }, MAKER);
    expect(again.code).toBe(422);
    expect(again.body.error.code).toBe("HEARING_INVALID_TRANSITION");
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

    // A recall attempt on a non-issued order is also an immediate rejection
    // (422 ORDER_INVALID_TRANSITION -- issued->recalled is the only legal edge).
    const badRecall = await jpatch(`/v1/court/orders/${orderId}/recall`, { recallReason: "test", expectedVersion: 2 }, MAKER);
    expect(badRecall.code).toBe(422);

    // A DIFFERENT actor (the checker) can legitimately approve + issue.
    const realApprove = await jpatch(`/v1/court/orders/${orderId}/approve-issue`, { dscSignature: "fake-dsc-for-test", expectedVersion: 2 }, CHECKER);
    expect(realApprove.code).toBe(202);
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/orders`, MAKER)).body.items.find((o: any) => o.id === orderId)?.status === "issued",
    )).toBe(true);

    // MAKER tries to self-approve AGAIN, now that the order is already issued.
    // The plain version/transition check would treat "already at target" as an
    // idempotent no-op and let this through -- maker-checker must NOT ride along
    // with that short-circuit, or a repeat self-approval attempt against an
    // already-issued order would get a fake 202 with zero integrity signal.
    const selfApproveAgain = await jpatch(`/v1/court/orders/${orderId}/approve-issue`, { dscSignature: "fake-dsc-for-test", expectedVersion: 3 }, MAKER);
    expect(selfApproveAgain.code).toBe(403);
    expect(selfApproveAgain.body.error.code).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("notice: rejects an illegal status transition immediately (422), not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Notice Case");

    const issued = await jpost(`/v1/court/cases/${caseId}/notices`, {
      noticeType: "summons", issueDate: "2026-09-01",
    }, MAKER);
    expect(issued.code).toBe(202);
    const noticeId = issued.body.noticeId as string;
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/notices`, MAKER)).body.items?.some((n: any) => n.id === noticeId),
    )).toBe(true);

    // Mark it served (legal: issued -> served).
    const served = await jpatch(`/v1/court/notices/${noticeId}/status`, { status: "served", expectedVersion: 1 }, MAKER);
    expect(served.code).toBe(202);
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/notices`, MAKER)).body.items?.find((n: any) => n.id === noticeId)?.status === "served",
    )).toBe(true);

    // served is TERMINAL -- cancelling it now must be an immediate 422, not a fake 202.
    const illegal = await jpatch(`/v1/court/notices/${noticeId}/status`, { status: "cancelled", expectedVersion: 2 }, MAKER);
    expect(illegal.code).toBe(422);
    expect(illegal.body.error.code).toBe("NOTICE_INVALID_TRANSITION");

    // A stale expectedVersion on a legal target is the OTHER branch: 409, not 422.
    const staleVersion = await jpatch(`/v1/court/notices/${noticeId}/status`, { status: "unserved", expectedVersion: 99 }, MAKER);
    expect(staleVersion.code).toBe(409);
    expect(staleVersion.body.error.code).toBe("NOTICE_VERSION_CONFLICT");
  });

  it("evidence: rejects an illegal ruling immediately (422), not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Evidence Case");

    const submitted = await jpost(`/v1/court/cases/${caseId}/evidence`, {
      title: "Precheck Exhibit", evidenceType: "document",
    }, MAKER);
    expect(submitted.code).toBe(202);
    const evidenceId = submitted.body.evidenceId as string;
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/evidence`, MAKER)).body.items?.some((e: any) => e.id === evidenceId),
    )).toBe(true);

    // Admit it (legal: submitted -> admitted).
    const admitted = await jpatch(`/v1/court/evidence/${evidenceId}/rule`, { ruling: "admitted", expectedVersion: 1 }, MAKER);
    expect(admitted.code).toBe(202);
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/evidence`, MAKER)).body.items?.find((e: any) => e.id === evidenceId)?.status === "admitted",
    )).toBe(true);

    // admitted is TERMINAL -- rejecting it now must be an immediate 422, not a fake 202.
    const illegal = await jpatch(`/v1/court/evidence/${evidenceId}/rule`, { ruling: "rejected", expectedVersion: 2 }, MAKER);
    expect(illegal.code).toBe(422);
    expect(illegal.body.error.code).toBe("EVIDENCE_INVALID_TRANSITION");

    // A stale expectedVersion on a legal target is the OTHER branch: 409, not 422.
    const staleVersion = await jpatch(`/v1/court/evidence/${evidenceId}/rule`, { ruling: "rejected", expectedVersion: 99 }, MAKER);
    expect(staleVersion.code).toBe(409);
    expect(staleVersion.body.error.code).toBe("EVIDENCE_VERSION_CONFLICT");
  });

  it("compliance: rejects an illegal status transition immediately (422), not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Compliance Case");

    const created = await jpost(`/v1/court/cases/${caseId}/compliance`, {
      direction: "Precheck compliance direction",
    }, MAKER);
    expect(created.code).toBe(202);
    const directionId = created.body.directionId as string;
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/compliance`, MAKER)).body.items?.some((d: any) => d.id === directionId),
    )).toBe(true);

    // verifying a still-'pending' direction skips the required 'in_progress' ->
    // 'completed' steps -- illegal, must be an immediate 422, not a fake 202.
    const illegal = await jpatch(`/v1/court/compliance/${directionId}`, { status: "verified", expectedVersion: 1 }, MAKER);
    expect(illegal.code).toBe(422);
    expect(illegal.body.error.code).toBe("COMPLIANCE_INVALID_TRANSITION");

    const untouched = await jget(`/v1/court/cases/${caseId}/compliance`, MAKER);
    expect(untouched.body.items.find((d: any) => d.id === directionId)?.status).toBe("pending");

    // A stale expectedVersion on a legal target is the OTHER branch: 409, not 422.
    const staleVersion = await jpatch(`/v1/court/compliance/${directionId}`, { status: "in_progress", expectedVersion: 99 }, MAKER);
    expect(staleVersion.code).toBe(409);
    expect(staleVersion.body.error.code).toBe("COMPLIANCE_VERSION_CONFLICT");
  });

  it("scrutiny: rejects an illegal defect resolution immediately (422), not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Scrutiny Case");

    const scrutinized = await jpost(`/v1/court/cases/${caseId}/scrutiny`, {}, MAKER);
    expect(scrutinized.code).toBe(202);
    const scrutinyId = scrutinized.body.scrutinyId as string;
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/defects`, MAKER)).code === 200,
    )).toBe(true);

    const raised = await jpost(`/v1/court/cases/${caseId}/defects`, {
      category: "missing_documents", description: "Precheck defect",
    }, MAKER);
    expect(raised.code).toBe(202);
    const defectId = raised.body.defectId as string;
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/defects`, MAKER)).body.items?.some((d: any) => d.id === defectId),
    )).toBe(true);

    // Resolve it (legal: raised -> rectified).
    const rectified = await jpatch(`/v1/court/defects/${defectId}/resolve`, { resolution: "rectified", expectedVersion: 1 }, MAKER);
    expect(rectified.code).toBe(202);
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/defects`, MAKER)).body.items?.find((d: any) => d.id === defectId)?.status === "rectified",
    )).toBe(true);

    // rectified is TERMINAL -- resolving it again must be an immediate 422, not a fake 202.
    const illegal = await jpatch(`/v1/court/defects/${defectId}/resolve`, { resolution: "waived", expectedVersion: 2 }, MAKER);
    expect(illegal.code).toBe(422);
    expect(illegal.body.error.code).toBe("DEFECT_INVALID_TRANSITION");

    // A stale expectedVersion on the scrutiny itself is the OTHER branch: 409.
    const staleVersion = await jpatch(`/v1/court/scrutiny/${scrutinyId}/resolve`, { status: "cleared", expectedVersion: 99 }, MAKER);
    expect(staleVersion.code).toBe(409);
    expect(staleVersion.body.error.code).toBe("SCRUTINY_VERSION_CONFLICT");

    // The legal scrutiny path still works: pending -> cleared.
    const cleared = await jpatch(`/v1/court/scrutiny/${scrutinyId}/resolve`, { status: "cleared", expectedVersion: 1 }, MAKER);
    expect(cleared.code).toBe(202);
  });

  it("case-parcel: a stale expectedVersion is an immediate 409, not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Parcel Case");

    const added = await jpost(`/v1/court/cases/${caseId}/parcels`, {
      surveyNumber: "PC-SURVEY-1", village: "Precheck Village",
    }, MAKER);
    expect(added.code).toBe(202);
    const parcelId = added.body.parcelId as string;
    expect(await waitFor(async () =>
      (await jget(`/v1/court/cases/${caseId}/parcels`, MAKER)).body.items?.some((p: any) => p.id === parcelId),
    )).toBe(true);

    // A stale expectedVersion on a REAL change must be an immediate 409, not a fake 202.
    const staleVersion = await jpatch(`/v1/court/parcels/${parcelId}`, { areaSqm: 500, expectedVersion: 99 }, MAKER);
    expect(staleVersion.code).toBe(409);
    expect(staleVersion.body.error.code).toBe("PARCEL_VERSION_CONFLICT");

    const untouched = await jget(`/v1/court/cases/${caseId}/parcels`, MAKER);
    expect(untouched.body.items.find((p: any) => p.id === parcelId)?.areaSqm ?? null).toBeNull();

    // The correct version still works and actually applies.
    const applied = await jpatch(`/v1/court/parcels/${parcelId}`, { areaSqm: 500, expectedVersion: 1 }, MAKER);
    expect(applied.code).toBe(202);
    expect(await waitFor(async () =>
      Number((await jget(`/v1/court/cases/${caseId}/parcels`, MAKER)).body.items?.find((p: any) => p.id === parcelId)?.areaSqm) === 500,
    )).toBe(true);
  });

  it("appeal: rejects an illegal status transition immediately (422), not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Appeal Case");

    const filed = await jpost("/v1/court/appeals", {
      originalCaseId: caseId, appealType: "appeal", grounds: "Error of law", filedDate: "2026-09-01",
    }, MAKER);
    expect(filed.code).toBe(202);
    const appealId = filed.body.appealId as string;
    expect(await waitFor(async () => (await jget(`/v1/court/appeals/${appealId}`, MAKER)).code === 200)).toBe(true);

    // Deciding a still-'filed' appeal skips the required 'registered' step --
    // illegal, must be an immediate 422, not a 202 that silently dead-letters.
    const illegalDecide = await jpatch(`/v1/court/appeals/${appealId}/decide`, {
      decision: "allowed", decisionSummary: "Reasoned order", decidedDate: "2026-10-01", expectedVersion: 1,
    }, MAKER);
    expect(illegalDecide.code).toBe(422);
    expect(illegalDecide.body.error.code).toBe("APPEAL_INVALID_TRANSITION");

    const untouched = await jget(`/v1/court/appeals/${appealId}`, MAKER);
    expect(untouched.body.status).toBe("filed");
    expect(untouched.body.version).toBe(1);

    // A stale expectedVersion on a legal target is a 409, the other branch.
    const staleVersion = await jpatch(`/v1/court/appeals/${appealId}/register`, { expectedVersion: 99 }, MAKER);
    expect(staleVersion.code).toBe(409);
    expect(staleVersion.body.error.code).toBe("APPEAL_VERSION_CONFLICT");

    // The legal path still works end to end: register, then decide.
    const register = await jpatch(`/v1/court/appeals/${appealId}/register`, { expectedVersion: 1 }, MAKER);
    expect(register.code).toBe(202);
    expect(await waitFor(async () => (await jget(`/v1/court/appeals/${appealId}`, MAKER)).body.status === "registered")).toBe(true);

    const decide = await jpatch(`/v1/court/appeals/${appealId}/decide`, {
      decision: "allowed", decisionSummary: "Reasoned order", decidedDate: "2026-10-01", expectedVersion: 2,
    }, MAKER);
    expect(decide.code).toBe(202);
    expect(await waitFor(async () => (await jget(`/v1/court/appeals/${appealId}`, MAKER)).body.status === "allowed")).toBe(true);
  });

  it("party: rejects an advocate update on a missing party (404) and a stale expectedVersion (409), not a fake 202", async () => {
    const caseId = await registerCase(courtId, "Precheck Party Case");

    // A partyId that does not exist at all -- immediate 404, not a 202 that
    // dead-letters with zero signal.
    const missing = await jpatch(`/v1/court/parties/${randomUUID()}/advocate`, { advocateName: "Nobody", expectedVersion: 1 }, MAKER);
    expect(missing.code).toBe(404);
    expect(missing.body.error.code).toBe("PARTY_NOT_FOUND");

    const addRes = await jpost(`/v1/court/cases/${caseId}/parties`, {
      partyRole: "advocate", advocateName: "Adv. Original", advocateBarId: "DL/0001/2020",
    }, MAKER);
    expect(addRes.code).toBe(202);
    const partyId = addRes.body.partyId as string;
    expect(await waitFor(async () => {
      const list = await jget(`/v1/court/cases/${caseId}/parties`, MAKER);
      return (list.body.items as any[]).some((p) => p.id === partyId);
    })).toBe(true);

    // Stale expectedVersion on a REAL party -- immediate 409, the write never
    // reaches the consumer at all.
    const stale = await jpatch(`/v1/court/parties/${partyId}/advocate`, { advocateName: "Adv. Hijacked", expectedVersion: 99 }, MAKER);
    expect(stale.code).toBe(409);
    expect(stale.body.error.code).toBe("PARTY_VERSION_CONFLICT");

    const untouched = (await jget(`/v1/court/cases/${caseId}/parties`, MAKER)).body.items.find((p: any) => p.id === partyId);
    expect(untouched.advocateName).toBe("Adv. Original");
    expect(untouched.version).toBe(1);

    // The legal path (correct expectedVersion) still works end to end.
    const legal = await jpatch(`/v1/court/parties/${partyId}/advocate`, { advocateName: "Adv. Updated", expectedVersion: 1 }, MAKER);
    expect(legal.code).toBe(202);
    expect(await waitFor(async () => {
      const list = await jget(`/v1/court/cases/${caseId}/parties`, MAKER);
      return (list.body.items as any[]).find((p) => p.id === partyId)?.advocateName === "Adv. Updated";
    })).toBe(true);
  });

  it("config-registry: rejects a missing/stale-version deactivate (404/409) and a stale-version set (409), not a fake 202", async () => {
    const setRes = await jpost("/v1/court/config", {
      namespace: "court_defaults", configKey: `precheck_max_adj_${randomUUID().slice(0, 8)}`, value: "5",
    }, MAKER);
    expect(setRes.code).toBe(202);
    const configId = setRes.body.configId as string;
    const namespace = "court_defaults";
    expect(await waitFor(async () => {
      const list = await jget(`/v1/court/config/${namespace}`, MAKER);
      // value round-trips through the jsonb column as the JSON NUMBER 5, not
      // the string "5" -- a bare-digit string cast to jsonb is valid JSON
      // grammar for a number, so Postgres (correctly) reparses it as one.
      return (list.body.items as any[]).some((c) => c.id === configId && c.value === 5);
    })).toBe(true);
    const row = (await jget(`/v1/court/config/${namespace}`, MAKER)).body.items.find((c: any) => c.id === configId);

    // setConfig against an EXISTING entry with a stale expectedVersion -- 409,
    // not a fake 202 (this branch only fires when expectedVersion is supplied).
    const staleSet = await jpost("/v1/court/config", {
      namespace, configKey: row.configKey, value: "6", expectedVersion: 99,
    }, MAKER);
    expect(staleSet.code).toBe(409);
    expect(staleSet.body.error.code).toBe("CONFIG_VERSION_CONFLICT");
    const stillFive = (await jget(`/v1/court/config/${namespace}`, MAKER)).body.items.find((c: any) => c.id === configId);
    expect(stillFive.value).toBe(5);

    // Two SEQUENTIAL, correctly-versioned updates must BOTH actually apply --
    // not just the first one. Before independent review caught it, setConfig's
    // messageId was `configId` alone (identical on every call for this entry,
    // regardless of content or expectedVersion), so markProcessed's dedup would
    // have silently swallowed the SECOND update below even though its
    // expectedVersion is 100% correct -- exactly the update-after-create path
    // the original test suite never once exercised.
    const firstUpdate = await jpost("/v1/court/config", {
      namespace, configKey: row.configKey, value: "6", expectedVersion: 1,
    }, MAKER);
    expect(firstUpdate.code).toBe(202);
    expect(await waitFor(async () => {
      const found = (await jget(`/v1/court/config/${namespace}`, MAKER)).body.items.find((c: any) => c.id === configId);
      return found?.value === 6 && found?.version === 2;
    })).toBe(true);

    const secondUpdate = await jpost("/v1/court/config", {
      namespace, configKey: row.configKey, value: "7", expectedVersion: 2,
    }, MAKER);
    expect(secondUpdate.code).toBe(202);
    expect(await waitFor(async () => {
      const found = (await jget(`/v1/court/config/${namespace}`, MAKER)).body.items.find((c: any) => c.id === configId);
      return found?.value === 7 && found?.version === 3;
    })).toBe(true);

    // deactivateConfig on a random, nonexistent id -- immediate 404.
    const missingDeactivate = await jpatch(`/v1/court/config/${randomUUID()}/deactivate`, { expectedVersion: 1 }, MAKER);
    expect(missingDeactivate.code).toBe(404);
    expect(missingDeactivate.body.error.code).toBe("CONFIG_NOT_FOUND");

    // deactivateConfig on the REAL, active entry with a stale expectedVersion --
    // immediate 409, the write never reaches the consumer.
    const staleDeactivate = await jpatch(`/v1/court/config/${configId}/deactivate`, { expectedVersion: 99 }, MAKER);
    expect(staleDeactivate.code).toBe(409);
    expect(staleDeactivate.body.error.code).toBe("CONFIG_VERSION_CONFLICT");

    // The legal path still works end to end. expectedVersion is 3, not 1 --
    // the two sequential updates above already bumped it twice.
    const legalDeactivate = await jpatch(`/v1/court/config/${configId}/deactivate`, { expectedVersion: 3 }, MAKER);
    expect(legalDeactivate.code).toBe(202);
    expect(await waitFor(async () => {
      const list = await jget(`/v1/court/config/${namespace}`, MAKER);
      return (list.body.items as any[]).find((c) => c.id === configId)?.active === false;
    })).toBe(true);

    // No-op parity: deactivating the now-ALREADY-INACTIVE entry again, even with
    // a wildly stale expectedVersion, is still accepted (matches the consumer's
    // own "already inactive -> no-op" short-circuit, which runs BEFORE its
    // version check) -- proving the pre-check is not STRICTER than the
    // authoritative consumer.
    const alreadyInactive = await jpatch(`/v1/court/config/${configId}/deactivate`, { expectedVersion: 12345 }, MAKER);
    expect(alreadyInactive.code).toBe(202);
  });
});
