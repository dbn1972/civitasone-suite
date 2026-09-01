/**
 * R-RA-0118 — rejection-notice + disclosure-policy routes.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-dddd-4000-8000-00000000ddaa";
const USER = "aaaaaaaa-7777-4000-8000-00000000ddaa";
const APP = "dddddddd-dddd-4000-8000-0000000dddaa";
const JOB = "ffffffff-dddd-4000-8000-0000000fddaa";

const H = vi.hoisted(() => ({ findApplication: vi.fn(), getDisclosure: vi.fn(), setDisclosure: vi.fn() }));

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
  findApplication: (...a: unknown[]) => H.findApplication(...a),
}));
vi.mock("../src/modules/recruitment/rejection-notice-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  getDisclosurePolicy: (...a: unknown[]) => H.getDisclosure(...a),
  setDisclosurePolicy: (...a: unknown[]) => H.setDisclosure(...a),
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

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_officer"]) => ({ authorization: `Bearer ${tok(roles)}` });
const appRow = (over = {}) => ({ id: APP, tenantId: TENANT, jobOpeningId: JOB, applicantName: "A Candidate", applicationNo: "APP-001", screeningDecision: "ineligible", screeningReasonCode: "experience", screeningRemarks: "internal: 32/100", screenedBy: "officer-9", eligibilityResult: { score: 32 }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.findApplication.mockResolvedValue(appRow());
  H.getDisclosure.mockResolvedValue(false);
  H.setDisclosure.mockResolvedValue(true);
});
afterAll(async () => { await sqlClient.end(); });

describe("rejection notice + disclosure policy (R-RA-0118)", () => {
  it("returns a candidate-safe notice that omits internal scoring/remarks (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/applications/${APP}/rejection-notice`, headers: auth() });
    expect(r.statusCode).toBe(200);
    const blob = JSON.stringify(r.json());
    expect(blob).not.toContain("32");
    expect(blob).not.toContain("officer-9");
    expect(blob).not.toContain("internal");
    expect(r.json().data.outcome).toBe("not_selected");
    expect(r.json().data.reason).toBeUndefined(); // policy off
    await app.close();
  });

  it("includes the reason category only when the vacancy policy is on", async () => {
    H.getDisclosure.mockResolvedValue(true);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/applications/${APP}/rejection-notice`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.reason).toContain("minimum experience requirement");
    await app.close();
  });

  it("404 for a missing application", async () => {
    H.findApplication.mockResolvedValue(null);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/applications/${APP}/rejection-notice`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("sets the disclosure policy as an admin (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PATCH", url: `/v1/hrms/job-openings/${JOB}/rejection-policy`, headers: auth(["hr_admin"]), payload: { discloseReason: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().discloseRejectionReason).toBe(true);
    expect(H.setDisclosure).toHaveBeenCalledOnce();
    await app.close();
  });

  it("forbids a non-admin from setting the policy (403)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PATCH", url: `/v1/hrms/job-openings/${JOB}/rejection-policy`, headers: auth(["hr_officer"]), payload: { discloseReason: true } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 when setting the policy on a missing vacancy", async () => {
    H.setDisclosure.mockResolvedValue(false);
    const app = await buildApp();
    const r = await injectF3(app, { method: "PATCH", url: `/v1/hrms/job-openings/${JOB}/rejection-policy`, headers: auth(["hr_admin"]), payload: { discloseReason: true } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/applications/${APP}/rejection-notice` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
