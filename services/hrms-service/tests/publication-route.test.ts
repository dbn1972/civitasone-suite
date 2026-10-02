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
  findVacancyTx: (_tx: unknown, ...a: unknown[]) => H.findMock(...a),
  updateVacancy: (...a: unknown[]) => H.updMock(...a),
  nextCorrigendumSeq: (...a: unknown[]) => H.seqMock(...a),
  nextCorrigendumSeqTx: (_tx: unknown, ...a: unknown[]) => H.seqMock(...a),
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
    H.findMock.mockResolvedValue(vac({ isPublished: false }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "PATCH", url: `/v1/hrms/job-openings/${VAC}/advertisement`, headers: auth,
      payload: { feesMinor: 50000, requiredDocuments: ["photo", "signature"], selectionProcess: "written+interview", applicationDeadline: "2026-09-30T18:00:00Z", portalScope: "both" } });
    expect(r.statusCode).toBe(200);
    expect(H.updMock).toHaveBeenCalledOnce();
    const patch = H.updMock.mock.calls[0][3];
    expect(patch.feesMinor).toBe(50000n);
    await app.close();
  });

  it("reads the advertisement back (GAP-RECRUITMENT-DETAIL-13): bigint fees as a string, real status, defaults for empties", async () => {
    const app = await buildApp();
    H.findMock.mockResolvedValue(vac({ status: "cancelled", feesMinor: 50000n, feeExemption: "SC/ST exempt", requiredDocuments: ["photo"], selectionProcess: null, importantDates: { exam: "2026-11-01" }, portalScope: "both" }));
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/job-openings/${VAC}/advertisement`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      id: VAC, status: "cancelled", feesMinor: "50000", feeExemption: "SC/ST exempt", requiredDocuments: ["photo"],
      selectionProcess: null, importantDates: { exam: "2026-11-01" }, portalScope: "both",
    });
    H.findMock.mockResolvedValue(vac({ requiredDocuments: undefined, importantDates: undefined, feesMinor: undefined }));
    const bare = await injectF3(app, { method: "GET", url: `/v1/hrms/job-openings/${VAC}/advertisement`, headers: auth });
    expect(bare.json()).toMatchObject({ feesMinor: null, requiredDocuments: [], importantDates: {} });
    await app.close();
  });

  it("does not let a non-HR role read the advertisement for another tenant's vacancy (404 when absent)", async () => {
    const app = await buildApp();
    H.findMock.mockResolvedValue(null);
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/job-openings/${VAC}/advertisement`, headers: auth });
    expect(r.statusCode).toBe(404);
    const anon = await injectF3(app, { method: "GET", url: `/v1/hrms/job-openings/${VAC}/advertisement` });
    expect([401, 403]).toContain(anon.statusCode);
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
    const bad = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/extend`, headers: auth, payload: { newDeadline: "2026-08-01T00:00:00Z", reason: "x" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("NOT_AN_EXTENSION");
    H.findMock.mockResolvedValue(vac({ status: "closed" }));
    const ok = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/extend`, headers: auth, payload: { newDeadline: "2099-09-30T00:00:00Z", reason: "low response" } });
    expect(ok.json().status).toBe("open");
    expect(H.updMock.mock.calls.at(-1)![3].status).toBe("open"); // reopened
    expect(H.insCorrMock.mock.calls[0][1].action).toBe("extension");
    await app.close();
  });

  // H1: the publish rule is enforced server-side (route AND consumer), never UI-only.
  describe("publish rule (H1)", () => {
    const publish = async (app: Awaited<ReturnType<typeof buildApp>>, isPublished: boolean) =>
      injectF3(app, { method: "PATCH", url: `/v1/hrms/job-openings/${VAC}/publish`, headers: auth, payload: { isPublished } });
    const FUTURE = new Date("2099-01-01T00:00:00Z");

    it("409s publishing a vacancy that is not open (closed or cancelled) and writes nothing", async () => {
      const app = await buildApp();
      for (const status of ["closed", "cancelled", "on_hold"]) {
        H.findMock.mockResolvedValue(vac({ status, isPublished: false, applicationDeadline: FUTURE }));
        const r = await publish(app, true);
        expect(r.statusCode).toBe(409);
        expect(r.json().code).toBe("VACANCY_NOT_OPEN");
      }
      expect(H.updMock).not.toHaveBeenCalled();
      await app.close();
    });

    it("409s publishing once the deadline DATE (IST) is before today, but allows the deadline day itself", async () => {
      const app = await buildApp();
      H.findMock.mockResolvedValue(vac({ isPublished: false, applicationDeadline: new Date("2020-01-01T10:00:00Z") }));
      const past = await publish(app, true);
      expect(past.statusCode).toBe(409);
      expect(past.json().code).toBe("DEADLINE_PASSED");
      expect(H.updMock).not.toHaveBeenCalled();
      // Deadline is earlier today (IST) -> still the same calendar date -> allowed.
      H.findMock.mockResolvedValue(vac({ isPublished: false, applicationDeadline: new Date(Date.now() - 60_000) }));
      const sameDay = await publish(app, true);
      expect([200, 202]).toContain(sameDay.statusCode);
      await app.close();
    });

    it("publishes an open, in-date vacancy and NEVER blocks unpublish (even cancelled / expired)", async () => {
      const app = await buildApp();
      H.findMock.mockResolvedValue(vac({ isPublished: false, applicationDeadline: FUTURE }));
      expect((await publish(app, true)).statusCode).toBe(200);
      expect(H.updMock.mock.calls.at(-1)![3].isPublished).toBe(true);
      H.findMock.mockResolvedValue(vac({ status: "cancelled", isPublished: true, applicationDeadline: new Date("2020-01-01") }));
      expect((await publish(app, false)).statusCode).toBe(200);
      expect(H.updMock.mock.calls.at(-1)![3].isPublished).toBe(false);
      await app.close();
    });

    it("the consumer re-checks at write time: a vacancy closed after the route accepted it is not published", async () => {
      const app = await buildApp();
      H.findMock.mockResolvedValueOnce(vac({ isPublished: false, applicationDeadline: FUTURE })); // route
      H.findMock.mockResolvedValue(vac({ status: "closed", isPublished: false, applicationDeadline: FUTURE })); // consumer
      const before = H.updMock.mock.calls.length;
      await publish(app, true);
      expect(H.updMock.mock.calls.length).toBe(before);
      await app.close();
    });
  });

  // H2 / M5
  it("requires a reason on /extend and rejects a past deadline even when there is no current deadline", async () => {
    const app = await buildApp();
    const noReason = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/extend`, headers: auth, payload: { newDeadline: "2099-01-01T00:00:00Z" } });
    expect(noReason.statusCode).toBe(400);
    const blank = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/extend`, headers: auth, payload: { newDeadline: "2099-01-01T00:00:00Z", reason: "   " } });
    expect(blank.statusCode).toBe(400);
    H.findMock.mockResolvedValue(vac({ applicationDeadline: null }));
    const past = await injectF3(app, { method: "POST", url: `/v1/hrms/job-openings/${VAC}/extend`, headers: auth, payload: { newDeadline: "2020-01-01T00:00:00Z", reason: "x" } });
    expect(past.statusCode).toBe(400);
    expect(past.json().code).toBe("DEADLINE_IN_PAST");
    expect(H.insCorrMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses PATCH /advertisement once published or cancelled (corrigendum is the path), and lets a fee be cleared while unpublished", async () => {
    const app = await buildApp();
    const patch = (payload: unknown) => injectF3(app, { method: "PATCH", url: `/v1/hrms/job-openings/${VAC}/advertisement`, headers: auth, payload });
    H.findMock.mockResolvedValue(vac({ isPublished: true }));
    const pub = await patch({ feeExemption: "x" });
    expect(pub.statusCode).toBe(409);
    expect(pub.json().code).toBe("ADVERTISEMENT_LOCKED");
    H.findMock.mockResolvedValue(vac({ status: "cancelled", isPublished: false }));
    expect((await patch({ feeExemption: "x" })).statusCode).toBe(409);
    expect(H.updMock).not.toHaveBeenCalled();
    H.findMock.mockResolvedValue(vac({ isPublished: false }));
    expect((await patch({ feesMinor: null })).statusCode).toBe(200);
    expect(H.updMock.mock.calls.at(-1)![3].feesMinor).toBeNull();
    await app.close();
  });

  it("GET advertisement: manager allowed, employee denied", async () => {
    const app = await buildApp();
    const as = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}` });
    expect((await injectF3(app, { method: "GET", url: `/v1/hrms/job-openings/${VAC}/advertisement`, headers: as(["manager"]) })).statusCode).toBe(200);
    expect((await injectF3(app, { method: "GET", url: `/v1/hrms/job-openings/${VAC}/advertisement`, headers: as(["employee"]) })).statusCode).toBe(403);
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
