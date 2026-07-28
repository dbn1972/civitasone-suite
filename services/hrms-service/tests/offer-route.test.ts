/**
 * Offer route wiring — create (shortlist gate + compensation), approval chain +
 * SoD, release gate, accept (metadata + version), decline (structured reason),
 * withdraw, and revise (new version supersedes previous).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000d11";
const USER = "aaaaaaaa-7777-4000-8000-000000000d11";  // offer creator
const OTHER = "aaaaaaaa-7777-4000-8000-000000000d12"; // approver
const APPL = "cccccccc-0000-4000-8000-00000000d011";
const OFF = "dddddddd-0000-4000-8000-00000000d012";

const H = vi.hoisted(() => ({
  findAppMock: vi.fn(),
  findOfferMock: vi.fn(),
  insertOfferMock: vi.fn(),
  updateOfferMock: vi.fn(),
  insertEventMock: vi.fn(),
  maxVersionMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb({}), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/recruitment/offer-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplication: (...a: unknown[]) => H.findAppMock(...a),
  findOffer: (...a: unknown[]) => H.findOfferMock(...a),
  insertOffer: (...a: unknown[]) => H.insertOfferMock(...a),
  updateOffer: (...a: unknown[]) => H.updateOfferMock(...a),
  insertEvent: (...a: unknown[]) => H.insertEventMock(...a),
  maxOfferVersion: (...a: unknown[]) => H.maxVersionMock(...a),
  listOffersForApplication: async () => [],
  listEvents: async () => [],
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { DEFAULT_OFFER_CHAIN } from "../src/modules/recruitment/offer-domain.js";

const auth = (roles: string[], sub = USER) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}` });
const offer = (over = {}) => ({ id: OFF, tenantId: TENANT, applicationId: APPL, offerNo: "OFR-1", offerVersion: 1, status: "draft", approvalChain: DEFAULT_OFFER_CHAIN, currentStage: -1, basicMinor: 8_00_000_00n, joiningBonusMinor: 0n, relocationMinor: 0n, variablePayMinor: 0n, grossCtcMinor: 8_00_000_00n, grade: "L1", createdBy: USER, version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.insertOfferMock.mockResolvedValue(undefined);
  H.updateOfferMock.mockResolvedValue(undefined);
  H.insertEventMock.mockResolvedValue(undefined);
  H.maxVersionMock.mockResolvedValue(0);
});
afterAll(async () => { await sqlClient.end(); });

describe("offer routes", () => {
  it("creates a draft offer for a shortlisted candidate with computed gross CTC (201)", async () => {
    H.findAppMock.mockResolvedValue({ id: APPL, tenantId: TENANT, screeningDecision: "shortlisted" });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APPL}/offers`, headers: auth(["hr_admin"]),
      payload: { basicMinor: 80000000, joiningBonusMinor: 10000000, relocationMinor: 5000000, variablePayMinor: 20000000, grade: "L1" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().grossCtcMinor).toBe("115000000");
    expect(H.insertOfferMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("refuses an offer to a candidate who is not shortlisted (409)", async () => {
    H.findAppMock.mockResolvedValue({ id: APPL, tenantId: TENANT, screeningDecision: "eligible" });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APPL}/offers`, headers: auth(["hr_admin"]), payload: { basicMinor: 1 } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_SHORTLISTED");
    await app.close();
  });

  it("advances the approval chain but forbids the creator from approving (SoD)", async () => {
    H.findOfferMock.mockResolvedValue(offer({ status: "pending_approval", currentStage: 0, createdBy: USER }));
    const app = await buildApp();
    const sod = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/approve`, headers: auth(["hr_admin"], USER), payload: {} });
    expect(sod.statusCode).toBe(409);
    expect(sod.json().code).toBe("SOD_VIOLATION");
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/approve`, headers: auth(["hr_admin"], OTHER), payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().currentStage).toBe(1);
    await app.close();
  });

  it("marks approved at the final stage and blocks release until then", async () => {
    H.findOfferMock.mockResolvedValue(offer({ status: "pending_approval", currentStage: 3, createdBy: USER }));
    const app = await buildApp();
    const notYet = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/release`, headers: auth(["hr_admin"]), payload: {} });
    expect(notYet.statusCode).toBe(409);
    expect(notYet.json().code).toBe("NOT_APPROVED");
    const fin = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/approve`, headers: auth(["competent_authority"], OTHER), payload: {} });
    expect(fin.json().status).toBe("approved");
    await app.close();
  });

  it("releases an approved offer and captures acceptance metadata + version", async () => {
    H.findOfferMock.mockResolvedValueOnce(offer({ status: "approved" }));
    const app = await buildApp();
    const rel = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/release`, headers: auth(["hr_admin"]), payload: { expiresAt: "2026-12-31" } });
    expect(rel.json().status).toBe("released");
    H.findOfferMock.mockResolvedValueOnce(offer({ status: "released", offerVersion: 1 }));
    const acc = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/accept`, headers: auth(["hr_admin"]), payload: { device: "web" } });
    expect(acc.json()).toMatchObject({ status: "accepted", acceptedVersion: 1 });
    const patch = H.updateOfferMock.mock.calls.at(-1)![3];
    expect(patch.acceptedVersion).toBe(1);
    expect(patch.acceptanceMeta).toHaveProperty("device", "web");
    await app.close();
  });

  it("requires a structured decline reason", async () => {
    H.findOfferMock.mockResolvedValue(offer({ status: "released" }));
    const app = await buildApp();
    const noReason = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/decline`, headers: auth(["hr_admin"]), payload: {} });
    expect(noReason.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/decline`, headers: auth(["hr_admin"]), payload: { reasonCode: "salary", remarks: "low" } });
    expect(ok.json()).toMatchObject({ status: "declined", reasonCode: "salary" });
    await app.close();
  });

  it("revises an offer into a new version that supersedes the previous", async () => {
    H.findOfferMock.mockResolvedValue(offer({ status: "declined", offerVersion: 1 }));
    H.maxVersionMock.mockResolvedValue(1);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/revise`, headers: auth(["hr_admin"]), payload: { basicMinor: 90000000 } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ offerVersion: 2, supersedesOfferId: OFF, status: "draft" });
    // previous marked revised + new offer inserted
    expect(H.updateOfferMock.mock.calls[0][3].status).toBe("revised");
    expect(H.insertOfferMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("withdraws a non-terminal offer (admin only)", async () => {
    H.findOfferMock.mockResolvedValue(offer({ status: "released" }));
    const app = await buildApp();
    const forbidden = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/withdraw`, headers: auth(["hr_officer"]), payload: { reason: "x" } });
    expect(forbidden.statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/withdraw`, headers: auth(["hr_admin"]), payload: { reason: "budget cut" } });
    expect(ok.json().status).toBe("withdrawn");
    await app.close();
  });
});
