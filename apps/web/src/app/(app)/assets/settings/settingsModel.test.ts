import { describe, it, expect } from "vitest";
import { parseAssetSettings, parseAccounting, missingForAreas, headsPatch, HEAD_FIELDS, type HeadField } from "./settingsModel";

const none = Object.fromEntries(HEAD_FIELDS.map((f) => [f.field, null])) as Record<HeadField, string | null>;
const blank = Object.fromEntries(HEAD_FIELDS.map((f) => [f.field, ""])) as Record<HeadField, string>;

describe("settingsModel (fp-assets-01)", () => {
  it("parses the settings payload, including a pending maker-checker-off request", () => {
    expect(parseAssetSettings({ capitalizeMakerChecker: true, cwipAccountCode: "1300", pendingMakerCheckerOff: { id: "r1", requestedByMe: true } })).toEqual({
      capitalizeMakerChecker: true, glMakerChecker: true, sweepLimit: 200, pendingRequests: [], heads: { ...none, cwipAccountCode: "1300" }, pending: { id: "r1", requestedByMe: true },
      accounting: {}, glOpen: { assetsAwaiting: 0, assetsFailed: 0, workOrdersAwaiting: 0, workOrdersFailed: 0 },
    });
    expect(parseAssetSettings({ capitalizeMakerChecker: false, pendingMakerCheckerOff: null })!.pending).toBeNull();
    expect(parseAssetSettings({ nope: 1 })).toBeNull();
    expect(parseAssetSettings(null)).toBeNull();
  });
  it("has a field for every GL head asset-service configures, including the four formerly env-defaulted ones", () => {
    const fields = HEAD_FIELDS.map((f) => f.field);
    for (const f of ["fixedAssetAccountCode", "grnClearingAccountCode", "acquisitionOffsetAccountCode", "maintenanceExpenseAccountCode", "apControlAccountCode"]) expect(fields).toContain(f);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("parses the accounting summary and the open-journal counts defensively", () => {
    const s = parseAssetSettings({
      capitalizeMakerChecker: true,
      accounting: { acquisition: { configured: false, missing: ["fixed_asset", "bogus", 5] }, maintenance: { configured: true, missing: [] }, nonsense: {} },
      glOpen: { assetsAwaiting: 3, assetsFailed: "x", workOrdersAwaiting: -1, workOrdersFailed: 2 },
    })!;
    expect(s.accounting.acquisition).toEqual({ configured: false, missing: ["fixed_asset"] });
    expect(s.accounting.maintenance).toEqual({ configured: true, missing: [] });
    expect(s.glOpen).toEqual({ assetsAwaiting: 3, assetsFailed: 0, workOrdersAwaiting: 0, workOrdersFailed: 2 });
    expect(parseAssetSettings({ capitalizeMakerChecker: true })!.glOpen).toEqual({ assetsAwaiting: 0, assetsFailed: 0, workOrdersAwaiting: 0, workOrdersFailed: 0 });
    expect(parseAccounting(null)).toEqual({});
  });

  it("missingForAreas merges the areas without duplicates", () => {
    const acc = parseAccounting({ impairment: { configured: false, missing: ["fixed_asset", "impairment_expense"] }, revaluation: { configured: false, missing: ["fixed_asset", "revaluation_reserve"] } });
    expect(missingForAreas(acc, ["impairment", "revaluation"])).toEqual(["fixed_asset", "impairment_expense", "revaluation_reserve"]);
    expect(missingForAreas(acc, ["maintenance"])).toEqual([]);
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

  it("parses the GL maker-checker flag (ON unless the server says otherwise), the sweep bound and the pending requests", () => {
    expect(parseAssetSettings({ capitalizeMakerChecker: true })!.glMakerChecker).toBe(true);
    expect(parseAssetSettings({ capitalizeMakerChecker: true, glMakerChecker: false, sweepLimit: 50 })).toMatchObject({ glMakerChecker: false, sweepLimit: 50 });
    const s = parseAssetSettings({
      capitalizeMakerChecker: true,
      pendingRequests: [
        { id: "a", kind: "gl_heads_change", reason: "r", requestedByMe: true, heads: { fixedAssetAccountCode: "1200", grnClearingAccountCode: null, bogus: "x" } },
        { id: "b", kind: "gl_maker_checker_off", reason: "q", requestedByMe: false, heads: null },
        { id: "c", kind: "unknown_kind" }, { kind: "gl_heads_change" }, "junk",
      ],
    })!;
    expect(s.pendingRequests).toEqual([
      { id: "a", kind: "gl_heads_change", reason: "r", requestedByMe: true, heads: { fixedAssetAccountCode: "1200", grnClearingAccountCode: null } },
      { id: "b", kind: "gl_maker_checker_off", reason: "q", requestedByMe: false, heads: {} },
    ]);
  });
});
