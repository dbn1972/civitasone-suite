/**
 * CAP-059 reconciliation engine — unit tests.
 * Covers field comparison (amounts with tolerance, identifiers, statuses),
 * missing-in-source/target, duplicate keys, the summary, and the exception
 * workflow state machine.
 */
import { describe, it, expect } from "vitest";
import {
  reconcile,
  compareField,
  severityForField,
  applyExceptionAction,
  isTerminalException,
  ExceptionWorkflowError,
  type ReconConfig,
  type ReconRecord,
} from "../src/index.js";

const config: ReconConfig = {
  keyField: "id",
  sourceSystem: "subledger",
  targetSystem: "gl",
  fields: [
    { field: "amount", type: "amount", tolerance: 0.005 },
    { field: "qty", type: "quantity" },
    { field: "status", type: "status" },
    { field: "ref", type: "identifier" },
  ],
};

describe("compareField", () => {
  it("amount within tolerance is equal, beyond is a mismatch with delta", () => {
    const within = compareField({ field: "a", type: "amount", tolerance: 0.01 }, 100.0, 100.009);
    expect(within.equal).toBe(true);
    expect(within.delta).toBeCloseTo(0.009, 5);
    const off = compareField({ field: "a", type: "amount", tolerance: 0.01 }, 100, 105);
    expect(off.equal).toBe(false);
    expect(off.delta).toBe(5);
  });

  it("coerces numeric strings", () => {
    expect(compareField({ field: "a", type: "amount" }, "100.00", "100.00")).toEqual({ equal: true, delta: 0 });
  });

  it("non-numeric data in numeric field falls back to strict compare", () => {
    expect(compareField({ field: "a", type: "count" }, "x", "x")).toEqual({ equal: true });
    expect(compareField({ field: "a", type: "count" }, "x", "y")).toEqual({ equal: false });
  });

  it("identifier and status compare exactly", () => {
    expect(compareField({ field: "s", type: "status" }, "POSTED", "POSTED").equal).toBe(true);
    expect(compareField({ field: "s", type: "status" }, "POSTED", "DRAFT").equal).toBe(false);
    expect(compareField({ field: "r", type: "identifier" }, "R1", "R1").equal).toBe(true);
  });

  it("severityForField ranks amount/status/identifier high, quantity/count medium", () => {
    expect(severityForField("amount")).toBe("high");
    expect(severityForField("status")).toBe("high");
    expect(severityForField("identifier")).toBe("high");
    expect(severityForField("quantity")).toBe("medium");
    expect(severityForField("count")).toBe("medium");
  });
});

describe("reconcile", () => {
  it("returns balanced with no breaks when datasets match", () => {
    const rows: ReconRecord[] = [
      { id: "1", amount: 10, qty: 2, status: "OK", ref: "A" },
      { id: "2", amount: 20, qty: 4, status: "OK", ref: "B" },
    ];
    const res = reconcile(rows, rows.map((r) => ({ ...r })), config);
    expect(res.summary.balanced).toBe(true);
    expect(res.breaks).toHaveLength(0);
    expect(res.summary.matchedKeys).toBe(2);
    expect(res.summary.sourceSystem).toBe("subledger");
    expect(res.summary.targetSystem).toBe("gl");
  });

  it("flags missing_in_target and missing_in_source", () => {
    const source: ReconRecord[] = [{ id: "1", amount: 10, qty: 1, status: "OK", ref: "A" }];
    const target: ReconRecord[] = [{ id: "2", amount: 10, qty: 1, status: "OK", ref: "A" }];
    const res = reconcile(source, target, config);
    expect(res.summary.byType.missing_in_target).toBe(1);
    expect(res.summary.byType.missing_in_source).toBe(1);
    expect(res.breaks.find((b) => b.type === "missing_in_target")!.key).toBe("1");
    expect(res.breaks.find((b) => b.type === "missing_in_source")!.key).toBe("2");
    expect(res.summary.balanced).toBe(false);
  });

  it("flags value_mismatch per field with delta on numerics", () => {
    const source: ReconRecord[] = [{ id: "1", amount: 100, qty: 5, status: "POSTED", ref: "A" }];
    const target: ReconRecord[] = [{ id: "1", amount: 100.5, qty: 6, status: "DRAFT", ref: "B" }];
    const res = reconcile(source, target, config);
    const byField = Object.fromEntries(res.breaks.map((b) => [b.field, b]));
    expect(byField.amount!.delta).toBeCloseTo(0.5);
    expect(byField.amount!.severity).toBe("high");
    expect(byField.qty!.delta).toBe(1);
    expect(byField.qty!.severity).toBe("medium");
    expect(byField.status!.type).toBe("value_mismatch");
    expect(byField.ref!.severity).toBe("high");
    expect(res.summary.byType.value_mismatch).toBe(4);
  });

  it("detects duplicate keys in source and target", () => {
    const source: ReconRecord[] = [
      { id: "1", amount: 1, qty: 1, status: "OK", ref: "A" },
      { id: "1", amount: 1, qty: 1, status: "OK", ref: "A" },
    ];
    const target: ReconRecord[] = [
      { id: "1", amount: 1, qty: 1, status: "OK", ref: "A" },
      { id: "2", amount: 1, qty: 1, status: "OK", ref: "A" },
      { id: "2", amount: 1, qty: 1, status: "OK", ref: "A" },
    ];
    const res = reconcile(source, target, config);
    const dupKeys = res.breaks.filter((b) => b.type === "duplicate_key").map((b) => b.key).sort();
    expect(dupKeys).toEqual(["1", "2"]);
    expect(res.summary.byType.duplicate_key).toBe(2);
  });

  it("defaults system labels when omitted", () => {
    const res = reconcile([], [], { keyField: "id", fields: [] });
    expect(res.summary.sourceSystem).toBe("source");
    expect(res.summary.targetSystem).toBe("target");
    expect(res.summary.balanced).toBe(true);
  });
});

describe("exception workflow", () => {
  it("walks open → investigating → resolved", () => {
    expect(applyExceptionAction("open", "investigate")).toBe("investigating");
    expect(applyExceptionAction("investigating", "resolve")).toBe("resolved");
  });

  it("supports write-off and reopen", () => {
    expect(applyExceptionAction("open", "write_off")).toBe("written_off");
    expect(applyExceptionAction("written_off", "reopen")).toBe("open");
    expect(applyExceptionAction("resolved", "reopen")).toBe("open");
  });

  it("rejects invalid transitions", () => {
    expect(() => applyExceptionAction("resolved", "investigate")).toThrow(ExceptionWorkflowError);
    try {
      applyExceptionAction("written_off", "resolve");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ExceptionWorkflowError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("isTerminalException marks resolved/written_off terminal", () => {
    expect(isTerminalException("resolved")).toBe(true);
    expect(isTerminalException("written_off")).toBe(true);
    expect(isTerminalException("open")).toBe(false);
    expect(isTerminalException("investigating")).toBe(false);
  });
});
