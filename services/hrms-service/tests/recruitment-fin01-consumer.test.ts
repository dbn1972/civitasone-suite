/**
 * fin-recruitment-01 consumer-side writes (invoked directly, no HTTP):
 *  - recruitment_settings_routes__0 / recruitment_pii_reveal__0 (finish-consumer): write + audit in one tx, idempotent
 *  - GAP-RECRUITMENT-DETAIL-03: the roster consumer persists the horizontal reservations
 *  - GAP-RECRUITMENT-DETAIL-05: releasing an approved offer moves the application to "offered" and keeps pay level/cell
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  emitAudit: vi.fn(async () => undefined),
  markProcessed: vi.fn(async () => true),
  getSettingsTx: vi.fn(),
  upsertSettings: vi.fn(),
  insertRoster: vi.fn(async () => undefined),
  updateRoster: vi.fn(async () => undefined),
  findByJobTx: vi.fn(),
  findOfferTx: vi.fn(),
  updateOffer: vi.fn(async () => undefined),
  insertOffer: vi.fn(async () => undefined),
  insertEvent: vi.fn(async () => undefined),
  maxOfferVersionTx: vi.fn(async () => 0),
  claimApplicationForOffer: vi.fn(async () => true),
}));

vi.mock("../src/modules/recruitment/audit-emit.js", () => ({ emitAudit: (...a: unknown[]) => (H.emitAudit as (...x: unknown[]) => unknown)(...a) }));
vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/shared/outbox.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  markProcessed: (...a: unknown[]) => (H.markProcessed as (...x: unknown[]) => unknown)(...a),
  enqueue: async () => undefined,
}));
vi.mock("../src/modules/recruitment/settings-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  getSettingsTx: (...a: unknown[]) => H.getSettingsTx(...a),
  upsertSettings: (...a: unknown[]) => H.upsertSettings(...a),
}));
vi.mock("../src/modules/recruitment/reservation-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertRoster: (...a: unknown[]) => (H.insertRoster as (...x: unknown[]) => unknown)(...a),
  updateRoster: (...a: unknown[]) => (H.updateRoster as (...x: unknown[]) => unknown)(...a),
  findByJobTx: (...a: unknown[]) => H.findByJobTx(...a),
}));
vi.mock("../src/modules/recruitment/offer-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findOfferTx: (...a: unknown[]) => H.findOfferTx(...a),
  updateOffer: (...a: unknown[]) => (H.updateOffer as (...x: unknown[]) => unknown)(...a),
  insertOffer: (...a: unknown[]) => (H.insertOffer as (...x: unknown[]) => unknown)(...a),
  insertEvent: (...a: unknown[]) => (H.insertEvent as (...x: unknown[]) => unknown)(...a),
  maxOfferVersionTx: (...a: unknown[]) => (H.maxOfferVersionTx as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("../src/modules/recruitment/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  claimApplicationForOffer: (...a: unknown[]) => (H.claimApplicationForOffer as (...x: unknown[]) => unknown)(...a),
}));

import { registerRecruitmentFinishConsumers } from "../src/modules/recruitment/finish-consumer.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { COMMANDS } from "../src/topics.js";

type Handler = (msg: Record<string, unknown>) => Promise<void>;
const finish = new Map<string, Handler>();
registerRecruitmentFinishConsumers({ subscribe: (t: string, fn: Handler) => { finish.set(t, fn); } } as never);
const f3 = new Map<string, Handler>();
registerF3_recruitment_Consumers({ subscribe: (t: string, fn: Handler) => { f3.set(t, fn); } } as never);

const TENANT = "aaaaaaaa-0001-4000-8000-00000000a001";
const ACTOR = "99999999-0001-4000-8000-000000000009";
const APP_ID = "11111111-0001-4000-8000-000000000001";
const JOB = "22222222-0001-4000-8000-000000000002";
const OFFER = "66666666-0001-4000-8000-000000000006";
const msg = (payload: Record<string, unknown>) => ({ messageId: "m-1", tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1", payload: { tenantId: TENANT, ...payload } });
const runFinish = (payload: Record<string, unknown>) => finish.get(COMMANDS.f3RouteWrite)!(msg(payload));
const runF3 = (payload: Record<string, unknown>) => f3.get(COMMANDS.f3RouteWrite)!(msg(payload));

beforeEach(() => {
  vi.clearAllMocks();
  H.markProcessed.mockResolvedValue(true);
  H.getSettingsTx.mockResolvedValue({ organisationName: null, departmentName: null, emblemUrl: null, offerWorkflowRequired: true, applicantPurposeNote: null });
  H.upsertSettings.mockImplementation(async (_tx: unknown, _t: string, _a: string, patch: Record<string, unknown>) => ({ organisationName: null, departmentName: null, emblemUrl: null, offerWorkflowRequired: true, applicantPurposeNote: null, ...patch }));
});

describe("finish consumer: settings", () => {
  it("upserts only the supplied settings and audits what changed", async () => {
    await runFinish({ op: "recruitment_settings_routes__0", id: "x", body: { organisationName: "Government of Odisha", offerWorkflowRequired: false }, params: {} });
    expect(H.upsertSettings).toHaveBeenCalledWith(expect.anything(), TENANT, ACTOR, { organisationName: "Government of Odisha", offerWorkflowRequired: false });
    const [, , action, resourceType, , details] = H.emitAudit.mock.calls[0] as unknown as [unknown, unknown, string, string, string, Record<string, unknown>];
    expect(action).toBe("recruitment_settings_updated");
    expect(resourceType).toBe("recruitment_settings");
    expect(details).toMatchObject({ changed: ["organisationName", "offerWorkflowRequired"], offerWorkflowRequiredBefore: true, offerWorkflowRequiredAfter: false });
  });

  it("is idempotent: a redelivered message writes and audits nothing", async () => {
    H.markProcessed.mockResolvedValue(false);
    await runFinish({ op: "recruitment_settings_routes__0", id: "x", body: { organisationName: "X" }, params: {} });
    expect(H.upsertSettings).not.toHaveBeenCalled();
    expect(H.emitAudit).not.toHaveBeenCalled();
  });

  it("ignores ops that belong to other consumers", async () => {
    await runFinish({ op: "recruitment_offer_routes__0", id: "x", body: {}, params: {} });
    expect(H.markProcessed).not.toHaveBeenCalled();
  });
});

describe("finish consumer: PII reveal audit", () => {
  it("records actor (via the context), application, scope, reason and fields -- never the values", async () => {
    await runFinish({ op: "recruitment_pii_reveal__0", id: "x", params: { id: APP_ID }, body: { action: "applicant_contact_revealed", scope: "talent_pool", reason: "re-engage past applicant", fields: ["email", "mobile"] } });
    expect(H.emitAudit).toHaveBeenCalledTimes(1);
    const [, ctx, action, resourceType, resourceId, details] = H.emitAudit.mock.calls[0] as unknown as [unknown, Record<string, string>, string, string, string, Record<string, unknown>];
    expect(ctx).toEqual({ tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1" });
    expect([action, resourceType, resourceId]).toEqual(["applicant_contact_revealed", "application", APP_ID]);
    expect(details).toEqual({ scope: "talent_pool", reason: "re-engage past applicant", fields: ["email", "mobile"] });
  });
});

describe("recruitment F3 consumer: roster horizontal reservations (DETAIL-03)", () => {
  it("creates a roster carrying the horizontal counts", async () => {
    H.findByJobTx.mockResolvedValue(null);
    await runF3({ op: "recruitment_reservation_routes__0", id: "r1", params: { id: JOB }, body: { totalVacancies: 10, categoryVacancies: { UR: 5, SC: 2, ST: 1, OBC: 1, EWS: 1 }, horizontalVacancies: { PWBD: 1, EXSM: 2 } } });
    expect(H.insertRoster).toHaveBeenCalledTimes(1);
    expect((H.insertRoster.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1].horizontalVacancies).toEqual({ PWBD: 1, EXSM: 2 });
  });

  it("updates a draft roster, replacing the horizontal counts", async () => {
    H.findByJobTx.mockResolvedValue({ version: 3, status: "draft" });
    await runF3({ op: "recruitment_reservation_routes__0", id: "r1", params: { id: JOB }, body: { totalVacancies: 10, categoryVacancies: { UR: 10 }, horizontalVacancies: { WOMEN: 3 } } });
    expect((H.updateRoster.mock.calls[0] as unknown as [unknown, string, string, Record<string, unknown>, number])[3].horizontalVacancies).toEqual({ WOMEN: 3 });
  });
});

describe("recruitment F3 consumer: offers (DETAIL-05)", () => {
  it("creates a draft offer with the pay-matrix level and cell", async () => {
    await runF3({ op: "recruitment_offer_routes__0", id: OFFER, params: { id: APP_ID }, body: { basicMinor: 5_610_000, payLevel: 10, payCell: 3 } });
    const row = (H.insertOffer.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(row).toMatchObject({ payLevel: "10", payCell: 3, status: "draft", currentStage: -1, applicationId: APP_ID });
  });

  it("releasing an approved offer claims the application for stage 'offered' (so Hire stays reachable)", async () => {
    H.findOfferTx.mockResolvedValue({ id: OFFER, applicationId: APP_ID, version: 4, status: "approved" });
    await runF3({ op: "recruitment_offer_routes__4", id: "x", params: { offerId: OFFER }, body: {} });
    expect(H.updateOffer).toHaveBeenCalledWith(expect.anything(), TENANT, OFFER, expect.objectContaining({ status: "released" }), 4);
    expect(H.claimApplicationForOffer).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT);
  });
});
