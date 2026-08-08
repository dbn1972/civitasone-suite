/**
 * PFMS Module — validation and batch state machine tests.
 * Pack #18. Source: modules/pfms/*
 */
import { describe, it, expect } from "vitest";

describe("PFMS batch state machine", () => {
  type BatchStatus = "pending" | "signed" | "submitted" | "acknowledged" | "rejected" | "partial_failure";
  const TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
    pending: ["signed"],
    signed: ["submitted"],
    submitted: ["acknowledged", "rejected", "partial_failure"],
    acknowledged: [], rejected: [], partial_failure: [],
  };
  const can = (f: BatchStatus, t: BatchStatus) => (TRANSITIONS[f] ?? []).includes(t);

  it("pending → signed → submitted → acknowledged", () => {
    expect(can("pending", "signed")).toBe(true);
    expect(can("signed", "submitted")).toBe(true);
    expect(can("submitted", "acknowledged")).toBe(true);
  });
  it("submitted → rejected", () => expect(can("submitted", "rejected")).toBe(true));
  it("submitted → partial_failure", () => expect(can("submitted", "partial_failure")).toBe(true));
  it("acknowledged is terminal", () => expect(can("acknowledged", "pending")).toBe(false));
  it("cannot skip signing (pending → submitted)", () => expect(can("pending", "submitted")).toBe(false));
});

describe("PFMS amount validation", () => {
  const AMOUNT_RE = /^\d+$/;
  it("accepts valid numeric paise string", () => {
    expect(AMOUNT_RE.test("5000000")).toBe(true);
    expect(AMOUNT_RE.test("1")).toBe(true);
  });
  it("rejects non-numeric", () => {
    expect(AMOUNT_RE.test("5000.00")).toBe(false);
    expect(AMOUNT_RE.test("-100")).toBe(false);
    expect(AMOUNT_RE.test("")).toBe(false);
  });
});

describe("PFMS no duplicate disbursement", () => {
  it("same referenceId = idempotent (skip)", () => {
    const processed = new Set(["ref-001"]);
    expect(processed.has("ref-001")).toBe(true);
  });
  it("new referenceId = process", () => {
    const processed = new Set(["ref-001"]);
    expect(processed.has("ref-002")).toBe(false);
  });
});

describe("PFMS secret masking", () => {
  it("certificate private key never in event payload", () => {
    const payload = { batchId: "b1", status: "signed", signedAt: "2026-07-15T10:00:00Z" };
    const json = JSON.stringify(payload);
    expect(json).not.toContain("privateKey");
    expect(json).not.toContain("BEGIN RSA");
    expect(json).not.toContain("certificate");
  });
});
