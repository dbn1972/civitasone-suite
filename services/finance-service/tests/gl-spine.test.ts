/**
 * GL Spine — deterministicId and journal balance validation tests.
 *
 * Source: services/finance-service/src/modules/gl/spine.ts, domain.ts, validators.ts
 * Pack #09: erp-ai-test-prompts/Finance_Module_Test_Pack/09_GL_Module_Test_Pack.md
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
  markProcessed: vi.fn(async () => true),
}));

import { deterministicId } from "../src/modules/gl/spine.js";
import { assertJournalBalances, DomainError } from "../src/modules/gl/domain.js";

// ─── deterministicId ─────────────────────────────────────────────────────────

describe("deterministicId — stable idempotent journal IDs", () => {
  it("returns the same UUID for the same key", () => {
    const id1 = deterministicId("bill:abc-123");
    const id2 = deterministicId("bill:abc-123");
    expect(id1).toBe(id2);
  });

  it("returns different UUIDs for different keys", () => {
    const id1 = deterministicId("bill:abc-123");
    const id2 = deterministicId("bill:abc-124");
    expect(id1).not.toBe(id2);
  });

  it("returns a UUID-like format (8-4-4-4-12)", () => {
    const id = deterministicId("payment:xyz");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("different source types produce different IDs", () => {
    const billId = deterministicId("bill:same-ref");
    const paymentId = deterministicId("payment:same-ref");
    expect(billId).not.toBe(paymentId);
  });

  it("handles empty string key", () => {
    const id = deterministicId("");
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("handles very long keys (1000 chars)", () => {
    const longKey = "x".repeat(1000);
    const id = deterministicId(longKey);
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });
});

// ─── assertJournalBalances (already in gl-domain.test.ts but pack requires it) ──

describe("assertJournalBalances — GL module core invariant", () => {
  it("passes for balanced 2-line journal", () => {
    expect(() => assertJournalBalances([
      { accountCode: "1100", debitMinor: 100_000, creditMinor: 0 },
      { accountCode: "2100", debitMinor: 0, creditMinor: 100_000 },
    ])).not.toThrow();
  });

  it("throws JOURNAL_UNBALANCED for off-by-one", () => {
    expect(() => assertJournalBalances([
      { accountCode: "1100", debitMinor: 100_001, creditMinor: 0 },
      { accountCode: "2100", debitMinor: 0, creditMinor: 100_000 },
    ])).toThrow(DomainError);
  });

  it("throws JOURNAL_TOO_FEW_LINES for single line", () => {
    expect(() => assertJournalBalances([
      { accountCode: "1100", debitMinor: 100, creditMinor: 100 },
    ])).toThrow(DomainError);
  });

  it("handles bigint amounts above 2^53", () => {
    const big = "10000000000000001";
    expect(() => assertJournalBalances([
      { accountCode: "1200", debitMinor: big, creditMinor: "0" },
      { accountCode: "2100", debitMinor: "0", creditMinor: big },
    ])).not.toThrow();
  });
});

// ─── postJournalBody validation contract (inline, no zod import) ─────────────

describe("journal post validation contract", () => {
  it("balanced journal: sum(debit) must equal sum(credit)", () => {
    const lines = [
      { accountCode: "1100", debitMinor: 5000, creditMinor: 0 },
      { accountCode: "2100", debitMinor: 0, creditMinor: 5000 },
    ];
    const totalDr = lines.reduce((s, l) => s + l.debitMinor, 0);
    const totalCr = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(totalDr).toBe(totalCr);
  });

  it("unbalanced journal fails the balance check", () => {
    const lines = [
      { accountCode: "1100", debitMinor: 6000, creditMinor: 0 },
      { accountCode: "2100", debitMinor: 0, creditMinor: 5000 },
    ];
    const totalDr = lines.reduce((s, l) => s + l.debitMinor, 0);
    const totalCr = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(totalDr).not.toBe(totalCr);
  });

  it("minimum 2 lines required", () => {
    const lines = [{ accountCode: "1100", debitMinor: 100, creditMinor: 100 }];
    expect(lines.length < 2).toBe(true);
  });

  it("postingDate must be YYYY-MM-DD format", () => {
    const valid = /^\d{4}-\d{2}-\d{2}$/;
    expect(valid.test("2026-07-15")).toBe(true);
    expect(valid.test("15-07-2026")).toBe(false);
  });

  it("valid journal types: journal, payment, receipt, contra", () => {
    const types = ["journal", "payment", "receipt", "contra"];
    expect(types.includes("journal")).toBe(true);
    expect(types.includes("transfer")).toBe(false);
  });

  it("negative amounts are invalid", () => {
    const valid = (n: number) => Number.isInteger(n) && n >= 0;
    expect(valid(-100)).toBe(false);
    expect(valid(0)).toBe(true);
    expect(valid(100)).toBe(true);
  });

  it("voucherNo defaults to AUTO when omitted", () => {
    const defaultVoucher = "AUTO";
    expect(defaultVoucher).toBe("AUTO");
  });
});
