/**
 * PSU v1 slice C, PURE (no DB): cap table, dividend arithmetic, DIPAM advisory, CSR note, CARO / C&AG stubs and the config loader.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_PSU_CONFIG, loadPsuConfig } from "../src/modules/psu-disclosures/config.js";
import { auditMarkers, buildCapTable, computeDividend, csrNote, dipamAdvisory, type HoldingInput, type YearFigures } from "../src/modules/psu-disclosures/domain.js";

const H = (holderName: string, category: string, shares: bigint, o: Partial<HoldingInput> = {}): HoldingInput =>
  ({ holderName, category, shareClass: "equity", shares, faceValueMinor: 1000n, folio: null, status: "active", ...o });
const REG = [H("President of India", "president_of_india", 5100n), H("LIC", "institution", 2900n), H("Public", "public", 2000n), H("Old holder", "public", 999n, { status: "retired" })];

describe("cap table", () => {
  it("holding %, Government ownership % and the paid-up tie (retired holdings excluded)", () => {
    const c = buildCapTable(REG, 10_000_000n, DEFAULT_PSU_CONFIG, true);
    expect(c.equity.shares).toBe("10000");
    expect(c.govtEquityShares).toBe("5100");
    expect(c.govtOwnershipPct).toBe("51.00");
    expect(c.govtOwnershipBps).toBe(5100);
    expect(c.paidUpTotalMinor).toBe("10000000");
    expect(c.tiesToShareCapital).toBe(true);
    expect(c.differenceMinor).toBe("0");
    expect(c.equity.byCategory.find((x) => x.category === "public")).toMatchObject({ shares: "2000", holdingPct: "20.00" });
    expect(c.warnings).toEqual([]);
  });
  it("a ledger mismatch is reported, not hidden; govt_owned with <51% warns; empty register warns", () => {
    const c = buildCapTable(REG, 9_000_000n, DEFAULT_PSU_CONFIG, true);
    expect(c.tiesToShareCapital).toBe(false);
    expect(c.differenceMinor).toBe("-1000000");
    expect(c.warnings.join("|")).toMatch(/SHARE_CAPITAL_MISMATCH/);
    const low = buildCapTable([H("President of India", "president_of_india", 4000n), H("Public", "public", 6000n)], null, DEFAULT_PSU_CONFIG, true);
    expect(low.warnings.join("|")).toMatch(/GOVT_HOLDING_BELOW_THRESHOLD/);
    expect(low.tiesToShareCapital).toBeNull();
    expect(buildCapTable([], 0n, DEFAULT_PSU_CONFIG, true).warnings.join("|")).toMatch(/CAP_TABLE_EMPTY/);
  });
  it("preference shares are a separate class and never counted in the equity ownership %", () => {
    const c = buildCapTable([...REG, H("Pref holder", "institution", 500n, { shareClass: "preference", faceValueMinor: 10_000n })], null, DEFAULT_PSU_CONFIG, true);
    expect(c.equity.shares).toBe("10000");
    expect(c.preference.shares).toBe("500");
    expect(c.preference.paidUpMinor).toBe("5000000");
    expect(c.govtOwnershipPct).toBe("51.00");
  });
});

describe("dividend arithmetic + DIPAM advisory", () => {
  it("amount = per-share x equity shares; the Government portion is its equity shares x the same rate", () => {
    expect(computeDividend(REG, 500n)).toEqual({ equityShares: 10000n, govtShares: 5100n, amountMinor: 5_000_000n, govtAmountMinor: 2_550_000n });
  });
  it("DIPAM is OFF by default (null) and, in advisory mode, the higher of 30% PAT / 5% net worth; never blocks", () => {
    expect(dipamAdvisory(50_000_000n, 90_000_000n, 0n, DEFAULT_PSU_CONFIG)).toBeNull();
    const cfg = loadPsuConfig({ FINANCE_PSU_DIPAM_MODE: "advisory" } as NodeJS.ProcessEnv);
    const a = dipamAdvisory(50_000_000n, 90_000_000n, 5_000_000n, cfg)!;
    expect(a).toMatchObject({ byPatMinor: "15000000", byNetWorthMinor: "4500000", requiredMinor: "15000000", met: false });
    expect(dipamAdvisory(50_000_000n, 90_000_000n, 15_000_000n, cfg)!.met).toBe(true);
    expect(dipamAdvisory(-1n, 100_000n, 0n, cfg)!.requiredMinor).toBe("5000");
  });
});

describe("CSR (s.135) note", () => {
  const Y = (fy: string, pbt: bigint, o: Partial<YearFigures> = {}): YearFigures => ({ fy, hasActivity: true, profitBeforeTaxMinor: pbt, turnoverMinor: 0n, netWorthMinor: 0n, ...o });
  it("not applicable when no prior-year threshold is met", () => {
    const n = csrNote("2026-27", Y("2025-26", 1000n), [Y("2025-26", 1000n)], DEFAULT_PSU_CONFIG);
    expect(n.applicable).toBe(false);
    expect(n.obligationMinor).toBe("0");
  });
  it("applicable when any threshold is met: 2% of the average of the years WITH activity; a loss average gives 0", () => {
    const cfg = loadPsuConfig({ FINANCE_PSU_DISCLOSURE_CONFIG: JSON.stringify({ csr: { netProfitMinor: "1000" } }) } as NodeJS.ProcessEnv);
    const n = csrNote("2026-27", Y("2025-26", 3_000_000n), [Y("2025-26", 3_000_000n), Y("2024-25", 1_000_000n), Y("2023-24", 0n, { hasActivity: false })], cfg);
    expect(n).toMatchObject({ applicable: true, averageNetProfitMinor: "2000000", obligationMinor: "40000", yearsUsed: ["2025-26", "2024-25"] });
    expect(n.applicabilityBasis.metBy).toEqual(["net_profit"]);
    const loss = csrNote("2026-27", Y("2025-26", 5000n), [Y("2025-26", -9_000n)], cfg);
    expect(loss).toMatchObject({ applicable: true, obligationMinor: "0" });
  });
});

describe("CARO / C&AG stubs + config", () => {
  it("only for audit_profile cag_caro; stubs carry no audit conclusion", () => {
    expect(auditMarkers("standard", DEFAULT_PSU_CONFIG)).toBeNull();
    const m = auditMarkers("cag_caro", DEFAULT_PSU_CONFIG)!;
    expect(m.caro.clauses).toHaveLength(21);
    expect(m.caro.clauses.every((c) => c.status === "to_be_reported_by_auditor")).toBe(true);
    expect(m.cag.notes.map((n) => n.ref)).toEqual(["s.139(5)", "s.143(5)", "s.143(6)(a)"]);
  });
  it("note text is pluggable via the JSON override; a malformed override falls back to defaults", () => {
    const cfg = loadPsuConfig({ FINANCE_PSU_DISCLOSURE_CONFIG: JSON.stringify({ cag: { notes: [{ ref: "x", text: "custom" }] } }) } as NodeJS.ProcessEnv);
    expect(auditMarkers("cag_caro", cfg)!.cag.notes).toEqual([{ ref: "x", text: "custom" }]);
    expect(loadPsuConfig({ FINANCE_PSU_DISCLOSURE_CONFIG: "{not json" } as NodeJS.ProcessEnv)).toEqual(loadPsuConfig({} as NodeJS.ProcessEnv));
  });
});
