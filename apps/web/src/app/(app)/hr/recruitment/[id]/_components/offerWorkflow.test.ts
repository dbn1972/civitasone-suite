import { describe, it, expect } from "vitest";
import { activeOffer, buildOfferPayload, offerActions, EMPTY_OFFER_FORM, type OfferView } from "./offerWorkflow";

const CHAIN = [{ stage: "HR", role: "hr_admin" }, { stage: "Finance", role: "finance_officer" }, { stage: "Legal", role: "legal_officer" }, { stage: "Competent Authority", role: "competent_authority" }];
const offer = (over: Partial<OfferView> = {}): OfferView => ({
  id: "o1", offerNo: "OFR-1", offerVersion: 1, status: "draft", basicMinor: "5610000", joiningBonusMinor: "0", relocationMinor: "0", variablePayMinor: "0",
  grossCtcMinor: "5610000", grade: null, payLevel: null, payCell: null, joiningDate: null, approvalChain: CHAIN, currentStage: -1, createdBy: "maker", ...over,
});

describe("activeOffer", () => {
  it("is the newest live offer; terminal versions are skipped", () => {
    const v3 = offer({ id: "o3", offerVersion: 3, status: "declined" });
    const v2 = offer({ id: "o2", offerVersion: 2, status: "pending_approval", currentStage: 1 });
    const v1 = offer({ id: "o1", offerVersion: 1, status: "revised" });
    expect(activeOffer([v3, v2, v1])?.id).toBe("o2");
    expect(activeOffer([v3, v1])).toBeNull();
    expect(activeOffer([])).toBeNull();
  });
});

describe("offerActions (the service stays the authority; these only choose which buttons to show)", () => {
  const hr = { userId: "maker", roles: ["hr_officer"] };
  it("a draft or returned offer can be submitted by HR only", () => {
    expect(offerActions(offer(), hr).canSubmit).toBe(true);
    expect(offerActions(offer({ status: "returned" }), hr).canSubmit).toBe(true);
    expect(offerActions(offer(), { userId: "x", roles: ["employee"] }).canSubmit).toBe(false);
  });
  it("pending: only the current stage's role can approve, and never the creator", () => {
    const pending = offer({ status: "pending_approval", currentStage: 1 });
    const fin = offerActions(pending, { userId: "checker", roles: ["finance_officer"] });
    expect(fin).toMatchObject({ canApprove: true, canReturn: true, awaitingRole: "finance_officer", awaitingStage: "Finance", approveBlockedReason: null });
    const wrongRole = offerActions(pending, { userId: "checker", roles: ["legal_officer"] });
    expect(wrongRole).toMatchObject({ canApprove: false, canReturn: false, approveBlockedReason: "role" });
    const creatorIsApprover = offerActions(pending, { userId: "maker", roles: ["finance_officer"] });
    expect(creatorIsApprover).toMatchObject({ canApprove: false, approveBlockedReason: "creator" });
    expect(offerActions(pending, { userId: "root", roles: ["super_admin"] }).canApprove).toBe(true);
  });
  it("approved can be released by HR; released/terminal offers offer nothing", () => {
    expect(offerActions(offer({ status: "approved" }), hr).canRelease).toBe(true);
    const released = offerActions(offer({ status: "released" }), hr);
    expect(released).toMatchObject({ canSubmit: false, canApprove: false, canRelease: false });
  });
});

describe("buildOfferPayload", () => {
  const f = (over: Partial<typeof EMPTY_OFFER_FORM>) => ({ ...EMPTY_OFFER_FORM, ...over });
  it("converts rupees to paise exactly: '56100.5' -> 5610050", () => {
    const r = buildOfferPayload(f({ basic: "56100.5" }));
    expect(r).toEqual({ ok: true, payload: { basicMinor: 5610050 } });
  });
  it("rejects sub-paise, zero and empty basic pay", () => {
    expect(buildOfferPayload(f({ basic: "1.005" }))).toEqual({ ok: false, error: "basic" });
    expect(buildOfferPayload(f({ basic: "0" }))).toEqual({ ok: false, error: "basic" });
    expect(buildOfferPayload(f({ basic: "" }))).toEqual({ ok: false, error: "basic" });
  });
  it("accepts optional components (zero allowed) and rejects a bad one", () => {
    expect(buildOfferPayload(f({ basic: "50000", joiningBonus: "1000", relocation: "0" }))).toEqual({ ok: true, payload: { basicMinor: 5000000, joiningBonusMinor: 100000, relocationMinor: 0 } });
    expect(buildOfferPayload(f({ basic: "50000", variablePay: "1.234" }))).toEqual({ ok: false, error: "amount" });
  });
  it("pay level and cell go together, within 1-18 / 1-40", () => {
    expect(buildOfferPayload(f({ basic: "56100", payLevel: "10", payCell: "3" }))).toEqual({ ok: true, payload: { basicMinor: 5610000, payLevel: 10, payCell: 3 } });
    expect(buildOfferPayload(f({ basic: "56100", payLevel: "10" }))).toEqual({ ok: false, error: "payLevelCell" });
    expect(buildOfferPayload(f({ basic: "56100", payLevel: "19", payCell: "1" }))).toEqual({ ok: false, error: "payLevelCell" });
    expect(buildOfferPayload(f({ basic: "56100", payLevel: "3", payCell: "41" }))).toEqual({ ok: false, error: "payLevelCell" });
  });
  it("carries grade and joining date", () => {
    expect(buildOfferPayload(f({ basic: "100", grade: " Gr-B ", joiningDate: "2026-11-01" }))).toEqual({ ok: true, payload: { basicMinor: 10000, grade: "Gr-B", joiningDate: "2026-11-01" } });
  });
});
