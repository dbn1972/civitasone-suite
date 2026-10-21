/**
 * GAP-PAYROLL-FORM16-05: the allow-list projection that keeps raw exception
 * text out of GET bulk-status.
 */
import { describe, it, expect } from "vitest";
import {
  FORM16_FAILURE_CODES,
  FORM16_FAILURE_LIST_CAP,
  isForm16FailureCode,
  publicFailureDetails,
} from "./failure-reasons.js";

describe("publicFailureDetails", () => {
  it("returns null when nothing usable is stored", () => {
    expect(publicFailureDetails(null)).toBeNull();
    expect(publicFailureDetails(undefined)).toBeNull();
    expect(publicFailureDetails({ error: "boom" })).toBeNull();
    expect(publicFailureDetails("boom")).toBeNull();
    expect(publicFailureDetails([])).toBeNull();
    expect(publicFailureDetails([null, 7, "x"])).toBeNull();
  });

  it("keeps only employeeNo and reasonCode, dropping the raw error text and the employee id", () => {
    const out = publicFailureDetails([
      {
        employeeId: "5b1c2d3e-0000-4000-8000-000000000e09",
        employeeNo: "EMP-0109",
        error: "connect ECONNREFUSED 10.0.3.7:5432 /srv/keys/signing.p12",
        reasonCode: "STORAGE_ERROR",
      },
    ]);
    expect(out).toEqual({ entries: [{ employeeNo: "EMP-0109", reasonCode: "STORAGE_ERROR" }], total: 1 });
    const json = JSON.stringify(out);
    expect(json).not.toContain("ECONNREFUSED");
    expect(json).not.toContain("5b1c2d3e");
    expect(json).not.toContain("employeeId");
  });

  it("maps an entry written before reason codes existed (or with an unknown code) to UNKNOWN", () => {
    const out = publicFailureDetails([
      { employeeId: "a", employeeNo: "EMP-1", error: "No PAN on file" },
      { employeeId: "b", employeeNo: "EMP-2", error: "x", reasonCode: "SOMETHING_NEW" },
      { employeeId: "c", employeeNo: "EMP-3", error: "x", reasonCode: 7 },
    ]);
    expect(out?.entries).toEqual([
      { employeeNo: "EMP-1", reasonCode: "UNKNOWN" },
      { employeeNo: "EMP-2", reasonCode: "UNKNOWN" },
      { employeeNo: "EMP-3", reasonCode: "UNKNOWN" },
    ]);
  });

  it("keeps the run-level marker and gives an entry without an employeeNo an empty one", () => {
    const out = publicFailureDetails([
      { employeeId: "system", employeeNo: "N/A", error: "db down", reasonCode: "UNKNOWN" },
      { employeeId: "x", error: "y", reasonCode: "SIGNING_FAILED" },
    ]);
    expect(out?.entries).toEqual([
      { employeeNo: "N/A", reasonCode: "UNKNOWN" },
      { employeeNo: "", reasonCode: "SIGNING_FAILED" },
    ]);
  });

  it("caps the returned rows but reports the full recorded count", () => {
    const stored = Array.from({ length: FORM16_FAILURE_LIST_CAP + 37 }, (_, i) => ({
      employeeId: `id-${i}`, employeeNo: `EMP-${i}`, error: "x", reasonCode: "DATA_UNAVAILABLE",
    }));
    const out = publicFailureDetails(stored);
    expect(out?.entries).toHaveLength(FORM16_FAILURE_LIST_CAP);
    expect(out?.entries[0]).toEqual({ employeeNo: "EMP-0", reasonCode: "DATA_UNAVAILABLE" });
    expect(out?.total).toBe(FORM16_FAILURE_LIST_CAP + 37);
  });

  it("bounds an absurdly long employeeNo", () => {
    const out = publicFailureDetails([{ employeeNo: "E".repeat(500), reasonCode: "UNKNOWN" }]);
    expect(out?.entries[0]?.employeeNo).toHaveLength(64);
  });
});

describe("isForm16FailureCode", () => {
  it("accepts exactly the closed set", () => {
    for (const c of FORM16_FAILURE_CODES) expect(isForm16FailureCode(c)).toBe(true);
    expect(isForm16FailureCode("NO_PAN")).toBe(false);
    expect(isForm16FailureCode("")).toBe(false);
    expect(isForm16FailureCode(undefined)).toBe(false);
  });
});
