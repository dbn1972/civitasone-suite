/**
 * Selection list routes — create draft, set ranked entries, senior+SoD approval
 * with validity, publish, and the draft-only edit lock.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-9999-4000-8000-000000000a99";
const CREATOR = "aaaaaaaa-1111-4000-8000-000000000a99";
const APPROVER = "aaaaaaaa-2222-4000-8000-000000000a99";
const JOB = "cccccccc-9999-4000-8000-00000000c099";
const LIST = "dddddddd-9999-4000-8000-00000000d099";
const A1 = "11111111-9999-4000-8000-000000000001";
const A2 = "11111111-9999-4000-8000-000000000002";

const H = vi.hoisted(() => ({ insertList: vi.fn(), findList: vi.fn(), updateList: vi.fn(), setEntries: vi.fn(), listEntries: vi.fn(), listByJob: vi.fn() }));

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
vi.mock("../src/modules/recruitment/selection-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertList: (...a: unknown[]) => H.insertList(...a),
  findList: (...a: unknown[]) => H.findList(...a),
  updateList: (...a: unknown[]) => H.updateList(...a),
  setEntries: (...a: unknown[]) => H.setEntries(...a),
  listEntries: (...a: unknown[]) => H.listEntries(...a),
  listByJob: (...a: unknown[]) => H.listByJob(...a),
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

const tok = (sub: string, roles: string[]) => `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`;
const creator = { authorization: tok(CREATOR, ["hr_admin"]) };
const approver = { authorization: tok(APPROVER, ["hr_admin"]) };
const officer = { authorization: tok(APPROVER, ["hr_officer"]) };
const list = (over = {}) => ({ id: LIST, tenantId: TENANT, jobOpeningId: JOB, title: "Merit", vacancies: 2, status: "draft", createdBy: CREATOR, validityUntil: null, version: 1, ...over });
const futureIso = new Date(Date.now() + 365 * 86400_000).toISOString();
const goodEntries = [
  { applicationId: A1, candidateName: "A", category: "selected", rank: 1 },
  { applicationId: A2, candidateName: "B", category: "waitlist", rank: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  H.insertList.mockResolvedValue(undefined);
  H.updateList.mockResolvedValue(undefined);
  H.setEntries.mockResolvedValue(undefined);
  H.listEntries.mockResolvedValue([]);
  H.listByJob.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("selection list routes", () => {
  it("creates a draft list (201)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${JOB}/selection-lists`, headers: creator, payload: { title: "Merit 2026", vacancies: 2 } });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("draft");
    await app.close();
  });

  it("sets ranked entries on a draft list (200)", async () => {
    H.findList.mockResolvedValue(list());
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/selection-lists/${LIST}/entries`, headers: creator, payload: { entries: goodEntries } });
    expect(r.statusCode).toBe(200);
    expect(H.setEntries).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects entries with more selected than vacancies (422)", async () => {
    H.findList.mockResolvedValue(list({ vacancies: 1 }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/selection-lists/${LIST}/entries`, headers: creator, payload: { entries: [
      { applicationId: A1, candidateName: "A", category: "selected", rank: 1 },
      { applicationId: A2, candidateName: "B", category: "selected", rank: 2 },
    ] } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_ENTRIES");
    await app.close();
  });

  it("refuses to edit entries on a non-draft list (409)", async () => {
    H.findList.mockResolvedValue(list({ status: "approved" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "PUT", url: `/v1/hrms/selection-lists/${LIST}/entries`, headers: creator, payload: { entries: goodEntries } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_DRAFT");
    await app.close();
  });

  it("blocks the creator from approving their own list (403 SoD)", async () => {
    H.findList.mockResolvedValue(list());
    H.listEntries.mockResolvedValue([{ applicationId: A1, category: "selected", rank: 1 }]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/selection-lists/${LIST}/approve`, headers: creator, payload: { validUntil: futureIso } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("blocks whoever authored the ranking from approving (403 SoD), even if not the creator", async () => {
    // created by CREATOR, but APPROVER authored the ranking -> APPROVER can't approve
    H.findList.mockResolvedValue(list({ entriesSetBy: APPROVER }));
    H.listEntries.mockResolvedValue([{ applicationId: A1, category: "selected", rank: 1 }]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/selection-lists/${LIST}/approve`, headers: approver, payload: { validUntil: futureIso } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("approve is senior-only (hr_officer 403)", async () => {
    H.findList.mockResolvedValue(list());
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/selection-lists/${LIST}/approve`, headers: officer, payload: { validUntil: futureIso } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("approves with a validity period by an independent senior user (200)", async () => {
    H.findList.mockResolvedValue(list());
    H.listEntries.mockResolvedValue([{ applicationId: A1, category: "selected", rank: 1 }, { applicationId: A2, category: "waitlist", rank: 1 }]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/selection-lists/${LIST}/approve`, headers: approver, payload: { validUntil: futureIso } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("approved");
    const patch = H.updateList.mock.calls[0][3] as { status: string; validityUntil: string };
    expect(patch.status).toBe("approved");
    expect(patch.validityUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await app.close();
  });

  it("refuses approval with no entries (409)", async () => {
    H.findList.mockResolvedValue(list());
    H.listEntries.mockResolvedValue([]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/selection-lists/${LIST}/approve`, headers: approver, payload: { validUntil: futureIso } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NO_ENTRIES");
    await app.close();
  });

  it("publishes an approved list (200) and refuses to publish a draft (409)", async () => {
    H.findList.mockResolvedValue(list({ status: "approved" }));
    const app = await buildApp();
    const ok = await injectF3(app, { method: "POST", url: `/v1/hrms/selection-lists/${LIST}/publish`, headers: approver, payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("published");
    H.findList.mockResolvedValue(list({ status: "draft" }));
    const bad = await injectF3(app, { method: "POST", url: `/v1/hrms/selection-lists/${LIST}/publish`, headers: approver, payload: {} });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().code).toBe("NOT_APPROVED");
    await app.close();
  });
});
