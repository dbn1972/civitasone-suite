/**
 * M9 (payroll without Finance): the pure parts -- mode derivation, the tenant
 * module accessor's fail-towards-today rule, the journal lines, the CSV / Tally
 * renderers and the bank confirmation parser. No database.
 */
import { describe, it, expect, afterEach } from "vitest";
import { effectiveLedgerMode, isLedgerMode } from "../src/modules/ledger-export/mode.js";
import { tenantHasModule, setModuleKeyFetcher } from "../src/shared/tenant-modules.js";
import {
  accrualJournalLines, settlementJournalLines, isBalanced, journalsToCsv, journalsToTallyXml, rupees, payMonthEndDate, voucherNo, deductionHeads,
  type StoredJournal,
} from "../src/modules/ledger-export/journal.js";
import { parseBankConfirmation, parseRupeesToMinor, bankConfirmationHash } from "../src/modules/ledger-export/bank-confirmation.js";

const T = "11111111-2222-4333-8444-555555555555";

describe("effectiveLedgerMode", () => {
  it("a tenant with Finance and no override is on the finance path (every existing tenant)", () => {
    expect(effectiveLedgerMode(null, true)).toEqual({ mode: "finance", source: "derived" });
    expect(effectiveLedgerMode(undefined, true)).toEqual({ mode: "finance", source: "derived" });
  });
  it("a tenant without Finance derives export", () => {
    expect(effectiveLedgerMode(null, false)).toEqual({ mode: "export", source: "derived" });
  });
  it("an explicit override wins either way", () => {
    expect(effectiveLedgerMode("export", true)).toEqual({ mode: "export", source: "override" });
    expect(effectiveLedgerMode("finance", false)).toEqual({ mode: "finance", source: "override" });
  });
  it("an unknown stored value is ignored rather than trusted", () => {
    expect(effectiveLedgerMode("garbage", true)).toEqual({ mode: "finance", source: "derived" });
    expect(isLedgerMode("export")).toBe(true);
    expect(isLedgerMode("EXPORT")).toBe(false);
  });
});

describe("tenantHasModule (fails towards today's behaviour)", () => {
  afterEach(() => setModuleKeyFetcher());

  it("reads the module list", async () => {
    setModuleKeyFetcher(async () => ["hrms", "payroll"]);
    expect(await tenantHasModule(T, "finance")).toBe(false);
    expect(await tenantHasModule(T, "payroll")).toBe(true);
  });
  it("an unreachable or unconfigured source (null) means the tenant has it", async () => {
    setModuleKeyFetcher(async () => null);
    expect(await tenantHasModule(T, "finance")).toBe(true);
  });
  it("a throwing source means the tenant has it", async () => {
    setModuleKeyFetcher(async () => { throw new Error("boom"); });
    expect(await tenantHasModule(T, "finance")).toBe(true);
  });
  it("a malformed tenant id never reaches the source and means yes", async () => {
    let called = 0;
    setModuleKeyFetcher(async () => { called++; return []; });
    expect(await tenantHasModule("not-a-uuid", "finance")).toBe(true);
    expect(called).toBe(0);
  });
  it("a definite answer is cached", async () => {
    let called = 0;
    setModuleKeyFetcher(async () => { called++; return ["payroll"]; });
    await tenantHasModule(T, "finance");
    await tenantHasModule(T, "finance");
    expect(called).toBe(1);
  });
});

const input = {
  totalGrossMinor: 21_375_600n, totalNetMinor: 20_295_600n, totalEmployerContribMinor: 1_080_000n,
  edliMinor: 45_000n, epfAdminMinor: 45_000n, upsPoolMinor: 671_500n,
};

describe("journal lines", () => {
  it("accrual: salary expense, net payable, one 2102 leg without a split, and every employer pair; balanced", () => {
    const lines = accrualJournalLines(input, {});
    expect(lines.map((l) => [l.accountCode, l.debitMinor.toString(), l.creditMinor.toString()])).toEqual([
      ["5001", "21375600", "0"], ["2101", "0", "20295600"], ["2102", "0", "1080000"],
      ["5002", "1080000", "0"], ["2103", "0", "1080000"],
      ["5002", "45000", "0"], ["2103", "0", "45000"],
      ["5002", "45000", "0"], ["2103", "0", "45000"],
      ["5002", "671500", "0"], ["2103", "0", "671500"],
    ]);
    expect(isBalanced(lines)).toBe(true);
  });
  it("accrual: a split that adds up to gross - net is credited head by head; one that does not stays a 2102 leg", () => {
    const good = accrualJournalLines({ ...input, edliMinor: 0n, epfAdminMinor: 0n, upsPoolMinor: 0n, totalEmployerContribMinor: 0n, employeeDeductionsMinor: { tds: "500000", gpf: 580000n } }, {});
    expect(good.slice(2).map((l) => [l.accountCode, l.creditMinor.toString()])).toEqual([["2200", "500000"], ["2104", "580000"]]);
    expect(isBalanced(good)).toBe(true);
    const bad = accrualJournalLines({ ...input, edliMinor: 0n, epfAdminMinor: 0n, upsPoolMinor: 0n, totalEmployerContribMinor: 0n, employeeDeductionsMinor: { tds: "1" } }, {});
    expect(bad[2]).toMatchObject({ accountCode: "2102", creditMinor: 1_080_000n });
  });
  it("head codes follow the same env overrides finance uses", () => {
    expect(deductionHeads({ PAYROLL_GL_TDS_HEAD: "2999" }).tds).toBe("2999");
    expect(deductionHeads({ FINANCE_TDS_PAYABLE_CODE: "2201" }).tds).toBe("2201");
    expect(deductionHeads({}).tds).toBe("2200");
  });
  it("settlement: Dr net payable / Cr bank, nothing for a run with nothing to pay", () => {
    const lines = settlementJournalLines(20_295_600n, {});
    expect(lines.map((l) => [l.accountCode, l.debitMinor.toString(), l.creditMinor.toString()])).toEqual([["2101", "20295600", "0"], ["1101", "0", "20295600"]]);
    expect(isBalanced(lines)).toBe(true);
    expect(settlementJournalLines(0n, {})).toEqual([]);
    expect(settlementJournalLines(-5n, {})).toEqual([]);
  });
  it("voucher numbers and dates are the ones finance uses", () => {
    const run = { id: "abcdef12-0000-4000-8000-000000000000", month: "2027-02" };
    expect(voucherNo("accrual", run)).toBe("PAY/2027-02/abcdef12");
    expect(voucherNo("disbursement", run)).toBe("PAYSTL/2027-02/ABCDEF12");
    expect(payMonthEndDate("2027-02")).toBe("2027-02-28");
    expect(payMonthEndDate("2028-02")).toBe("2028-02-29");
  });
  it("rupees renders paise exactly, without floats", () => {
    expect(rupees(0n)).toBe("0.00");
    expect(rupees(5n)).toBe("0.05");
    expect(rupees(9_007_199_254_740_993_00n)).toBe("9007199254740993.00");
    expect(rupees(-12345n)).toBe("-123.45");
  });
});

const journal: StoredJournal = {
  stage: "accrual", voucherNo: "PAY/2027-02/abcdef12", postingDate: "2027-02-28", month: "2027-02", runId: "abcdef12-0000-4000-8000-000000000000",
  lines: [
    { accountCode: "5001", debitMinor: 1_000_000n, creditMinor: 0n, narration: "Salary expense" },
    { accountCode: "2101", debitMinor: 0n, creditMinor: 1_000_000n, narration: 'Net, "quoted" =danger' },
  ],
};

describe("renderers", () => {
  it("CSV: header, one row per line, rupee amounts from paise, formula and quote safe", () => {
    const csv = journalsToCsv([journal]);
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toBe("Voucher No,Posting Date,Voucher Type,Account Code,Debit (INR),Credit (INR),Narration,Pay Month,Payroll Run");
    expect(rows[1]).toBe("PAY/2027-02/abcdef12,2027-02-28,payroll_accrual,5001,10000.00,,Salary expense,2027-02,abcdef12-0000-4000-8000-000000000000");
    expect(rows[2]).toContain(',2101,,10000.00,"Net, ""quoted"" =danger",');
    expect(journalsToCsv([{ ...journal, lines: [{ accountCode: "x", debitMinor: 1n, creditMinor: 0n, narration: "=1+1" }] }])).toContain(",'=1+1,");
  });
  it("Tally XML: a Journal voucher, debit negative / deemed positive, credit positive, ledger name = account code", () => {
    const xml = journalsToTallyXml([journal], "Demo & Co");
    expect(xml).toContain("<SVCURRENTCOMPANY>Demo &amp; Co</SVCURRENTCOMPANY>");
    expect(xml).toContain('<VOUCHER VCHTYPE="Journal" ACTION="Create">');
    expect(xml).toContain("<DATE>20270228</DATE>");
    expect(xml).toContain("<VOUCHERNUMBER>PAY/2027-02/abcdef12</VOUCHERNUMBER>");
    expect(xml).toMatch(/<LEDGERNAME>5001<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-10000\.00<\/AMOUNT>/);
    expect(xml).toMatch(/<LEDGERNAME>2101<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>10000\.00<\/AMOUNT>/);
  });
});

describe("bank confirmation parser", () => {
  it("reads a headered file with reordered columns", () => {
    const r = parseBankConfirmation("status,UTR,Employee No,Amount\nSUCCESS,U1,E1,\"42,000.50\"\ncredited,U2,E2,100\n");
    expect(r.errors).toEqual([]);
    expect(r.records).toEqual([
      { employeeNo: "E1", amountMinor: 4_200_050n, utr: "U1", outcome: "success" },
      { employeeNo: "E2", amountMinor: 10_000n, utr: "U2", outcome: "success" },
    ]);
  });
  it("reads a headerless file positionally; amount, utr and status are optional", () => {
    const r = parseBankConfirmation("E1\nE2,500.5,UTR9,FAILED\n\n");
    expect(r.records).toEqual([
      { employeeNo: "E1", amountMinor: null, utr: null, outcome: "success" },
      { employeeNo: "E2", amountMinor: 50_050n, utr: "UTR9", outcome: "failed" },
    ]);
  });
  it("reports unreadable rows by line instead of guessing", () => {
    const r = parseBankConfirmation("employee_no,amount,status\nE1,12.345,ok\nE2,abc,ok\n,10,ok\nE3,10,maybe\n");
    expect(r.records).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
  });
  it("amounts: at most two decimals, optional currency prefix and grouping", () => {
    expect(parseRupeesToMinor("Rs. 1,23,456.7")).toBe(12_345_670n);
    expect(parseRupeesToMinor("₹5")).toBe(500n);
    expect(parseRupeesToMinor("-5")).toBeNull();
    expect(parseRupeesToMinor("1.234")).toBeNull();
  });
  it("the file hash ignores line endings and trailing whitespace", () => {
    expect(bankConfirmationHash("E1,10\r\nE2,20  \r\n")).toBe(bankConfirmationHash("E1,10\nE2,20\n"));
    expect(bankConfirmationHash("E1,10")).not.toBe(bankConfirmationHash("E1,11"));
  });
});
