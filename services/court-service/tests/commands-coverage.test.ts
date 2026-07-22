/**
 * Commands coverage — exercises the REAL command functions across all court-service modules.
 *
 * Each commands.ts file: validates input (zod) → derives a deterministic messageId →
 * publishes to queue. We mock only queue.publish and the DB (so Drizzle schema imports
 * don't crash) and call the real functions to cover the validation + id-derivation logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

// ── Infrastructure mocks ─────────────────────────────────────────────────────
const publishSpy = vi.fn(async () => {});

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(), put: async () => {}, invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":") },
  queue: { publish: (...args: unknown[]) => publishSpy(...args) },
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
  sqlClient: {},
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => {}),
  markProcessed: vi.fn(async () => true),
  versionedUpdate: vi.fn(async () => {}),
}));

vi.mock("../src/shared/pii-crypto.js", () => ({
  assertPiiKeyConfigured: () => {},
  encryptPii: (v: string) => `enc:${v}`,
  decryptPii: (v: string) => v.replace(/^enc:/, ""),
  encryptedText: () => ({}),
}));

vi.mock("@civitasone/db", () => ({
  createSqlClient: () => ({}),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: () => {} },
  runWithTenant: async (_tid: string, fn: () => Promise<unknown>) => fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
const TENANT = randomUUID();
const ACTOR = randomUUID();
const CASE_ID = randomUUID();
const COURT_ID = randomUUID();
const HEARING_ID = randomUUID();
const ORDER_ID = randomUUID();
const APPEAL_ID = randomUUID();
const NOTICE_ID = randomUUID();
const PARTY_ID = randomUUID();
const EVIDENCE_ID = randomUUID();
const SCRUTINY_ID = randomUUID();
const DEFECT_ID = randomUUID();
const COPY_ID = randomUUID();
const PARCEL_ID = randomUUID();
const CONFIG_ID = randomUUID();

function ctx() {
  return { tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), roles: ["super_admin"], sessionId: "s" };
}

describe("case-registry commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("registerCase validates + publishes", async () => {
    const { registerCase } = await import("../src/modules/case-registry/commands.js");
    const result = await registerCase(ctx(), {
      cnrNumber: "DLHC010001234202",
      caseType: "civil",
      filingDate: "2026-07-01",
      title: "Rao v. State",
      courtId: COURT_ID,
      parties: [{ partyRole: "petitioner", name: "A. Rao" }],
    });
    expect(result.accepted).toBe(true);
    expect(result.caseId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("case-lifecycle commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("updateCaseStatus validates + publishes", async () => {
    const { updateCaseStatus } = await import("../src/modules/case-lifecycle/commands.js");
    const result = await updateCaseStatus(ctx(), CASE_ID, { toStatus: "admitted", expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(result.caseId).toBe(CASE_ID);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("hearing commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("scheduleHearing validates + publishes", async () => {
    const { scheduleHearing } = await import("../src/modules/hearing/commands.js");
    const result = await scheduleHearing(ctx(), CASE_ID, { scheduledAt: "2026-08-01T10:00:00Z", purpose: "arguments" });
    expect(result.accepted).toBe(true);
    expect(result.hearingId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("adjournHearing validates + publishes", async () => {
    const { adjournHearing } = await import("../src/modules/hearing/commands.js");
    const result = await adjournHearing(ctx(), HEARING_ID, { reason: "Advocate unavailable", nextDate: "2026-08-15", expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("recordHearingOutcome validates + publishes", async () => {
    const { recordHearingOutcome } = await import("../src/modules/hearing/commands.js");
    const result = await recordHearingOutcome(ctx(), HEARING_ID, { outcome: "held", expectedVersion: 2 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("filing commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("submitFiling validates + publishes", async () => {
    const { submitFiling } = await import("../src/modules/filing/commands.js");
    const result = await submitFiling(ctx(), CASE_ID, { filingType: "petition", filingFeeMinor: 500, courtFeeMinor: 200 });
    expect(result.accepted).toBe(true);
    expect(result.filingId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("order commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("recordOrder validates + publishes", async () => {
    const { recordOrder } = await import("../src/modules/order/commands.js");
    const result = await recordOrder(ctx(), CASE_ID, { orderType: "interim", orderText: "Stay granted" });
    expect(result.accepted).toBe(true);
    expect(result.orderId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("cause-list commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("createCauseList validates + publishes", async () => {
    const { createCauseList } = await import("../src/modules/cause-list/commands.js");
    const result = await createCauseList(ctx(), { courtId: COURT_ID, listDate: "2026-08-01" });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("listCaseOnCauseList validates + publishes", async () => {
    const { listCaseOnCauseList } = await import("../src/modules/cause-list/commands.js");
    const causeListId = randomUUID();
    const result = await listCaseOnCauseList(ctx(), causeListId, { caseId: CASE_ID, itemNumber: 1, slot: "10:30", courtroom: "Court 1" });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("scrutiny commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("recordScrutiny validates + publishes", async () => {
    const { recordScrutiny } = await import("../src/modules/scrutiny/commands.js");
    const result = await recordScrutiny(ctx(), CASE_ID, { caseId: CASE_ID, status: "cleared" });
    expect(result.accepted).toBe(true);
    expect(result.scrutinyId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("raiseDefect validates + publishes", async () => {
    const { raiseDefect } = await import("../src/modules/scrutiny/commands.js");
    const result = await raiseDefect(ctx(), CASE_ID, { caseId: CASE_ID, category: "missing_signature", description: "Signature page absent" });
    expect(result.accepted).toBe(true);
    expect(result.defectId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("resolveDefect validates + publishes", async () => {
    const { resolveDefect } = await import("../src/modules/scrutiny/commands.js");
    const result = await resolveDefect(ctx(), DEFECT_ID, { resolution: "rectified", expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("resolveScrutiny validates + publishes", async () => {
    const { resolveScrutiny } = await import("../src/modules/scrutiny/commands.js");
    const result = await resolveScrutiny(ctx(), SCRUTINY_ID, { status: "cleared", expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("notice commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("issueNotice validates + publishes", async () => {
    const { issueNotice } = await import("../src/modules/notice/commands.js");
    const result = await issueNotice(ctx(), CASE_ID, { caseId: CASE_ID, noticeType: "summons", issuedTo: "Respondent", issueDate: "2026-08-01" });
    expect(result.accepted).toBe(true);
    expect(result.noticeId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("recordService validates + publishes", async () => {
    const { recordService } = await import("../src/modules/notice/commands.js");
    const result = await recordService(ctx(), NOTICE_ID, { serviceMode: "personal" });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("updateNoticeStatus validates + publishes", async () => {
    const { updateNoticeStatus } = await import("../src/modules/notice/commands.js");
    const result = await updateNoticeStatus(ctx(), NOTICE_ID, { status: "served", expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("compliance commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("createDirection validates + publishes", async () => {
    const { createDirection } = await import("../src/modules/compliance/commands.js");
    const result = await createDirection(ctx(), CASE_ID, { caseId: CASE_ID, direction: "Submit within 30 days", dueDate: "2026-09-01" });
    expect(result.accepted).toBe(true);
    expect(result.directionId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("updateCompliance validates + publishes", async () => {
    const { updateCompliance } = await import("../src/modules/compliance/commands.js");
    const directionId = randomUUID();
    const result = await updateCompliance(ctx(), directionId, { status: "completed", expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("appeal commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("fileAppeal validates + publishes", async () => {
    const { fileAppeal } = await import("../src/modules/appeal/commands.js");
    const result = await fileAppeal(ctx(), { originalCaseId: CASE_ID, appealType: "appeal", grounds: "Error of law", filedDate: "2026-09-01" });
    expect(result.accepted).toBe(true);
    expect(result.appealId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("registerAppeal validates + publishes", async () => {
    const { registerAppeal } = await import("../src/modules/appeal/commands.js");
    const result = await registerAppeal(ctx(), APPEAL_ID, { expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("decideAppeal validates + publishes", async () => {
    const { decideAppeal } = await import("../src/modules/appeal/commands.js");
    const result = await decideAppeal(ctx(), APPEAL_ID, { decision: "allowed", decisionSummary: "Reasoned order", decidedDate: "2026-10-01", expectedVersion: 2 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("withdrawAppeal validates + publishes", async () => {
    const { withdrawAppeal } = await import("../src/modules/appeal/commands.js");
    const result = await withdrawAppeal(ctx(), APPEAL_ID, { expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("party commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("addParty validates + publishes", async () => {
    const { addParty } = await import("../src/modules/party/commands.js");
    const result = await addParty(ctx(), CASE_ID, { partyRole: "petitioner", name: "A. Rao" });
    expect(result.accepted).toBe(true);
    expect(result.partyId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("updateAdvocate validates + publishes", async () => {
    const { updateAdvocate } = await import("../src/modules/party/commands.js");
    const result = await updateAdvocate(ctx(), PARTY_ID, { advocateName: "Adv. Sharma", advocateBarId: "DL/1234/2020", expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("evidence commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("submitEvidence validates + publishes", async () => {
    const { submitEvidence } = await import("../src/modules/evidence/commands.js");
    const result = await submitEvidence(ctx(), CASE_ID, { caseId: CASE_ID, title: "Sale deed" });
    expect(result.accepted).toBe(true);
    expect(result.evidenceId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("ruleOnEvidence validates + publishes", async () => {
    const { ruleOnEvidence } = await import("../src/modules/evidence/commands.js");
    const result = await ruleOnEvidence(ctx(), EVIDENCE_ID, { ruling: "admitted", expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("order-issuance commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("submitForApproval validates + publishes", async () => {
    const { submitForApproval } = await import("../src/modules/order-issuance/commands.js");
    const result = await submitForApproval(ctx(), ORDER_ID, { expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("approveAndIssue validates + publishes", async () => {
    const { approveAndIssue } = await import("../src/modules/order-issuance/commands.js");
    const result = await approveAndIssue(ctx(), ORDER_ID, { dscSignature: "ABCDEF1234567890", expectedVersion: 2 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("sendBack validates + publishes", async () => {
    const { sendBack } = await import("../src/modules/order-issuance/commands.js");
    const result = await sendBack(ctx(), ORDER_ID, { remarks: "Needs revision", expectedVersion: 2 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("recall validates + publishes", async () => {
    const { recall } = await import("../src/modules/order-issuance/commands.js");
    const result = await recall(ctx(), ORDER_ID, { recallReason: "Clerical error", expectedVersion: 3 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("config-registry commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("setConfig validates + publishes", async () => {
    const { setConfig } = await import("../src/modules/config-registry/commands.js");
    const result = await setConfig(ctx(), { namespace: "court_defaults", configKey: "max_adjournments", value: "5" });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("deactivateConfig validates + publishes", async () => {
    const { deactivateConfig } = await import("../src/modules/config-registry/commands.js");
    const result = await deactivateConfig(ctx(), CONFIG_ID, { expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("certified-copy commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("requestCopy validates + publishes", async () => {
    const { requestCopy } = await import("../src/modules/certified-copy/commands.js");
    const result = await requestCopy(ctx(), CASE_ID, { caseId: CASE_ID, orderId: ORDER_ID });
    expect(result.accepted).toBe(true);
    expect(result.copyId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("transitionCopy validates + publishes", async () => {
    const { transitionCopy } = await import("../src/modules/certified-copy/commands.js");
    const result = await transitionCopy(ctx(), COPY_ID, { target: "issued", expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("case-parcel commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("addParcel validates + publishes", async () => {
    const { addParcel } = await import("../src/modules/case-parcel/commands.js");
    const result = await addParcel(ctx(), CASE_ID, { surveyNumber: "123/A", village: "Saket", district: "Delhi" });
    expect(result.accepted).toBe(true);
    expect(result.parcelId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("updateParcel validates + publishes", async () => {
    const { updateParcel } = await import("../src/modules/case-parcel/commands.js");
    const result = await updateParcel(ctx(), PARCEL_ID, { areaSqm: 300, expectedVersion: 1 });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

describe("public-lookup commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("publishEstablishment validates + publishes", async () => {
    const { publishEstablishment } = await import("../src/modules/public-lookup/commands.js");
    const result = await publishEstablishment(ctx(), { establishmentCode: "DLHC01", courtName: "Delhi HC", publicSlug: "delhi-hc" });
    expect(result.accepted).toBe(true);
    expect(result.establishmentId).toBeDefined();
    expect(result.publicSlug).toBe("delhi-hc");
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("publishEstablishment with accessMode fan-out publishes twice", async () => {
    const { publishEstablishment } = await import("../src/modules/public-lookup/commands.js");
    const result = await publishEstablishment(ctx(), { establishmentCode: "DLHC02", courtName: "Delhi HC 2", publicSlug: "delhi-hc-2", accessMode: "captcha" });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(2);
  });
});

describe("court-registry commands", () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it("createCourt validates + publishes", async () => {
    const { createCourt } = await import("../src/modules/court-registry/commands.js");
    const result = await createCourt(ctx(), { name: "Delhi HC", courtType: "high_court", jurisdiction: "Delhi" });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("createBench validates + publishes", async () => {
    const { createBench } = await import("../src/modules/court-registry/commands.js");
    const result = await createBench(ctx(), COURT_ID, { name: "Bench A", benchType: "single" });
    expect(result.accepted).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});
