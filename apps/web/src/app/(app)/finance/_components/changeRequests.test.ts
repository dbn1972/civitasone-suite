import { describe, it, expect } from "vitest";
import type { FinanceChangeRequest } from "@civitasone/types";
import { openingBalanceTotalMinor, toChangeRequestView } from "./changeRequests";

const base: FinanceChangeRequest = {
  id: "r1", kind: "fiscal_year_activate", subjectKey: "2027-28", payload: { code: "2027-28" }, reason: "Rollover",
  status: "pending", requestedBy: "maker", requestedAt: "2027-03-31T10:00:00.000Z", decidedBy: null, decidedAt: null, decisionNote: null, version: 1,
};
const fmt = (m: bigint) => `Rs ${m}`;

describe("toChangeRequestView", () => {
  it("the maker can only withdraw; a different admin decides; a non-admin waits", () => {
    expect(toChangeRequestView(base, "maker", true, fmt).action).toBe("withdraw");
    expect(toChangeRequestView(base, "checker", true, fmt).action).toBe("decide");
    expect(toChangeRequestView(base, "checker", false, fmt).action).toBe("wait");
    expect(toChangeRequestView(base, "maker", true, fmt).mine).toBe(true);
    // an unknown viewer is never treated as the maker; the server stays the authority
    expect(toChangeRequestView(base, null, true, fmt)).toMatchObject({ mine: false, action: "decide" });
  });

  it("an HoA change shows head code and old -> new code (a dash when previously unmapped)", () => {
    const v = toChangeRequestView({ ...base, kind: "hoa_change", subjectKey: "uuid-1", payload: { headCode: "2110", oldHoaCode: null, hoaCode: "210100101010101011" } }, "x", true, fmt);
    expect(v.subject).toBe("2110");
    expect(v.details).toEqual(["— → 210100101010101011"]);
  });

  it("an opening-balance batch shows the entry count and the debit total in bigint paise", () => {
    const entries = [{ debitMinor: "9007199254740993", creditMinor: "0" }, { debitMinor: "7", creditMinor: "0" }, { debitMinor: "0", creditMinor: "9007199254741000" }];
    expect(openingBalanceTotalMinor(entries)).toBe(9007199254741000n);
    const v = toChangeRequestView({ ...base, kind: "opening_balances_enter", payload: { entries } }, "x", true, fmt);
    expect(v.details).toEqual(["3", "Rs 9007199254741000"]);
    expect(openingBalanceTotalMinor("nope")).toBe(0n);
  });

  it("a settings_relax request lists the controls it switches OFF", () => {
    const v = toChangeRequestView({ ...base, kind: "settings_relax", subjectKey: "settings", payload: { changes: { makerCheckerEnabled: false, fyCreateAsDraft: true, blockFyActivationOpenPeriods: false } } }, "x", true, fmt);
    expect(v.details).toEqual(["makerCheckerEnabled", "blockFyActivationOpenPeriods"]);
  });
});
