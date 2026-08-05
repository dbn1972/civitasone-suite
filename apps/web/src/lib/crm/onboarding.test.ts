import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as onb from "./onboarding";

/** Stub global fetch to exercise the browserFetch-backed loaders/mutations. */
function res(body: unknown, init: { status?: number } = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("onboarding state machine (mirror of BE domain.ts)", () => {
  it("exposes the exact stage + KYC enums", () => {
    expect(onb.ONBOARDING_STAGES).toEqual([
      "initiated",
      "documents_submitted",
      "verification",
      "provisioning",
      "completed",
      "cancelled",
    ]);
    expect(onb.KYC_STATUSES).toEqual(["pending", "submitted", "verified", "rejected"]);
    expect(onb.CANCELLATION_REASON_MIN_LENGTH).toBe(10);
  });

  it("allowedNextStages matches the sequence, with cancelled reachable from every live stage", () => {
    expect(onb.allowedNextStages("initiated")).toEqual(["documents_submitted", "cancelled"]);
    expect(onb.allowedNextStages("documents_submitted")).toEqual(["verification", "cancelled"]);
    expect(onb.allowedNextStages("verification")).toEqual(["provisioning", "cancelled"]);
    expect(onb.allowedNextStages("provisioning")).toEqual(["completed", "cancelled"]);
    expect(onb.allowedNextStages("completed")).toEqual([]);
    expect(onb.allowedNextStages("cancelled")).toEqual([]);
  });

  it("canTransition / isTerminalStage agree with the table", () => {
    expect(onb.canTransition("initiated", "documents_submitted")).toBe(true);
    expect(onb.canTransition("initiated", "verification")).toBe(false);
    expect(onb.canTransition("provisioning", "completed")).toBe(true);
    expect(onb.isTerminalStage("completed")).toBe(true);
    expect(onb.isTerminalStage("cancelled")).toBe(true);
    expect(onb.isTerminalStage("initiated")).toBe(false);
  });

  it("KYC lifecycle: rejected loops back to submitted, verified is terminal", () => {
    expect(onb.allowedNextKycStatuses("pending")).toEqual(["submitted"]);
    expect(onb.allowedNextKycStatuses("submitted")).toEqual(["verified", "rejected"]);
    expect(onb.allowedNextKycStatuses("rejected")).toEqual(["submitted"]);
    expect(onb.allowedNextKycStatuses("verified")).toEqual([]);
    expect(onb.canKycTransition("submitted", "verified")).toBe(true);
    expect(onb.canKycTransition("verified", "submitted")).toBe(false);
  });

  it("the KYC gate only guards completion, and only 'verified' satisfies it", () => {
    expect(onb.requiresKycVerification("completed")).toBe(true);
    expect(onb.requiresKycVerification("provisioning")).toBe(false);
    expect(onb.requiresKycVerification("cancelled")).toBe(false);
    expect(onb.isKycSatisfied("verified")).toBe(true);
    expect(onb.isKycSatisfied("submitted")).toBe(false);
    expect(onb.isKycGateSatisfied("completed", "verified")).toBe(true);
    expect(onb.isKycGateSatisfied("completed", "submitted")).toBe(false);
    expect(onb.isKycGateSatisfied("cancelled", "pending")).toBe(true);
  });

  it("cancellation-reason rule mirrors the 10-char minimum", () => {
    expect(onb.requiresCancellationReason("cancelled")).toBe(true);
    expect(onb.requiresCancellationReason("completed")).toBe(false);
    expect(onb.isValidCancellationReason("too short")).toBe(false);
    expect(onb.isValidCancellationReason("   short  ")).toBe(false);
    expect(onb.isValidCancellationReason("a valid explanation")).toBe(true);
    expect(onb.isValidCancellationReason(null)).toBe(false);
  });

  it("nextStageOptions marks the KYC-gated completion blocked until KYC verified", () => {
    const blocked = onb.nextStageOptions("provisioning", "submitted");
    const completed = blocked.find((o) => o.stage === "completed");
    expect(completed).toMatchObject({ requiresKyc: true, kycBlocked: true });
    const cancel = blocked.find((o) => o.stage === "cancelled");
    expect(cancel).toMatchObject({ requiresKyc: false, kycBlocked: false, requiresReason: true });

    const unblocked = onb.nextStageOptions("provisioning", "verified");
    expect(unblocked.find((o) => o.stage === "completed")).toMatchObject({ kycBlocked: false });

    // A non-gated stage is never blocked regardless of KYC.
    const early = onb.nextStageOptions("initiated", "pending");
    expect(early.every((o) => !o.kycBlocked)).toBe(true);
  });

  it("type guards + label/meta helpers tolerate unknown values", () => {
    expect(onb.isOnboardingStage("verification")).toBe(true);
    expect(onb.isOnboardingStage("bogus")).toBe(false);
    expect(onb.isKycStatus("verified")).toBe(true);
    expect(onb.isKycStatus("bogus")).toBe(false);
    expect(onb.stageLabel("documents_submitted")).toBe("Documents submitted");
    expect(onb.stageLabel("weird_stage")).toBe("weird_stage");
    expect(onb.kycLabel("verified")).toBe("Verified");
    expect(onb.kycLabel("weird")).toBe("weird");
    // meta maps cover every enum member
    for (const s of onb.ONBOARDING_STAGES) expect(onb.STAGE_META[s].icon).toBeTruthy();
    for (const k of onb.KYC_STATUSES) expect(onb.KYC_META[k].icon).toBeTruthy();
  });
});

describe("onboarding normalisers", () => {
  const row = {
    id: "c1",
    dealId: "d1",
    accountId: "a1",
    stage: "verification",
    kycStatus: "submitted",
    kycReference: "REF-1",
    kycVerifiedAt: null,
    completedAt: null,
    cancellationReason: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    version: 3,
  };

  it("normaliseCase maps fields and drops rows without an id", () => {
    expect(onb.normaliseCase(row)).toMatchObject({ id: "c1", stage: "verification", version: 3 });
    expect(onb.normaliseCase({ ...row, id: "" })).toBeNull();
    expect(onb.normaliseCase(null)).toBeNull();
    // nullable account/reference collapse empty strings to null
    expect(onb.normaliseCase({ ...row, accountId: "", kycReference: "" })).toMatchObject({
      accountId: null,
      kycReference: null,
    });
  });

  it("normaliseCases accepts the { data } envelope AND a bare array", () => {
    expect(onb.normaliseCases({ data: [row], meta: {} })).toHaveLength(1);
    expect(onb.normaliseCases([row, { ...row, id: "c2" }])).toHaveLength(2);
    expect(onb.normaliseCases({ items: [row] })).toHaveLength(1);
    expect(onb.normaliseCases("nope")).toEqual([]);
  });
});

describe("onboarding HTTP client", () => {
  it("getOnboardingCases builds the stage filter query and flags error on !ok / throw", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [{ id: "c1", stage: "initiated" }] }));
    const ok = await onb.getOnboardingCases({ stage: "initiated", accountId: "a1" });
    expect(ok.source).toBe("api");
    expect(ok.data).toHaveLength(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("stage=initiated");
    expect(url).toContain("accountId=a1");

    fetchMock.mockResolvedValueOnce(res({}, { status: 500 }));
    expect((await onb.getOnboardingCases()).source).toBe("error");
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await onb.getOnboardingCases()).source).toBe("error");
  });

  it("getOnboardingCase maps one row, flags error on !ok / throw", async () => {
    fetchMock.mockResolvedValueOnce(res({ id: "c1", stage: "verification", version: 2 }));
    const ok = await onb.getOnboardingCase("c1");
    expect(ok.source).toBe("api");
    expect(ok.data?.id).toBe("c1");
    // A genuine 404 is distinguished as not-found (case does not exist / removed),
    // not a generic outage.
    fetchMock.mockResolvedValueOnce(res({}, { status: 404 }));
    const notFound = await onb.getOnboardingCase("c1");
    expect(notFound.source).toBe("not-found");
    expect(notFound.data).toBeNull();
    // A real outage (500) is still a generic error, not not-found.
    fetchMock.mockResolvedValueOnce(res({}, { status: 500 }));
    const err = await onb.getOnboardingCase("c1");
    expect(err.source).toBe("error");
    expect(err.data).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await onb.getOnboardingCase("c1")).source).toBe("error");
  });

  it("advanceStage returns accepted=true on 202 and sends toStage/reason/version", async () => {
    fetchMock.mockResolvedValueOnce(res({ accepted: true }, { status: 202 }));
    const r = await onb.advanceStage("c1", { toStage: "cancelled", reason: "customer withdrew", version: 4 });
    expect(r.accepted).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      toStage: "cancelled",
      reason: "customer withdrew",
      version: 4,
    });
  });

  it("advanceStage surfaces the 422 KYC-gate reason verbatim (never swallowed)", async () => {
    fetchMock.mockResolvedValueOnce(
      res(
        { code: "KYC_NOT_VERIFIED", message: "onboarding cannot be completed while KYC is 'submitted' — it must be 'verified'" },
        { status: 422 },
      ),
    );
    await expect(onb.advanceStage("c1", { toStage: "completed" })).rejects.toThrow(/KYC_NOT_VERIFIED/);
  });

  it("advanceStage surfaces the 422 INVALID_TRANSITION allowed-set reason", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ code: "INVALID_TRANSITION", message: "cannot move from 'initiated' to 'completed' (allowed: documents_submitted, cancelled)" }, { status: 422 }),
    );
    await expect(onb.advanceStage("c1", { toStage: "completed" })).rejects.toThrow(/allowed: documents_submitted/);
  });

  it("recordKyc returns accepted on 202 and surfaces a 422 INVALID_KYC_TRANSITION", async () => {
    fetchMock.mockResolvedValueOnce(res({ accepted: true }, { status: 202 }));
    const r = await onb.recordKyc("c1", { status: "verified", reference: "REF-9", version: 2 });
    expect(r.accepted).toBe(true);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      status: "verified",
      reference: "REF-9",
      version: 2,
    });
    fetchMock.mockResolvedValueOnce(
      res({ code: "INVALID_KYC_TRANSITION", message: "cannot move KYC from 'verified' to 'submitted' (allowed: )" }, { status: 422 }),
    );
    await expect(onb.recordKyc("c1", { status: "submitted" })).rejects.toThrow(/INVALID_KYC_TRANSITION/);
  });
});
