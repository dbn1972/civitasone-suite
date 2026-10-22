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

  it("advanceStage throws a clerk-safe message on a 422 KYC-gate rejection, never the server's raw code/message (UX-020)", async () => {
    // UX-020: this test used to assert the opposite — that the raw
    // "KYC_NOT_VERIFIED: onboarding cannot be completed..." text was shown
    // verbatim, on the theory that a silently-swallowed error is worse than
    // a raw one. errorMessageFromResponse (apps/web/src/lib/api/
    // browserClient.ts) now closes that same gap the way useFormError
    // already does elsewhere: a clerk-safe catalogued message, still never
    // silent, never the raw code/message. See docs/ENTERPRISE-GAP-REPORT-
    // 2026-09-07.md UX-020.
    fetchMock.mockResolvedValue(
      res(
        { code: "KYC_NOT_VERIFIED", message: "onboarding cannot be completed while KYC is 'submitted' — it must be 'verified'" },
        { status: 422 },
      ),
    );
    await expect(onb.advanceStage("c1", { toStage: "completed" })).rejects.toThrow("Some details weren't accepted. Check what you entered and try again.");
    await expect(onb.advanceStage("c1", { toStage: "completed" })).rejects.not.toThrow(
      /KYC_NOT_VERIFIED|must be 'verified'/,
    );
  });

  it("advanceStage throws a clerk-safe message on a 422 INVALID_TRANSITION rejection, never the raw allowed-set text (UX-020)", async () => {
    fetchMock.mockResolvedValue(
      res({ code: "INVALID_TRANSITION", message: "cannot move from 'initiated' to 'completed' (allowed: documents_submitted, cancelled)" }, { status: 422 }),
    );
    await expect(onb.advanceStage("c1", { toStage: "completed" })).rejects.toThrow("Some details weren't accepted. Check what you entered and try again.");
    await expect(onb.advanceStage("c1", { toStage: "completed" })).rejects.not.toThrow(
      /INVALID_TRANSITION|allowed: documents_submitted/,
    );
  });

  it("recordKyc returns accepted on 202 and throws a clerk-safe message on a 422 INVALID_KYC_TRANSITION, never the raw code (UX-020)", async () => {
    fetchMock.mockResolvedValueOnce(res({ accepted: true }, { status: 202 }));
    const r = await onb.recordKyc("c1", { status: "verified", reference: "REF-9", version: 2 });
    expect(r.accepted).toBe(true);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      status: "verified",
      reference: "REF-9",
      version: 2,
    });
    fetchMock.mockResolvedValue(
      res({ code: "INVALID_KYC_TRANSITION", message: "cannot move KYC from 'verified' to 'submitted' (allowed: )" }, { status: 422 }),
    );
    await expect(onb.recordKyc("c1", { status: "submitted" })).rejects.toThrow("Some details weren't accepted. Check what you entered and try again.");
    await expect(onb.recordKyc("c1", { status: "submitted" })).rejects.not.toThrow(/INVALID_KYC_TRANSITION/);
  });

  // GAP-CRM-ONBOARDING-01 — deal/account name resolution for the list.
  it("getOnboardingLookups degrades to empty maps when a lookup fails (names left to resolve to null)", async () => {
    fetchMock.mockResolvedValueOnce(res({}, { status: 500 })).mockRejectedValueOnce(new Error("network"));
    const lk = await onb.getOnboardingLookups([{ dealId: "d1", accountId: "a1" }]);
    expect(lk.dealNames).toEqual({});
    expect(lk.accountNames).toEqual({});
  });

  // Efficiency (rework): naming cases must not page the whole accounts list.
  it("getOnboardingLookups(cases) names accounts AND deals by id, one request each (no list paging)", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/v1/crm/deals")) return res({ data: [{ id: "d1", name: "Acme renewal" }], pagination: { total: 1 } });
      if (url.pathname.endsWith("/v1/crm/accounts")) return res({ data: [{ id: "a1", name: "Acme Corp" }] });
      return res({}, { status: 404 });
    });
    const lk = await onb.getOnboardingLookups([{ dealId: "d1", accountId: "a1" }, { dealId: "d1", accountId: "gone" }, { dealId: "d-deleted", accountId: null }]);
    expect(lk).toEqual({ dealNames: { d1: "Acme renewal" }, accountNames: { a1: "Acme Corp" } });
    const callsTo = (suffix: string) => fetchMock.mock.calls.map((c) => new URL(String(c[0]), "http://localhost")).filter((u) => u.pathname.endsWith(suffix));
    const accountCalls = callsTo("/v1/crm/accounts");
    expect(accountCalls).toHaveLength(1); // the unknown account "gone" did not force a walk of the list
    expect(accountCalls[0]!.searchParams.get("ids")).toBe("a1,gone");
    expect(accountCalls[0]!.searchParams.has("offset")).toBe(false);
    const dealCalls = callsTo("/v1/crm/deals");
    expect(dealCalls).toHaveLength(1); // the deleted deal "d-deleted" did not force a walk of the list either
    expect(dealCalls[0]!.searchParams.get("ids")).toBe("d1,d-deleted");
    expect(dealCalls[0]!.searchParams.has("offset")).toBe(false);
  });

  it("getOnboardingCaseLookups names ONE case with the deal by id and the account by id - two requests, no list paging", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/v1/crm/deals/d1")) return res({ id: "d1", name: "Acme renewal", stage: "Won" });
      if (url.pathname.endsWith("/v1/crm/accounts")) return res({ data: [{ id: "a1", name: "Acme Corp" }] });
      return res({}, { status: 404 });
    });
    const r = await onb.getOnboardingCaseLookups({ dealId: "d1", accountId: "a1" });
    expect(r).toEqual({ lookups: { dealNames: { d1: "Acme renewal" }, accountNames: { a1: "Acme Corp" } }, complete: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => new URL(String(c[0]), "http://localhost"));
    expect(urls.some((u) => u.pathname.endsWith("/v1/crm/deals/d1"))).toBe(true);
    expect(urls.some((u) => u.pathname.endsWith("/v1/crm/deals"))).toBe(false); // the deals LIST is never read
    expect(urls.every((u) => !u.searchParams.has("offset"))).toBe(true);
  });

  it("getOnboardingCaseLookups: a deleted deal (404) and an inactive account are definitive - unnamed, complete", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.includes("/v1/crm/deals/")) return res({ code: "NOT_FOUND" }, { status: 404 });
      return res({ data: [] });
    });
    expect(await onb.getOnboardingCaseLookups({ dealId: "d9", accountId: "a9" })).toEqual({
      lookups: { dealNames: {}, accountNames: {} },
      complete: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("getOnboardingCaseLookups: a failed request is reported as incomplete, keeping what the other request found", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.includes("/v1/crm/deals/")) return res({}, { status: 500 });
      return res({ data: [{ id: "a1", name: "Acme Corp" }] });
    });
    expect(await onb.getOnboardingCaseLookups({ dealId: "d1", accountId: "a1" })).toEqual({
      lookups: { dealNames: {}, accountNames: { a1: "Acme Corp" } },
      complete: false,
    });
  });

  it("getOnboardingCaseLookups skips the request for an id the case does not have", async () => {
    fetchMock.mockResolvedValue(res({ id: "d1", name: "Acme renewal" }));
    const r = await onb.getOnboardingCaseLookups({ dealId: "d1", accountId: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.lookups.dealNames).toEqual({ d1: "Acme renewal" });
    expect(r.complete).toBe(true);
  });

  it("resolveCaseNames fills deal/account names and never leaves a UUID as a name", () => {
    const base = {
      id: "c1", dealId: "d1", accountId: "a1", stage: "verification", kycStatus: "submitted",
      kycReference: null, kycVerifiedAt: null, completedAt: null, cancellationReason: null,
      createdAt: "", updatedAt: "", version: 1, accountName: null, dealName: null,
    } as onb.OnboardingCase;
    const [resolved] = onb.resolveCaseNames([base], {
      dealNames: { d1: "Acme renewal" },
      accountNames: { a1: "Acme Corp" },
    });
    expect(resolved.dealName).toBe("Acme renewal");
    expect(resolved.accountName).toBe("Acme Corp");

    // An unknown id resolves to null (the UI then shows a label, never the id).
    const [unresolved] = onb.resolveCaseNames([base], { dealNames: {}, accountNames: {} });
    expect(unresolved.dealName).toBeNull();
    expect(unresolved.accountName).toBeNull();
  });
});

// GAP-CRM-ONBOARDING-01 / -DETAIL-01 (W2 crm cluster 07): the deal/account lookup must
// respect the server's page cap. GET /v1/crm/accounts caps `limit` at 200 and answers a
// larger one with a 400, so the old `?limit=500` lookup never resolved a single account
// name in practice. The lookup now pages with the real page size until it has found the
// deals/accounts of the cases being labelled.
describe("getOnboardingLookups pages within the server cap (GAP-CRM-ONBOARDING-01)", () => {
  const filler = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}` }));
  const wanted = [{ dealId: "d-wanted", accountId: "a-wanted" }];

  /** Serve `deals`/`accounts` by their `offset`, like the real list routes. */
  function serve(deals: Array<{ id: string; name: string }>, accounts: Array<{ id: string; name: string }>) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      if (limit > 200) return res({ code: "VALIDATION_FAILED" }, { status: 400 }); // the real accounts cap
      const ids = url.searchParams.get("ids")?.split(","); // GET /v1/crm/accounts?ids= (lookup of known ids)
      const all = (url.pathname.endsWith("/accounts") ? accounts : deals).filter((r) => !ids || ids.includes(r.id));
      return res({ data: all.slice(offset, offset + limit), meta: { total: all.length } });
    });
  }
  const urlsFor = (suffix: string) =>
    fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => new URL(u, "http://localhost").pathname.endsWith(suffix));

  it("never asks for more than 200 rows a page, so the accounts endpoint no longer 400s", async () => {
    serve([{ id: "d-wanted", name: "Acme renewal" }], [{ id: "a-wanted", name: "Acme Corp" }]);
    const lk = await onb.getOnboardingLookups(wanted);
    expect(lk).toEqual({ dealNames: { "d-wanted": "Acme renewal" }, accountNames: { "a-wanted": "Acme Corp" } });
    for (const u of fetchMock.mock.calls.map((c) => String(c[0]))) expect(u).not.toMatch(/limit=(?:[3-9]\d\d|\d{4,})/);
  });

  it("finds an account deep in the list with one lookup by id, not by paging to it", async () => {
    serve([{ id: "d-wanted", name: "Acme renewal" }], [...filler("other", 450), { id: "a-wanted", name: "Acme Corp" }]);
    const lk = await onb.getOnboardingLookups(wanted);
    expect(lk.accountNames["a-wanted"]).toBe("Acme Corp");
    const calls = urlsFor("/accounts").map((u) => new URL(u, "http://localhost").searchParams);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.get("ids")).toBe("a-wanted");
    expect(calls[0]!.has("offset")).toBe(false);
  });

  it("an account that is inactive or missing costs the same single lookup (it never walks the whole list)", async () => {
    serve([{ id: "d-wanted", name: "Acme renewal" }], filler("other", 450));
    const lk = await onb.getOnboardingLookups(wanted);
    expect(lk.accountNames).toEqual({});
    expect(urlsFor("/accounts")).toHaveLength(1);
  });

  it("finds a deal deep in the list with one lookup by id, wherever it sits (no paging to reach it)", async () => {
    serve(filler("d", 450).concat([{ id: "d-wanted", name: "Acme renewal" }]), [{ id: "a-wanted", name: "Acme Corp" }]);
    // d-wanted is the very last of 451 deals; the old lookup needed all three pages for it.
    const lk = await onb.getOnboardingLookups(wanted);
    expect(lk.dealNames["d-wanted"]).toBe("Acme renewal");
    const calls = urlsFor("/deals").map((u) => new URL(u, "http://localhost").searchParams);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.get("ids")).toBe("d-wanted");
    expect(calls[0]!.has("offset")).toBe(false);
    expect(urlsFor("/accounts")).toHaveLength(1);
  });

  it("a deal that is deleted, cancelled or missing costs the same single lookup (it never walks the whole list)", async () => {
    // Deleted and cancelled deals are never listed, so d-wanted is absent from the 450 deals served.
    serve(filler("d", 450), [{ id: "a-wanted", name: "Acme Corp" }]);
    const lk = await onb.getOnboardingLookups(wanted);
    expect(lk.dealNames).toEqual({});
    expect(lk.accountNames).toEqual({ "a-wanted": "Acme Corp" });
    expect(urlsFor("/deals")).toHaveLength(1);
  });

  it("looks a long list of deals up 50 ids to a request", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `d-${i}`, name: `Deal ${i}` }));
    serve(many, []);
    const lk = await onb.getOnboardingLookups(many.map((d) => ({ dealId: d.id, accountId: null })));
    expect(Object.keys(lk.dealNames)).toHaveLength(120);
    expect(urlsFor("/deals")).toHaveLength(3); // 50 + 50 + 20
  });

  it("does not fetch a list at all when no case references it", async () => {
    serve([], []);
    const lk = await onb.getOnboardingLookups([{ dealId: "", accountId: null }]);
    expect(lk).toEqual({ dealNames: {}, accountNames: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the name unresolved (null, never a UUID) when the account cannot be found", async () => {
    serve([{ id: "d-wanted", name: "Acme renewal" }], filler("other", 3));
    const lk = await onb.getOnboardingLookups(wanted);
    const [c] = onb.resolveCaseNames(
      [{ id: "c1", dealId: "d-wanted", accountId: "a-wanted", stage: "initiated", kycStatus: "pending", kycReference: null, kycVerifiedAt: null, completedAt: null, cancellationReason: null, createdAt: "", updatedAt: "", version: 1, accountName: null, dealName: null }],
      lk,
    );
    expect(c!.dealName).toBe("Acme renewal");
    expect(c!.accountName).toBeNull();
  });
});

describe("onboarding display helpers (GAP-CRM-ONBOARDING-DETAIL-01 / -05)", () => {
  it("shortRef shows only the first 8 characters, and a dash for a missing id", () => {
    expect(onb.shortRef("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe("3fa85f64");
    expect(onb.shortRef(null)).toBe("—");
    expect(onb.shortRef("")).toBe("—");
  });

  it("isMaskedKycReference recognises only the server-masked shape", () => {
    expect(onb.isMaskedKycReference("••••7890")).toBe(true);
    expect(onb.isMaskedKycReference("••••")).toBe(true);
    expect(onb.isMaskedKycReference("KYCPROV-ABCD1234")).toBe(false);
    expect(onb.isMaskedKycReference(null)).toBe(false);
  });
});
