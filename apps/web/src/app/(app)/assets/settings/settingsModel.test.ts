import { describe, it, expect } from "vitest";
import { parseAssetSettings, headsPatch, type HeadField } from "./settingsModel";

const none: Record<HeadField, string | null> = { cwipAccountCode: null, fixedAssetAccountCode: null, impairmentExpenseAccountCode: null, revaluationReserveAccountCode: null, rouAccountCode: null, leaseLiabilityAccountCode: null, leaseOffsetAccountCode: null };
const blank: Record<HeadField, string> = { cwipAccountCode: "", fixedAssetAccountCode: "", impairmentExpenseAccountCode: "", revaluationReserveAccountCode: "", rouAccountCode: "", leaseLiabilityAccountCode: "", leaseOffsetAccountCode: "" };

describe("settingsModel (fp-assets-01)", () => {
  it("parses the settings payload, including a pending maker-checker-off request", () => {
    expect(parseAssetSettings({ capitalizeMakerChecker: true, cwipAccountCode: "1300", pendingMakerCheckerOff: { id: "r1", requestedByMe: true } })).toEqual({
      capitalizeMakerChecker: true, heads: { ...none, cwipAccountCode: "1300" }, pending: { id: "r1", requestedByMe: true },
    });
    expect(parseAssetSettings({ capitalizeMakerChecker: false, pendingMakerCheckerOff: null })!.pending).toBeNull();
    expect(parseAssetSettings({ nope: 1 })).toBeNull();
    expect(parseAssetSettings(null)).toBeNull();
  });
  it("includes the impairment-expense and revaluation-reserve heads", () => {
    expect(parseAssetSettings({ capitalizeMakerChecker: true, impairmentExpenseAccountCode: "5200", revaluationReserveAccountCode: "3100" })!.heads)
      .toMatchObject({ impairmentExpenseAccountCode: "5200", revaluationReserveAccountCode: "3100" });
    expect(headsPatch(none, { ...blank, impairmentExpenseAccountCode: "5200", revaluationReserveAccountCode: "3100" }))
      .toEqual({ patch: { impairmentExpenseAccountCode: "5200", revaluationReserveAccountCode: "3100" }, invalid: null });
  });
  it("sends only changed heads, clears an emptied one, and flags a malformed code", () => {
    expect(headsPatch(none, blank)).toBeNull();
    expect(headsPatch({ ...none, cwipAccountCode: "1300" }, { ...blank, cwipAccountCode: "1300" })).toBeNull();
    expect(headsPatch(none, { ...blank, cwipAccountCode: " 1300 ", rouAccountCode: "1400" })).toEqual({ patch: { cwipAccountCode: "1300", rouAccountCode: "1400" }, invalid: null });
    expect(headsPatch({ ...none, rouAccountCode: "1400" }, blank)).toEqual({ patch: { rouAccountCode: null }, invalid: null });
    expect(headsPatch(none, { ...blank, leaseLiabilityAccountCode: "bad code!" })).toEqual({ patch: {}, invalid: "leaseLiabilityAccountCode" });
  });
});
