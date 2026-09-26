/**
 * R-RA-0111 screening-decision race — deterministic regression test against a
 * REAL Postgres (not mocked; see basicminor-concurrency.test.ts in this same
 * directory, and finance-service/tests/distribution-lock-race.test.ts, for
 * the same real-DB concurrency-proof pattern elsewhere in this codebase).
 *
 * BACKGROUND: POST /v1/hrms/applications/:id/screening-decision used to
 * decide fresh-vs-override from a read taken BEFORE publishing an async,
 * fire-and-forget F3 command (see f3-consumer.ts's now-superseded
 * "recruitment_screening_routes__1" case) — so the HTTP response was sent
 * optimistically, before the real write even happened, and the consumer that
 * eventually performed it never re-checked screening_decision at all. Two
 * genuinely simultaneous decisions on the same pending application both read
 * 'pending' before either write landed: BOTH got 200 isOverride:false, and
 * the second silently overwrote the first — with zero trace an override was
 * ever attempted (see PR description for the full repro against
 * application 354f3c14-b4f4-4c71-8b22-33a1c1f08eaa).
 *
 * THE FIX makes the write synchronous and atomic: screening-repo.ts's
 * setScreeningIfPending conditions the UPDATE on screening_decision still
 * being 'pending', in the same statement that records the decision, called
 * directly from the route instead of via the queue. Unlike the finance-service
 * lock race this mirrors, the vulnerable window here is entirely inside ONE
 * UPDATE statement (Postgres's own row lock serialises it — not an
 * application-level gap between separate reads and writes spread across
 * consumer invocations), so no artificial pause/gate is needed to force a
 * reliable repro the way distribution-lock-race.test.ts needs one: firing two
 * real requests through Promise.all with no await between them reproduces
 * the race deterministically on every run (also verified live: 8/8 real HTTP
 * Promise.all runs against a running instance, see the PR description).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsApplications, hrmsJobOpenings, hrmsScreeningEvents } from "../src/modules/recruitment/schema.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const VAC = randomUUID();
const OFFICER = randomUUID();
const ADMIN = randomUUID();

const auth = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

async function seedVacancy(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(hrmsJobOpenings).values({
    id: VAC, tenantId: TENANT, refNo: "REF-RACE-1", title: "Race Test Vacancy",
    departmentId: randomUUID(), createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

async function seedPendingApplication(id: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(hrmsApplications).values({
    id, tenantId: TENANT, jobOpeningId: VAC, applicantName: "Race Applicant",
    screeningDecision: "pending", createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

async function readApplication(id: string) {
  // Must go through db.transaction() -- wrapWithTenantGuc() only sets the
  // app.tenant_id GUC that hrms_applications' FORCE ROW LEVEL SECURITY policy
  // checks when the query runs inside a transaction. Same pattern as
  // basicminor-concurrency.test.ts's readEmployee().
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.tenantId, TENANT), eq(hrmsApplications.id, id))).limit(1)));
  const row = rows[0];
  if (!row) throw new Error(`application ${id} not found`);
  return row;
}

async function readEvents(id: string) {
  return runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(hrmsScreeningEvents)
    .where(and(eq(hrmsScreeningEvents.tenantId, TENANT), eq(hrmsScreeningEvents.applicationId, id)))
    .orderBy(hrmsScreeningEvents.createdAt)));
}

beforeAll(async () => { await seedVacancy(); });
afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsScreeningEvents).where(eq(hrmsScreeningEvents.tenantId, TENANT));
    await tx.delete(hrmsApplications).where(eq(hrmsApplications.tenantId, TENANT));
    await tx.delete(hrmsJobOpenings).where(eq(hrmsJobOpenings.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("R-RA-0111 screening-decision — TOCTOU race (deterministic, real Postgres)", () => {
  it("TRUE CONCURRENCY: two contradictory decisions on the same pending application -- exactly one wins, the other is cleanly rejected with a trace", async () => {
    const appId = randomUUID();
    await seedPendingApplication(appId);
    const app = await buildApp();

    // Fired back-to-back with no await between them: both requests' own
    // reads of the application happen before either write lands -- exactly
    // the proven bug's precondition (genuine Promise.all, not sequential).
    const r1 = app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/screening-decision`, headers: auth(OFFICER, ["hr_officer"]), payload: { decision: "ineligible", reasonCode: "experience" } });
    const r2 = app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/screening-decision`, headers: auth(ADMIN, ["hr_admin"]), payload: { decision: "shortlisted" } });
    const [res1, res2] = await Promise.all([r1, r2]);

    const statuses = [res1.statusCode, res2.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const winner = res1.statusCode === 200 ? res1 : res2;
    const loser = res1.statusCode === 409 ? res1 : res2;
    expect(winner.json()).toMatchObject({ isOverride: false });
    expect(loser.json().code).toBe("OVERRIDE_VIA_MAKER_CHECKER");

    // The persisted row holds exactly the winner's decision -- never both,
    // never neither, never silently last-write-wins.
    const finalApp = await readApplication(appId);
    expect(finalApp.screeningDecision).toBe((winner.json() as { screeningDecision: string }).screeningDecision);
    expect(["ineligible", "shortlisted"]).toContain(finalApp.screeningDecision);

    // Not zero-trace: the audit log shows exactly the winning decision AND
    // the denied attempt -- never two ordinary "decision" rows (the proven
    // bug's exact symptom).
    const events = await readEvents(appId);
    const decisions = events.filter((e) => e.action === "decision");
    const denied = events.filter((e) => e.action === "override_denied");
    expect(decisions).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect(decisions[0]?.isOverride).toBe(false);
    expect(denied[0]?.isOverride).toBe(false);

    await app.close();
  });

  it("control: two concurrent requests for the SAME decision both return 200 (one fresh, one idempotent) -- never an error, never a double write", async () => {
    const appId = randomUUID();
    await seedPendingApplication(appId);
    const app = await buildApp();

    const r1 = app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/screening-decision`, headers: auth(OFFICER, ["hr_officer"]), payload: { decision: "eligible" } });
    const r2 = app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/screening-decision`, headers: auth(ADMIN, ["hr_admin"]), payload: { decision: "eligible" } });
    const [res1, res2] = await Promise.all([r1, r2]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    const bodies = [res1.json() as { unchanged?: boolean }, res2.json() as { unchanged?: boolean }];
    // Exactly one is the fresh write, the other the idempotent restate.
    expect(bodies.filter((b) => b.unchanged === true)).toHaveLength(1);
    expect(bodies.filter((b) => !b.unchanged)).toHaveLength(1);

    const events = await readEvents(appId);
    expect(events.filter((e) => e.action === "decision")).toHaveLength(1); // only ONE write actually happened

    await app.close();
  });
});
