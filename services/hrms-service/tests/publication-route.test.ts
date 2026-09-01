/**
 * Job publication route wiring — advertisement config, corrigendum/extend/cancel
 * (preserving the advert), corrigenda history, and public career search.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000f11";
const USER = "aaaaaaaa-7777-4000-8000-000000000f11";
const VAC = "bbbbbbbb-0000-4000-8000-00000000f011";

const H = vi.hoisted(() => ({
  findMock: vi.fn(), updMock: vi.fn(), seqMock: vi.fn(), insCorrMock: vi.fn(), listCorrMock: vi.fn(), searchMock: vi.fn(),
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
vi.mock("../src/modules/recruitment/publication-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findVacancy: (...a: unknown[]) => H.findMock(...a),
  updateVacancy: (...a: unknown[]) => H.updMock(...a),
  nextCorrigendumSeq: (...a: unknown[]) => H.seqMock(...a),
  insertCorrigendum: (...a: unknown[]) => H.insCorrMock(...a),
  listCorrigenda: (...a: unknown[]) => H.listCorrMock(...a),
  searchVacancies: (...a: unknown[]) => H.searchMock(...a),
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
const vac = (over = {}) => ({ id: VAC, tenantId: TENANT, status: "open", isPublished: "true", version: 1, applicationDeadline: new Date("2026-08-31T00:00:00Z"), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.findMock.mockResolvedValue(vac()); H.updMock.mockResolvedValue(undefined);
  H.seqMock.mockResolvedValue(1); H.insCorrMock.mockResolvedValue(undefined);
  H.listCorrMock.mockResolvedValue([]); H.searchMock.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("job publication routes", () => {
  it("sets advertisement details", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PATCH", url: `/v1/hrms/job-openings/${VAC}/advertisement`, headers: auth,
      payload: { feesMinor: 50000, requiredDocuments: ["photo", "signature"], selectionProcess: "written+interview", applicationDeadline: "2026-09-30T18:00:00Z", portalScope: "both" } });
    expect(r.statusCode).toBe(200);
    expect(H.updMock).toHaveBeenCalledOnce();
    const patch = H.updMock.mock.calls[0][3];
    expect(patch.feesMinor).toBe(50000n);
    await app.close();
  });

  it("records a corrigendum preserving the advert", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/corrigendum`, headers: auth, payload: { changes: "qualification revised to B.E/B.Tech" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().corrigendumSeq).toBe(1);
    expect(H.insCorrMock.mock.calls[0][1].action).toBe("corrigendum");
    await app.close();
  });

  it("extends the deadline (and reopens), rejecting an earlier date", async () => {
    const app = await buildApp();
    const bad = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/extend`, headers: auth, payload: { newDeadline: "2026-08-01T00:00:00Z" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("NOT_AN_EXTENSION");
    H.findMock.mockResolvedValue(vac({ status: "closed" }));
    const ok = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/extend`, headers: auth, payload: { newDeadline: "2026-09-30T00:00:00Z", reason: "low response" } });
    expect(ok.json().status).toBe("open");
    expect(H.updMock.mock.calls.at(-1)![3].status).toBe("open"); // reopened
    expect(H.insCorrMock.mock.calls[0][1].action).toBe("extension");
    await app.close();
  });

  it("cancels a vacancy and blocks double-cancel", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/cancel`, headers: auth, payload: { reason: "post abolished" } });
    expect(r.json().status).toBe("cancelled");
    expect(H.insCorrMock.mock.calls[0][1].action).toBe("cancellation");
    H.findMock.mockResolvedValue(vac({ status: "cancelled" }));
    const again = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/cancel`, headers: auth, payload: { reason: "x" } });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it("lists corrigenda history", async () => {
    H.listCorrMock.mockResolvedValue([{ seq: 1, action: "corrigendum" }, { seq: 2, action: "extension" }]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/job-openings/${VAC}/corrigenda`, headers: auth });
    expect(r.json().data).toHaveLength(2);
    await app.close();
  });

  it("public career search returns an advert-safe projection", async () => {
    H.searchMock.mockResolvedValue([{ id: VAC, refNo: "R1", title: "Scientist", location: "HQ", vacancyType: "regular", vacancies: 2, createdBy: "secret-user", updatedBy: "secret" }]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/careers/search?tenantId=${TENANT}&keyword=scientist&location=HQ` });
    expect(r.statusCode).toBe(200);
    const row = r.json().data[0];
    expect(row.title).toBe("Scientist");
    expect(row).not.toHaveProperty("createdBy"); // internal fields not leaked
    await app.close();
  });
});
