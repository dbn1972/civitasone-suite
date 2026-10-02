import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { challanView } from "../src/modules/treasury/challan-view.js";
import { lastFourDigits } from "../src/modules/instruments/account-mask.js";
import { FinanceChallanSummarySchema, FinanceInstrumentSummarySchema } from "@civitasone/schemas/web";
import type { ChallanWithHead } from "../src/modules/treasury/repo.js";

const NOW = new Date("2026-09-26T10:00:00.000Z");
const challan = {
  id: "11111111-1111-4111-8111-111111111111", tenantId: "t", challanNo: "CH-1", bankAccountId: null,
  receiptHeadId: "22222222-2222-4222-8222-222222222222", depositor: "ACME", amountMinor: 15050n, currency: "INR",
  grnNo: null, status: "pending", createdAt: NOW, updatedAt: NOW, version: 1,
} as unknown as ChallanWithHead["challan"];

describe("challanView (GAP-FINANCE-REVENUE-CHALLANS-02 / DETAIL-03)", () => {
  it("carries the receipt head code and name next to the id and validates against the wire schema", () => {
    const v = challanView({ challan, headCode: "0040", headName: "Tax Revenue" });
    expect(v).toMatchObject({ receiptHeadCode: "0040", receiptHeadName: "Tax Revenue", amountMinor: "15050" });
    expect(FinanceChallanSummarySchema.parse(v).receiptHeadCode).toBe("0040");
  });
  it("sends nulls (not the uuid) when the head row is missing", () => {
    const v = challanView({ challan, headCode: null, headName: null });
    expect(v.receiptHeadCode).toBeNull();
    expect(FinanceChallanSummarySchema.parse(v).receiptHeadName).toBeNull();
  });
});

describe("lastFourDigits (GAP-FINANCE-TREASURY-CHEQUES-05)", () => {
  it("returns only the last four characters", () => {
    expect(lastFourDigits("123456789012")).toBe("9012");
  });
  it("returns null when there is nothing safe to show", () => {
    expect(lastFourDigits("12")).toBeNull();
    expect(lastFourDigits(null)).toBeNull();
  });
  it("the instrument wire schema accepts accountNoLast4 and does not require it", () => {
    const base = {
      id: "i", instrumentType: "cheque", instrumentNo: "1", bankAccountId: null, bankName: "SBI", payee: "p",
      amountMinor: "1", currency: "INR", issueDate: "2026-09-01", status: "issued",
      presentedAt: null, clearedAt: null, bouncedAt: null, cancelledAt: null, bounceReason: null,
    };
    expect(FinanceInstrumentSummarySchema.parse({ ...base, accountNoLast4: "9012" }).accountNoLast4).toBe("9012");
    expect(FinanceInstrumentSummarySchema.parse(base).accountNoLast4).toBeUndefined();
  });
});

// GAP-FINANCE-TRAVEL-04: the web redirects /finance/travel to /hr/travel because finance-service has
// no travel-claims route; assert that so a stale redirect cannot hide a missing/duplicate backend.
describe("finance-service has no travel-claims route", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  }
  it("no source file registers /v1/finance/travel-claims", () => {
    const src = walk(join(__dirname, "../src"));
    const hits = src.filter((f) => readFileSync(f, "utf8").includes("/v1/finance/travel-claims"));
    expect(hits).toEqual([]);
  });
});
