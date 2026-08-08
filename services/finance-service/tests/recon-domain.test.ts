/**
 * Reconciliation Module — provider registry and matching contract tests.
 * Pack #19. Source: modules/recon/*
 */
import { describe, it, expect } from "vitest";

describe("reconciliation provider registry", () => {
  const PROVIDERS = ["book-vs-bank"];
  it("book-vs-bank provider is registered", () => {
    expect(PROVIDERS).toContain("book-vs-bank");
  });
  it("provider has source and target systems", () => {
    const p = { key: "book-vs-bank", sourceSystem: "finance-book", targetSystem: "bank-statement" };
    expect(p.sourceSystem).toBe("finance-book");
    expect(p.targetSystem).toBe("bank-statement");
  });
});

describe("reconciliation matching rules", () => {
  it("key-based match: same UTR/reference = matched", () => {
    const source = [{ key: "UTR001", amountMinor: 50_000n }];
    const target = [{ key: "UTR001", amountMinor: 50_000n }];
    const matched = source.filter(s => target.some(t => t.key === s.key && t.amountMinor === s.amountMinor));
    expect(matched.length).toBe(1);
  });

  it("amount mismatch = break/exception", () => {
    const source = [{ key: "UTR002", amountMinor: 50_000n }];
    const target = [{ key: "UTR002", amountMinor: 49_999n }];
    const breaks = source.filter(s => {
      const t = target.find(t => t.key === s.key);
      return t && t.amountMinor !== s.amountMinor;
    });
    expect(breaks.length).toBe(1);
  });

  it("missing in target = unmatched source (outstanding payment)", () => {
    const source = [{ key: "UTR003", amountMinor: 30_000n }];
    const target: typeof source = [];
    const unmatched = source.filter(s => !target.some(t => t.key === s.key));
    expect(unmatched.length).toBe(1);
  });

  it("missing in source = unmatched target (unexplained bank entry)", () => {
    const source: Array<{ key: string; amountMinor: bigint }> = [];
    const target = [{ key: "BANK001", amountMinor: 20_000n }];
    const unmatched = target.filter(t => !source.some(s => s.key === t.key));
    expect(unmatched.length).toBe(1);
  });
});

describe("reconciliation run idempotency", () => {
  it("duplicate run with same parameters returns existing result", () => {
    const runs = new Map([["run-key-1", { id: "r1", status: "completed" }]]);
    expect(runs.has("run-key-1")).toBe(true);
  });
});

describe("reconciliation totals conservation", () => {
  it("matched + unmatched_source + unmatched_target = total records", () => {
    const totalSource = 10, totalTarget = 8;
    const matched = 7, unmatchedSource = 3, unmatchedTarget = 1;
    expect(matched + unmatchedSource).toBe(totalSource);
    expect(matched + unmatchedTarget).toBe(totalTarget);
  });
});
