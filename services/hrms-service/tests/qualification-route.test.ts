/**
 * Qualification requirement + validate-candidate routes.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-bbbb-4000-8000-000000000abb";
const USER = "aaaaaaaa-7777-4000-8000-000000000abb";
const JOB = "cccccccc-bbbb-4000-8000-00000000cabb";

const H = vi.hoisted(() => ({ findByJob: vi.fn(), insertRequirement: vi.fn(), updateRequirement: vi.fn() }));

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
vi.mock("../src/modules/recruitment/qualification-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findByJob: (...a: unknown[]) => H.findByJob(...a),
  insertRequirement: (...a: unknown[]) => H.insertRequirement(...a),
  updateRequirement: (...a: unknown[]) => H.updateRequirement(...a),
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

const auth = { authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}` };
const reqRow = (over = {}) => ({ id: "r", tenantId: TENANT, jobOpeningId: JOB, minTotalYears: "3.0", minRelevantYears: "1.0", maxGapMonths: null, minEducationLevel: "bachelor", requiredDisciplines: ["computer science"], minPercentage: null, recognisedInstitutionsOnly: false, version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.insertRequirement.mockResolvedValue(undefined);
  H.updateRequirement.mockResolvedValue(undefined);
  H.findByJob.mockResolvedValue(null);
});
afterAll(async () => { await sqlClient.end(); });

describe("qualification requirement + validate routes", () => {
  it("sets a requirement (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/job-openings/${JOB}/qualification-requirement`, headers: auth, payload: { minTotalYears: 3, minRelevantYears: 1, minEducationLevel: "bachelor", requiredDisciplines: ["Computer Science"] } });
    expect(r.statusCode).toBe(200);
    expect(H.insertRequirement).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects relevant-years greater than total-years (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/job-openings/${JOB}/qualification-requirement`, headers: auth, payload: { minTotalYears: 2, minRelevantYears: 3 } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_REQUIREMENT");
    await app.close();
  });

  it("refuses to validate when no requirement is set (409)", async () => {
    H.findByJob.mockResolvedValue(null);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${JOB}/validate-candidate`, headers: auth, payload: { experience: [], education: [] } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NO_REQUIREMENT");
    await app.close();
  });

  it("validates an eligible candidate against the stored requirement (200)", async () => {
    H.findByJob.mockResolvedValue(reqRow());
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${JOB}/validate-candidate`, headers: auth, payload: {
      experience: [{ employer: "A", from: "2019-01-01", to: "2023-01-01", relevant: true }],
      education: [{ level: "bachelor", discipline: "computer science", percentage: 70 }],
    } });
    expect(r.statusCode).toBe(200);
    expect(r.json().eligible).toBe(true);
    expect(r.json().experience.totalYears).toBeCloseTo(4.0, 1);
    expect(r.json().education.meetsDiscipline).toBe(true);
    await app.close();
  });

  it("marks a candidate ineligible for short experience and wrong discipline (200 with eligible=false)", async () => {
    H.findByJob.mockResolvedValue(reqRow());
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${JOB}/validate-candidate`, headers: auth, payload: {
      experience: [{ employer: "A", from: "2022-06-01", to: "2023-01-01", relevant: true }], // ~0.6y < 3
      education: [{ level: "bachelor", discipline: "history", percentage: 80 }],              // wrong discipline
    } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.eligible).toBe(false);
    expect(b.experience.meetsTotal).toBe(false);
    expect(b.education.meetsDiscipline).toBe(false);
    await app.close();
  });
});
