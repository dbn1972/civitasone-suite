/**
 * CAP-117 — config preview / dry-run engine (pure).
 */
import { describe, it, expect } from "vitest";
import { previewConfigChange } from "../src/modules/preview/domain.js";

describe("previewConfigChange — field", () => {
  it("flags invalid apiName and unknown type, never persists", () => {
    const r = previewConfigChange({ kind: "field", field: { apiName: "Bad Name", fieldType: "wat" } });
    expect(r.wouldPersist).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.diagnostics.join()).toContain("invalid apiName");
    expect(r.diagnostics.join()).toContain("unknown fieldType");
  });

  it("detects collision with existing field", () => {
    const r = previewConfigChange({
      kind: "field",
      field: { apiName: "code", fieldType: "text" },
      existingFieldApiNames: ["code"],
    });
    expect(r.valid).toBe(false);
    expect(r.diagnostics.join()).toContain("already exists");
  });

  it("runs sample records through the proposed field", () => {
    const r = previewConfigChange({
      kind: "field",
      field: { apiName: "age", fieldType: "number", isRequired: true },
      sampleRecords: [{ age: 30 }, { age: "abc" }, {}],
    });
    expect(r.valid).toBe(true);
    expect(r.summary).toMatchObject({ samples: 3, passing: 1, failing: 2 });
  });
});

describe("previewConfigChange — validationRule", () => {
  it("evaluates sample records and reports pass/fail counts", () => {
    const r = previewConfigChange({
      kind: "validationRule",
      rule: { name: "positive", expression: "amount > 0", errorMessage: "must be positive" },
      sampleRecords: [{ amount: 5 }, { amount: -1 }],
    });
    expect(r.summary).toMatchObject({ samples: 2, passing: 1, failing: 1 });
  });

  it("flags empty expression", () => {
    const r = previewConfigChange({ kind: "validationRule", rule: { name: "x", expression: "  ", errorMessage: "m" } });
    expect(r.valid).toBe(false);
  });
});

describe("previewConfigChange — formula", () => {
  it("computes formula results across sample rows", () => {
    const r = previewConfigChange({
      kind: "formula",
      expression: "qty * price",
      sampleRecords: [{ qty: 2, price: 3 }, { qty: 4, price: 5 }],
    });
    expect(r.valid).toBe(true);
    expect((r.summary as { results: unknown[] }).results).toEqual([6, 20]);
  });

  it("reports a malformed formula", () => {
    const r = previewConfigChange({ kind: "formula", expression: "1 + )" });
    expect(r.valid).toBe(false);
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("previewConfigChange — entity", () => {
  it("flags collision with an existing entity", () => {
    const r = previewConfigChange({
      kind: "entity",
      entity: { apiName: "vehicle" },
      existingEntityApiNames: ["vehicle"],
    });
    expect(r.valid).toBe(false);
    expect(r.diagnostics.join()).toContain("already exists");
  });

  it("accepts a fresh entity apiName", () => {
    const r = previewConfigChange({ kind: "entity", entity: { apiName: "new_thing" }, existingEntityApiNames: [] });
    expect(r.valid).toBe(true);
  });
});
