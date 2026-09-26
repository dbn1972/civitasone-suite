/**
 * R-RA-0111 screening-OVERRIDE checker-decision race — deterministic
 * regression test against a REAL Postgres (not mocked; see
 * screening-decision-race.test.ts for the sibling fix this mirrors, and
 * basicminor-concurrency.test.ts / finance-service/tests/distribution-lock-race.test.ts
 * for the same real-DB concurrency-proof pattern elsewhere in this codebase).
 *
 * BACKGROUND: the same audit that found screening-routes.ts's TOCTOU race
 * (closed by PR #1585) flagged the IDENTICAL shape of gap in this file's
 * sibling maker-checker endpoints: POST .../screening-overrides/:reqId/approve
 * and .../reject checked SoD, request status, and application staleness from a
 * synchronous READ, then decided the HTTP response from that read -- but the
 * actual transition (and, for approve, applying the decision to the
 * application) was deferred to the fire-and-forget F3 queue
 * (publishF3Write). The consumer that eventually performed the write
 * (f3-consumer.ts's now-removed "recruitment_screening_override_routes__1"/
 * "__2" cases) re-fetched fresh rows but never re-checked isActionable, SoD,
 * or staleness before writing, relying entirely on the route's own
 * (by-then-stale) pre-checks.
 *
 * Two genuinely concurrent checker decisions on the same pending override
 * request -- two admins both approving, or one approving while another
 * rejects -- both read 'pending' before either write landed: BOTH could get a
 * 200, and whichever write landed second would silently clobber the first
 * with zero trace a race was ever involved.
 *
 * THE FIX makes both writes synchronous and atomic:
 * screening-override-repo.ts's setRequestStatusIfPending conditions the
 * request-row UPDATE on status still being 'pending' (in addition to the
 * existing version guard), called directly from each route instead of via the
 * queue; approve additionally guards the application side inside the SAME
 * transaction via screening-repo.ts's existing version-guarded setScreening,
 * so both sides win together or not at all. Like screening-decision-race.test.ts,
 * the vulnerable window is entirely inside the UPDATE statement(s) Postgres's
 * own row lock serialises, so no artificial pause/gate is needed: firing two
 * real requests through Promise.all with no await between them reproduces the
 * race deterministically on every run.
 *
 * REVIEW FOLLOW-UP (audit-completeness gap): each route ALSO has an earlier,
 * plain synchronous pre-check (isActionable's status check in both routes,
 * plus approve's staleness check) that throws its 409 directly -- these are
 * not the concurrency guard (the atomic UPDATEs above are), but under genuine
 * racing a loser's own read frequently happens AFTER the winner's write has
 * already committed, landing it on one of these fast paths instead of the
 * atomic one. An independent review found the first version of this fix only
 * wired the audit call into the atomic-loss path, leaving these fast paths
 * silently unaudited -- exactly the "zero-trace" gap this fix exists to close,
 * just relocated. Both TRUE CONCURRENCY tests below still don't reliably
 * exercise the fast paths themselves (which path a given run lands on is a
 * genuine timing accident, confirmed by temporary debug instrumentation during
 * this fix: this environment's Promise.all ordering happens to always resolve
 * into the atomic path, never the fast one -- the opposite bias from the
 * review environment, which hit the fast path almost every time). The three
 * "hits the fast path directly" tests below close that verification gap
 * deterministically: each forces its scenario sequentially (no race at all),
 * so it can only ever land on the fast-path check, and confirms it now audits
 * identically to the atomic path -- real Postgres, not mocked, but immune to
 * the timing accident that made the atomic-only bug look invisible here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsApplications, hrmsJobOpenings, hrmsScreeningEvents, hrmsScreeningOverrides } from "../src/modules/recruitment/schema.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const VAC = randomUUID();
const REQUESTER = randomUUID();
const SCREENER = randomUUID();
const APPROVER_1 = randomUUID();
const APPROVER_2 = randomUUID();

const auth = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

async function seedVacancy(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(hrmsJobOpenings).values({
    id: VAC, tenantId: TENANT, refNo: "REF-OVERRIDE-RACE-1", title: "Override Race Test Vacancy",
    departmentId: randomUUID(), createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

/** An application already decided 'ineligible' by SCREENER, at version 1. */
async function seedDecidedApplication(id: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(hrmsApplications).values({
    id, tenantId: TENANT, jobOpeningId: VAC, applicantName: "Override Race Applicant",
    screeningDecision: "ineligible", screeningReasonCode: "experience",
    screenedBy: SCREENER, screenedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

/** A pending override request raised by REQUESTER against that application (v1, 'ineligible' -> toDecision). */
async function seedPendingOverride(reqId: string, appId: string, toDecision: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(hrmsScreeningOverrides).values({
    id: reqId, tenantId: TENANT, applicationId: appId, jobOpeningId: VAC,
    fromDecision: "ineligible", toDecision, applicationVersion: 1,
    reason: "docs re-verified on appeal", status: "pending",
    originalScreenedBy: SCREENER, requestedBy: REQUESTER,
  })));
}

async function readApplication(id: string) {
  // Must go through db.transaction() -- wrapWithTenantGuc() only sets the
  // app.tenant_id GUC that hrms_applications' FORCE ROW LEVEL SECURITY policy
  // checks when the query runs inside a transaction. Same pattern as
  // screening-decision-race.test.ts's readApplication().
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.tenantId, TENANT), eq(hrmsApplications.id, id))).limit(1)));
  const row = rows[0];
  if (!row) throw new Error(`application ${id} not found`);
  return row;
}

async function readOverride(id: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(hrmsScreeningOverrides)
    .where(and(eq(hrmsScreeningOverrides.tenantId, TENANT), eq(hrmsScreeningOverrides.id, id))).limit(1)));
  const row = rows[0];
  if (!row) throw new Error(`override request ${id} not found`);
  return row;
}

async function readEvents(applicationId: string) {
  return runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(hrmsScreeningEvents)
    .where(and(eq(hrmsScreeningEvents.tenantId, TENANT), eq(hrmsScreeningEvents.applicationId, applicationId)))
    .orderBy(hrmsScreeningEvents.createdAt)));
}

beforeAll(async () => { await seedVacancy(); });
afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsScreeningEvents).where(eq(hrmsScreeningEvents.tenantId, TENANT));
    await tx.delete(hrmsScreeningOverrides).where(eq(hrmsScreeningOverrides.tenantId, TENANT));
    await tx.delete(hrmsApplications).where(eq(hrmsApplications.tenantId, TENANT));
    await tx.delete(hrmsJobOpenings).where(eq(hrmsJobOpenings.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("R-RA-0111 screening-override checker decision — TOCTOU race (deterministic, real Postgres)", () => {
  it("TRUE CONCURRENCY: two different approvers both approving the SAME pending request -- exactly one wins, the other is cleanly rejected with a trace", async () => {
    const appId = randomUUID();
    const reqId = randomUUID();
    await seedDecidedApplication(appId);
    await seedPendingOverride(reqId, appId, "eligible");
    const app = await buildApp();

    // Fired back-to-back with no await between them: both requests' own reads
    // (isActionable, SoD, staleness) happen before either write lands --
    // exactly the proven bug's precondition (genuine Promise.all, not
    // sequential).
    const r1 = app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/approve`, headers: auth(APPROVER_1, ["hr_admin"]), payload: { note: "approve A" } });
    const r2 = app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/approve`, headers: auth(APPROVER_2, ["hr_admin"]), payload: { note: "approve B" } });
    const [res1, res2] = await Promise.all([r1, r2]);

    const statuses = [res1.statusCode, res2.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const winner = res1.statusCode === 200 ? res1 : res2;
    const loser = res1.statusCode === 409 ? res1 : res2;
    expect(winner.json()).toMatchObject({ status: "approved", screeningDecision: "eligible" });
    expect(loser.json().code).toBe("NOT_PENDING");

    // The persisted override request holds exactly one decider -- never both,
    // never neither.
    const finalReq = await readOverride(reqId);
    expect(finalReq.status).toBe("approved");
    expect([APPROVER_1, APPROVER_2]).toContain(finalReq.decidedBy);

    // The application actually changed exactly once, to the winner's decision.
    const finalApp = await readApplication(appId);
    expect(finalApp.screeningDecision).toBe("eligible");

    // Not zero-trace: the application's screening-events timeline shows
    // exactly the applied override AND the denied attempt -- never two
    // "override" rows, never a denial that vanished silently.
    const events = await readEvents(appId);
    const applied = events.filter((e) => e.action === "override");
    const denied = events.filter((e) => e.action === "override_denied");
    expect(applied).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect(applied[0]?.isOverride).toBe(true);
    expect(denied[0]?.isOverride).toBe(true);

    await app.close();
  });

  it("TRUE CONCURRENCY: one approver approving while a different approver rejects the SAME pending request -- exactly one wins, the other is cleanly rejected with a trace", async () => {
    const appId = randomUUID();
    const reqId = randomUUID();
    await seedDecidedApplication(appId);
    await seedPendingOverride(reqId, appId, "shortlisted");
    const app = await buildApp();

    const rApprove = app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/approve`, headers: auth(APPROVER_1, ["hr_admin"]), payload: {} });
    const rReject = app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/reject`, headers: auth(APPROVER_2, ["hr_admin"]), payload: { note: "not warranted" } });
    const [resApprove, resReject] = await Promise.all([rApprove, rReject]);

    const statuses = [resApprove.statusCode, resReject.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const finalReq = await readOverride(reqId);
    const finalApp = await readApplication(appId);
    const events = await readEvents(appId);

    if (resApprove.statusCode === 200) {
      // Approve won the race: the reject attempt must have been denied, NOT
      // silently applied on top of (or instead of) the approval.
      expect(resReject.statusCode).toBe(409);
      expect(resReject.json().code).toBe("NOT_PENDING");
      expect(finalReq.status).toBe("approved");
      expect(finalApp.screeningDecision).toBe("shortlisted");
      expect(events.filter((e) => e.action === "override")).toHaveLength(1);
    } else {
      // Reject won the race: the approve attempt must have been denied, and
      // -- critically -- the application must NEVER have been touched, since
      // approve's own atomic write (screening-repo.ts's setScreening) only
      // runs after it wins its own request-row guard.
      expect(resApprove.statusCode).toBe(409);
      expect(resApprove.json().code).toBe("NOT_PENDING");
      expect(finalReq.status).toBe("rejected");
      expect(finalApp.screeningDecision).toBe("ineligible");
      expect(events.filter((e) => e.action === "override")).toHaveLength(0);
    }
    // Whichever lost, it left a trace -- never a silent no-op.
    expect(events.filter((e) => e.action === "override_denied")).toHaveLength(1);

    await app.close();
  });

  it("a second approve that arrives after the request was ALREADY decided hits the fast isActionable path directly -- still audited (409 NOT_PENDING)", async () => {
    const appId = randomUUID();
    const reqId = randomUUID();
    await seedDecidedApplication(appId);
    await seedPendingOverride(reqId, appId, "eligible");
    const app = await buildApp();

    // Deliberately sequential, not a race: the first call's entire
    // transaction commits before the second is even sent, so the second's
    // own mustReq() read already sees status='approved' -- it can only ever
    // hit the fast, synchronous isActionable check (screening-override-routes.ts's
    // very first check in /approve), never the atomic setRequestStatusIfPending
    // path below it.
    const res1 = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/approve`, headers: auth(APPROVER_1, ["hr_admin"]), payload: {} });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/approve`, headers: auth(APPROVER_2, ["hr_admin"]), payload: {} });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().code).toBe("NOT_PENDING");

    const events = await readEvents(appId);
    expect(events.filter((e) => e.action === "override")).toHaveLength(1);
    expect(events.filter((e) => e.action === "override_denied")).toHaveLength(1);

    await app.close();
  });

  it("an approve whose application changed since the override was raised hits the fast staleness path directly -- still audited (409 STALE_OVERRIDE)", async () => {
    const appId = randomUUID();
    const reqId = randomUUID();
    await seedDecidedApplication(appId);
    await seedPendingOverride(reqId, appId, "eligible");
    // Simulate an unrelated edit bumping the application's version BEFORE the
    // approve call is ever made (not racing it) -- approve's own upfront read
    // sees the mismatch immediately, so it can only hit the fast staleness
    // check (screening-override-routes.ts:114), never the atomic path.
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.update(hrmsApplications)
      .set({ version: 2, updatedAt: new Date() })
      .where(and(eq(hrmsApplications.tenantId, TENANT), eq(hrmsApplications.id, appId)))));
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/approve`, headers: auth(APPROVER_1, ["hr_admin"]), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("STALE_OVERRIDE");

    const events = await readEvents(appId);
    expect(events.filter((e) => e.action === "override")).toHaveLength(0);
    expect(events.filter((e) => e.action === "override_denied")).toHaveLength(1);

    await app.close();
  });

  it("a second reject that arrives after the request was ALREADY decided hits the fast isActionable path directly -- still audited (409 NOT_PENDING)", async () => {
    const appId = randomUUID();
    const reqId = randomUUID();
    await seedDecidedApplication(appId);
    await seedPendingOverride(reqId, appId, "eligible");
    const app = await buildApp();

    const res1 = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/reject`, headers: auth(APPROVER_1, ["hr_admin"]), payload: {} });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/reject`, headers: auth(APPROVER_2, ["hr_admin"]), payload: {} });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().code).toBe("NOT_PENDING");

    const events = await readEvents(appId);
    expect(events.filter((e) => e.action === "override_denied")).toHaveLength(1);

    await app.close();
  });
});
