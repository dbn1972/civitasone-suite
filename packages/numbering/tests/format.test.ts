import { describe, it, expect } from "vitest";
import {
  normalizeSpec,
  DEFAULT_SPEC,
  financialYear,
  formatSequence,
  resetBucket,
  formatReference,
  allocateGaplessSeq,
  allocateReference,
  type NumberFormatSpec,
  type SqlExecutor,
} from "../src/index.js";

const D = (iso: string) => new Date(iso);

describe("normalizeSpec", () => {
  it("fills defaults from a bare prefix", () => {
    expect(normalizeSpec({ prefix: "PO" })).toEqual({ ...DEFAULT_SPEC, prefix: "PO" });
  });
  it("rejects a bad fyStartMonth", () => {
    expect(() => normalizeSpec({ fyStartMonth: 0 })).toThrow(/fyStartMonth/);
    expect(() => normalizeSpec({ fyStartMonth: 13 })).toThrow(/fyStartMonth/);
  });
  it("rejects a bad counterWidth", () => {
    expect(() => normalizeSpec({ counterWidth: 0 })).toThrow(/counterWidth/);
    expect(() => normalizeSpec({ counterWidth: 99 })).toThrow(/counterWidth/);
  });
  it("rejects an over-long separator / prefix", () => {
    expect(() => normalizeSpec({ separator: "-----" })).toThrow(/separator/);
    expect(() => normalizeSpec({ prefix: "x".repeat(33) })).toThrow(/prefix/);
  });
  it("rejects an unknown reset policy", () => {
    expect(() => normalizeSpec({ resetPolicy: "hourly" as never })).toThrow(/resetPolicy/);
  });
});

describe("financialYear (April start)", () => {
  it("rolls at the FY boundary", () => {
    expect(financialYear(D("2026-03-31T00:00:00Z"), 4)).toBe("2025-26");
    expect(financialYear(D("2026-04-01T00:00:00Z"), 4)).toBe("2026-27");
    expect(financialYear(D("2026-12-31T00:00:00Z"), 4)).toBe("2026-27");
  });
  it("handles a January (calendar) FY", () => {
    expect(financialYear(D("2026-01-01T00:00:00Z"), 1)).toBe("2026-27");
  });
  it("pads the end-year to two digits at the century (2099->00)", () => {
    expect(financialYear(D("2099-05-01T00:00:00Z"), 4)).toBe("2099-00");
  });
});

describe("formatSequence", () => {
  it("zero-pads and never truncates", () => {
    expect(formatSequence(1, 6)).toBe("000001");
    expect(formatSequence(123n, 4)).toBe("0123");
    expect(formatSequence(1234567, 4)).toBe("1234567");
  });
});

describe("resetBucket", () => {
  const spec = (p: Partial<NumberFormatSpec>) => normalizeSpec(p);
  it("never -> ALL", () => {
    expect(resetBucket(spec({ resetPolicy: "never" }), D("2026-07-01T00:00:00Z"))).toBe("ALL");
  });
  it("yearly with FY -> financial year", () => {
    expect(resetBucket(spec({ resetPolicy: "yearly", embedFinancialYear: true }), D("2026-07-01T00:00:00Z"))).toBe("2026-27");
  });
  it("yearly without FY -> calendar year", () => {
    expect(resetBucket(spec({ resetPolicy: "yearly", embedFinancialYear: false }), D("2026-07-01T00:00:00Z"))).toBe("2026");
  });
  it("monthly -> YYYY-MM", () => {
    expect(resetBucket(spec({ resetPolicy: "monthly" }), D("2026-07-01T00:00:00Z"))).toBe("2026-07");
  });
});

describe("formatReference", () => {
  it("prefix + FY + padded counter", () => {
    const spec = normalizeSpec({ prefix: "PO", counterWidth: 6 });
    expect(formatReference(spec, 123, { at: D("2026-07-01T00:00:00Z") })).toBe("PO/2026-27/000123");
  });
  it("reproduces a legacy single-year layout via segments override", () => {
    const spec = normalizeSpec({ prefix: "PO", embedFinancialYear: false, counterWidth: 4 });
    expect(formatReference(spec, 1, { segments: ["2026"] })).toBe("PO/2026/0001");
  });
  it("honours a custom separator and empty prefix", () => {
    const spec = normalizeSpec({ prefix: "", separator: "-", counterWidth: 3 });
    expect(formatReference(spec, 7, { at: D("2026-07-01T00:00:00Z") })).toBe("2026-27-007");
  });
});

/**
 * Fake executor: a monotonic counter that ignores the (identifier-only) query
 * shape. Bucket isolation and true gapless behaviour are proven separately by
 * `resetBucket` above and by the live-Postgres concurrency test in
 * metadata-service; here we only exercise the allocator's return/format wiring.
 */
function monotonicTx(): SqlExecutor {
  let n = 0n;
  return { async execute() { n += 1n; return [{ value: n.toString() }]; } };
}

const seqConfig = {
  schema: "metadata",
  table: "number_sequences",
  keyCol: "format_key",
  bucketCol: "bucket",
  valueCol: "current_value",
};
const TENANT = "11111111-1111-1111-1111-111111111111";

describe("allocateGaplessSeq (unit)", () => {
  it("returns the executor's value as a bigint, monotonically", async () => {
    const tx = monotonicTx();
    expect(await allocateGaplessSeq(tx, seqConfig, TENANT, "k", "2026-27")).toBe(1n);
    expect(await allocateGaplessSeq(tx, seqConfig, TENANT, "k", "2026-27")).toBe(2n);
  });
  it("rejects an unsafe identifier in config", async () => {
    await expect(
      allocateGaplessSeq(monotonicTx(), { ...seqConfig, valueCol: "x; DROP TABLE y" }, TENANT, "k", "b"),
    ).rejects.toThrow(/unsafe SQL identifier/);
  });
  it("throws when no row is returned", async () => {
    const badTx: SqlExecutor = { async execute() { return []; } };
    await expect(allocateGaplessSeq(badTx, seqConfig, TENANT, "k", "b")).rejects.toThrow(/no value returned/);
  });
  it("accepts a driver that wraps rows in { rows }", async () => {
    const wrapTx: SqlExecutor = { async execute() { return { rows: [{ value: 42 }] }; } };
    expect(await allocateGaplessSeq(wrapTx, seqConfig, TENANT, "k", "b")).toBe(42n);
  });
});

describe("allocateReference (unit)", () => {
  it("derives bucket, allocates, and formats", async () => {
    const tx = monotonicTx();
    const spec = normalizeSpec({ prefix: "CERT", counterWidth: 5, resetPolicy: "yearly" });
    const a = await allocateReference(tx, { spec, seqConfig, formatKey: "citizen.cert", tenantId: TENANT, at: D("2026-07-01T00:00:00Z") });
    expect(a).toEqual({ reference: "CERT/2026-27/00001", sequence: 1n, bucket: "2026-27" });
    const b = await allocateReference(tx, { spec, seqConfig, formatKey: "citizen.cert", tenantId: TENANT, at: D("2026-07-02T00:00:00Z") });
    expect(b.reference).toBe("CERT/2026-27/00002");
  });
  it("passes segments override through to the formatter", async () => {
    const spec = normalizeSpec({ prefix: "PO", embedFinancialYear: false, counterWidth: 4 });
    const r = await allocateReference(monotonicTx(), { spec, seqConfig, formatKey: "procurement.po", tenantId: TENANT, segments: ["2026"], at: D("2026-07-01T00:00:00Z") });
    expect(r.reference).toBe("PO/2026/0001");
  });
});
