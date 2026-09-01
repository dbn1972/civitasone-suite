/**
 * Offer joining-extension + analytics routes.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-8888-4000-8000-000000000a88";
const USER = "aaaaaaaa-7777-4000-8000-000000000a88";
const OFF = "dddddddd-8888-4000-8000-00000000d088";
const JOB = "cccccccc-8888-4000-8000-00000000c088";

const H = vi.hoisted(() => ({ findOffer: vi.fn(), updateOffer: vi.fn(), listOffersForAnalytics: vi.fn() }));

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
vi.mock("../src/modules/recruitment/offer-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findOffer: (...a: unknown[]) => H.findOffer(...a),
  updateOffer: (...a: unknown[]) => H.updateOffer(...a),
}));
vi.mock("../src/modules/recruitment/offer-analytics-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  listOffersForAnalytics: (...a: unknown[]) => H.listOffersForAnalytics(...a),
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

const tok = (roles: string[]) => `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`;
const auth = { authorization: tok(["hr_admin"]) };
const officer = { authorization: tok(["hr_officer"]) };
const offer = (over = {}) => ({ id: OFF, tenantId: TENANT, status: "accepted", joiningDate: "2026-09-01", joiningExtensionStatus: "none", originalJoiningDate: null, requestedJoiningDate: null, version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.updateOffer.mockResolvedValue(undefined);
  H.listOffersForAnalytics.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("offer joining-extension + analytics routes", () => {
  it("requests a joining-date extension on an accepted offer (200)", async () => {
    H.findOffer.mockResolvedValue(offer());
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension`, headers: auth, payload: { requestedJoiningDate: "2026-10-15", reason: "relocation logistics" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().joiningExtensionStatus).toBe("requested");
    const patch = H.updateOffer.mock.calls[0][3] as { originalJoiningDate: string; requestedJoiningDate: string };
    expect(patch.originalJoiningDate).toBe("2026-09-01"); // snapshots the current date
    expect(patch.requestedJoiningDate).toBe("2026-10-15");
    await app.close();
  });

  it("refuses an extension that is not later than the current date (422)", async () => {
    H.findOffer.mockResolvedValue(offer());
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension`, headers: auth, payload: { requestedJoiningDate: "2026-08-01", reason: "earlier please" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("NOT_LATER");
    await app.close();
  });

  it("refuses an extension on a non-accepted offer (409)", async () => {
    H.findOffer.mockResolvedValue(offer({ status: "released" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension`, headers: auth, payload: { requestedJoiningDate: "2026-10-15", reason: "relocation logistics" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_ACCEPTED");
    await app.close();
  });

  it("refuses an extension when the offer has no joining date (409)", async () => {
    H.findOffer.mockResolvedValue(offer({ joiningDate: null }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension`, headers: auth, payload: { requestedJoiningDate: "2026-10-15", reason: "relocation logistics" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NO_JOINING_DATE");
    await app.close();
  });

  it("records the requester and preserves it (requestedBy set on request)", async () => {
    H.findOffer.mockResolvedValue(offer());
    const app = await buildApp();
    await injectF3(app, { method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension`, headers: auth, payload: { requestedJoiningDate: "2026-10-15", reason: "relocation logistics" } });
    const patch = H.updateOffer.mock.calls[0][3] as { requestedBy: string };
    expect(patch.requestedBy).toBe(USER);
    await app.close();
  });

  it("approve is senior-only and applies the new joining date (200)", async () => {
    H.findOffer.mockResolvedValue(offer({ joiningExtensionStatus: "requested", requestedJoiningDate: "2026-10-15", requestedBy: "99999999-8888-4000-8000-000000000099" }));
    const app = await buildApp();
    const denied = await injectF3(app, { method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension/approve`, headers: officer, payload: {} });
    expect(denied.statusCode).toBe(403);
    const ok = await injectF3(app, { method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension/approve`, headers: auth, payload: {} });
    expect(ok.statusCode).toBe(200);
    const patch = H.updateOffer.mock.calls[0][3] as { joiningDate: string; joiningExtensionStatus: string };
    expect(patch.joiningDate).toBe("2026-10-15");
    expect(patch.joiningExtensionStatus).toBe("approved");
    await app.close();
  });

  it("blocks the requester from approving their own extension (403 SoD)", async () => {
    H.findOffer.mockResolvedValue(offer({ joiningExtensionStatus: "requested", requestedJoiningDate: "2026-10-15", requestedBy: USER }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension/approve`, headers: auth, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.updateOffer).not.toHaveBeenCalled();
    await app.close();
  });

  it("approve fails when there is no pending request (409)", async () => {
    H.findOffer.mockResolvedValue(offer({ joiningExtensionStatus: "none" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension/approve`, headers: auth, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NO_REQUEST");
    await app.close();
  });

  const analyticsRow = (over = {}) => ({ status: "accepted", releasedAt: new Date(Date.now() - 5 * 86400000), acceptedAt: new Date(), declineReasonCode: null, ...over });

  it("restricts small-cohort analytics to senior roles (hr_officer 403, hr_admin 200)", async () => {
    H.listOffersForAnalytics.mockResolvedValue([
      analyticsRow({ status: "accepted" }),
      analyticsRow({ status: "declined", declineReasonCode: "salary" }),
      analyticsRow({ status: "released" }),
    ]); // 3 < MIN_ANALYTICS_COHORT
    const app = await buildApp();
    const denied = await injectF3(app, { method: "GET", url: `/v1/hrms/recruitment/offer-analytics?jobOpeningId=${JOB}`, headers: officer });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("SMALL_COHORT");
    const ok = await injectF3(app, { method: "GET", url: `/v1/hrms/recruitment/offer-analytics?jobOpeningId=${JOB}`, headers: auth });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("returns offer analytics for a real cohort (hr_officer allowed)", async () => {
    const rows = [
      analyticsRow({ status: "accepted" }), analyticsRow({ status: "accepted" }),
      analyticsRow({ status: "declined", declineReasonCode: "salary" }),
      analyticsRow({ status: "expired" }),
      analyticsRow({ status: "released", releasedAt: new Date(Date.now() - 2 * 86400000), acceptedAt: null }),
    ];
    H.listOffersForAnalytics.mockResolvedValue(rows);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/recruitment/offer-analytics?jobOpeningId=${JOB}`, headers: officer });
    expect(r.statusCode).toBe(200); // 5 >= MIN_ANALYTICS_COHORT
    const b = r.json();
    expect(b.funnel).toMatchObject({ total: 5, accepted: 2, declined: 1, expired: 1, pending: 1 });
    expect(b.acceptanceRatePct).toBe(50); // 2 / (2+1+1)
    expect(b.declineBreakdown).toEqual({ salary: 1 });
    expect(H.listOffersForAnalytics).toHaveBeenCalledWith(TENANT, JOB);
    await app.close();
  });
});
