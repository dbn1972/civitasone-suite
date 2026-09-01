/**
 * Screening & shortlisting route wiring — auto-screen, decision with mandatory
 * rejection reason, override gates (admin + reason), freeze gate, bulk shortlist,
 * blind-list redaction, and audit trail.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000c11";
const USER = "aaaaaaaa-7777-4000-8000-000000000c11";
const VAC = "bbbbbbbb-0000-4000-8000-00000000c011";
const APP = "cccccccc-0000-4000-8000-00000000c012";

const H = vi.hoisted(() => ({
  findAppMock: vi.fn(),
  listForVacMock: vi.fn(),
  findByIdsMock: vi.fn(),
  setScreeningMock: vi.fn(),
  setByIdMock: vi.fn(),
  insertEventMock: vi.fn(),
  listEventsMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => {
  // markProcessed() in the F3 consumer runs
  // insert(...).values(...).onConflictDoNothing().returning() on the tx, which a
  // bare {} cannot answer — the consumer threw before reaching any case.
  const stubTx = { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ messageId: "stub" }] }) }) }) };
  return {
    ...(await io<Record<string, unknown>>()),
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(stubTx), insert: () => ({ values: async () => undefined }) },
  };
});
vi.mock("../src/modules/recruitment/screening-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplication: (...a: unknown[]) => H.findAppMock(...a),
  listApplicationsForVacancy: (...a: unknown[]) => H.listForVacMock(...a),
  findApplicationsByIds: (...a: unknown[]) => H.findByIdsMock(...a),
  setScreening: (...a: unknown[]) => H.setScreeningMock(...a),
  setScreeningById: (...a: unknown[]) => H.setByIdMock(...a),
  insertEvent: (...a: unknown[]) => H.insertEventMock(...a),
  listEvents: (...a: unknown[]) => H.listEventsMock(...a),
}));

import { buildApp } from "../src/app.js";

import { queue } from "../src/shared/infra.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";

// These routes only PUBLISH; the row is written by the recruitment F3 consumer
// that f3-leftover-register.ts wires into the worker. Register it here so the
// suite exercises the whole write path instead of the HTTP layer alone.
registerF3_recruitment_Consumers(queue);
/** Await the in-memory queue's fan-out so the consumer's write has happened. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}
type TestApp = { inject: (opts: never) => Promise<never> };
/** inject() + drain, so an assertion never races the async F3 write. */
async function injectF3(app: TestApp, opts: unknown): Promise<never> {
  const res = await app.inject(opts as never);
  await drainF3();
  return res;
}

import { sqlClient } from "../src/shared/db.js";

const auth = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}` });
const appRow = (over = {}) => ({ id: APP, tenantId: TENANT, jobOpeningId: VAC, applicantName: "Asha", email: "a@x.in", mobile: "9", category: "OBC", dateOfBirth: "1998-01-01", qualification: "B.Tech", experienceYears: 5, screeningDecision: "pending", shortlistFrozen: false, version: 1, eligibilityResult: { eligible: true }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.setScreeningMock.mockResolvedValue(undefined);
  H.setByIdMock.mockResolvedValue(undefined);
  H.insertEventMock.mockResolvedValue(undefined);
  H.listEventsMock.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("screening routes", () => {
  it("auto-screens only pending applications from their eligibility result", async () => {
    H.listForVacMock.mockResolvedValue([
      appRow({ id: "a1", screeningDecision: "pending", eligibilityResult: { eligible: true } }),
      appRow({ id: "a2", screeningDecision: "pending", eligibilityResult: { eligible: false } }),
      appRow({ id: "a3", screeningDecision: "shortlisted" }),         // already decided -> skip
      appRow({ id: "a4", screeningDecision: "pending", eligibilityResult: {} }), // never evaluated -> skip
    ]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/auto-screen`, headers: auth(["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ screened: 2, skipped: 2 });
    await app.close();
  });

  it("requires a structured reason to mark an application ineligible (400)", async () => {
    H.findAppMock.mockResolvedValue(appRow({ screeningDecision: "pending" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/applications/${APP}/screening-decision`, headers: auth(["hr_officer"]), payload: { decision: "ineligible" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("REASON_REQUIRED");
    await app.close();
  });

  it("records an ineligible decision with a reason code", async () => {
    H.findAppMock.mockResolvedValue(appRow({ screeningDecision: "pending" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/applications/${APP}/screening-decision`, headers: auth(["hr_officer"]), payload: { decision: "ineligible", reasonCode: "experience", remarks: "short" } });
    expect(r.statusCode).toBe(200);
    expect(H.insertEventMock.mock.calls[0][1].action).toBe("decision");
    await app.close();
  });

  it("routes an override of a decided application to the maker-checker flow (409) — no single-admin direct override", async () => {
    H.findAppMock.mockResolvedValue(appRow({ screeningDecision: "ineligible" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/applications/${APP}/screening-decision`, headers: auth(["hr_admin"]), payload: { decision: "eligible" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("OVERRIDE_VIA_MAKER_CHECKER");
    expect(H.setScreeningMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("re-affirming the same decision is an idempotent no-op that does NOT rewrite the author", async () => {
    H.findAppMock.mockResolvedValue(appRow({ screeningDecision: "shortlisted" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/applications/${APP}/screening-decision`, headers: auth(["hr_officer"]), payload: { decision: "shortlisted" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().unchanged).toBe(true);
    expect(H.setScreeningMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects any screening change once the shortlist is frozen (409)", async () => {
    H.findAppMock.mockResolvedValue(appRow({ screeningDecision: "shortlisted", shortlistFrozen: true }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/applications/${APP}/screening-decision`, headers: auth(["hr_admin"]), payload: { decision: "waitlisted" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SHORTLIST_FROZEN");
    await app.close();
  });

  it("bulk-shortlists the requested applications", async () => {
    H.findByIdsMock.mockResolvedValue([appRow({ id: "a1" }), appRow({ id: "a2", shortlistFrozen: true })]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/shortlist`, headers: auth(["hr_admin"]), payload: { applicationIds: ["11111111-1111-4000-8000-000000000001", "22222222-2222-4000-8000-000000000002"] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ shortlisted: 1, skipped: 1 });
    await app.close();
  });

  it("bulk shortlist advances pending/eligible forward but never overturns a rejection/hold", async () => {
    H.findByIdsMock.mockResolvedValue([
      appRow({ id: "p1", screeningDecision: "pending" }),       // forward -> shortlist
      appRow({ id: "e1", screeningDecision: "eligible" }),      // forward (normal path) -> shortlist
      appRow({ id: "s1", screeningDecision: "shortlisted" }),   // idempotent -> shortlist
      appRow({ id: "r1", screeningDecision: "ineligible" }),    // rejection -> SKIP (needs override)
      appRow({ id: "w1", screeningDecision: "waitlisted" }),    // hold -> SKIP
      appRow({ id: "m1", screeningDecision: "manual_review" }), // hold -> SKIP
      appRow({ id: "f1", screeningDecision: "eligible", shortlistFrozen: true }), // frozen -> SKIP
    ]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/shortlist`, headers: auth(["hr_officer"]),
      payload: { applicationIds: ["11111111-1111-4000-8000-000000000001"] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ shortlisted: 3, skipped: 4 }); // p1/e1/s1 advanced; r1/w1/m1/f1 skipped
    const writtenIds = H.setByIdMock.mock.calls.map((c) => c[2]);
    for (const blocked of ["r1", "w1", "m1", "f1"]) expect(writtenIds).not.toContain(blocked);
    expect(writtenIds).toContain("e1"); // the normal eligible->shortlist path works
    await app.close();
  });

  it("freezes the shortlisted applications", async () => {
    H.listForVacMock.mockResolvedValue([appRow({ id: "a1", screeningDecision: "shortlisted" }), appRow({ id: "a2", screeningDecision: "ineligible" })]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/shortlist/freeze`, headers: auth(["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().frozen).toBe(1);
    await app.close();
  });

  it("returns a blind list with protected attributes removed", async () => {
    H.listForVacMock.mockResolvedValue([appRow()]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/job-openings/${VAC}/blind-list`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    const row = r.json().data[0];
    expect(row).not.toHaveProperty("applicantName");
    expect(row).not.toHaveProperty("email");
    expect(row).not.toHaveProperty("category");
    expect(row.qualification).toBe("B.Tech");
    await app.close();
  });

  it("returns the screening audit trail", async () => {
    H.findAppMock.mockResolvedValue(appRow());
    H.listEventsMock.mockResolvedValue([{ id: "e1", action: "decision", decision: "eligible" }]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/applications/${APP}/screening-audit`, headers: auth(["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });
});
