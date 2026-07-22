/**
 * Tender domain tests — authority routing, quotation comparison,
 * pre-tender finalization.
 */
import { describe, it, expect } from "vitest";
import {
  resolveApprovingAuthority,
  findLowestBidder,
  canFinalizePreTender,
} from "../src/modules/tender/domain.js";

describe("resolveApprovingAuthority", () => {
  it("section_officer for amounts up to 5 lakh", () => {
    expect(resolveApprovingAuthority(100_00n)).toBe("section_officer");
    expect(resolveApprovingAuthority(500_000_00n)).toBe("section_officer");
  });

  it("sdo for amounts above 5 lakh up to 25 lakh", () => {
    expect(resolveApprovingAuthority(500_001_00n)).toBe("sdo");
    expect(resolveApprovingAuthority(25_00_000_00n)).toBe("sdo");
  });

  it("do for amounts above 25 lakh up to 1 crore", () => {
    expect(resolveApprovingAuthority(25_00_001_00n)).toBe("do");
    expect(resolveApprovingAuthority(1_00_00_000_00n)).toBe("do");
  });

  it("dao for amounts above 1 crore", () => {
    expect(resolveApprovingAuthority(1_00_00_001_00n)).toBe("dao");
    expect(resolveApprovingAuthority(10_00_00_000_00n)).toBe("dao");
  });
});

describe("findLowestBidder", () => {
  it("returns the quotation with lowest amount", () => {
    const quotations = [
      { contractorName: "A Corp", quotedAmountMinor: 500_000n, method: "item_rate" },
      { contractorName: "B Corp", quotedAmountMinor: 300_000n, method: "item_rate" },
      { contractorName: "C Corp", quotedAmountMinor: 700_000n, method: "item_rate" },
    ];
    const l1 = findLowestBidder(quotations);
    expect(l1).not.toBeNull();
    expect(l1!.contractorName).toBe("B Corp");
    expect(l1!.quotedAmountMinor).toBe(300_000n);
  });

  it("returns null for empty quotations", () => {
    expect(findLowestBidder([])).toBeNull();
  });

  it("returns first when all equal", () => {
    const quotations = [
      { contractorName: "A", quotedAmountMinor: 100n, method: "item_rate" },
      { contractorName: "B", quotedAmountMinor: 100n, method: "item_rate" },
    ];
    const l1 = findLowestBidder(quotations);
    expect(l1!.contractorName).toBe("A");
  });

  it("handles single quotation", () => {
    const quotations = [
      { contractorName: "Solo", quotedAmountMinor: 999_999n, method: "percentage_rate" },
    ];
    const l1 = findLowestBidder(quotations);
    expect(l1!.contractorName).toBe("Solo");
  });
});

describe("canFinalizePreTender", () => {
  it("allows finalization from draft", () => {
    const result = canFinalizePreTender("draft");
    expect(result.allowed).toBe(true);
  });

  it("blocks finalization from finalized", () => {
    const result = canFinalizePreTender("finalized");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("finalized");
  });

  it("blocks finalization from pushed", () => {
    const result = canFinalizePreTender("pushed");
    expect(result.allowed).toBe(false);
  });

  it("blocks finalization from transferred", () => {
    const result = canFinalizePreTender("transferred");
    expect(result.allowed).toBe(false);
  });
});
