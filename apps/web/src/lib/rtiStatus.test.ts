import { describe, it, expect } from "vitest";
import { isRtiClosed, RTI_CLOSED_STATUSES, RTI_READ_STATUSES } from "./rtiStatus";

describe("isRtiClosed — unified RTI statutory-clock close rule (GAP-CITIZEN-RTI-05 / RTI-DETAIL-05)", () => {
  it("open read-model statuses keep the clock running", () => {
    expect(isRtiClosed("received")).toBe(false);
    expect(isRtiClosed("forwarded")).toBe(false);
    expect(isRtiClosed("under_review")).toBe(false);
  });

  it("terminal read-model statuses close the clock", () => {
    expect(isRtiClosed("replied")).toBe(true);
    expect(isRtiClosed("appeal")).toBe(true);
    expect(isRtiClosed("closed")).toBe(true);
  });

  it("write-side synonyms also close the clock (defence in depth)", () => {
    expect(isRtiClosed("responded")).toBe(true);
    expect(isRtiClosed("appealed")).toBe(true);
  });

  it("a recorded response closes the clock even when status is still open", () => {
    // read-your-writes lag: response landed, status not yet re-projected
    expect(isRtiClosed("received", 1)).toBe(true);
    expect(isRtiClosed("under_review", 2)).toBe(true);
  });

  it("null/undefined/unknown status with no responses is treated as open", () => {
    expect(isRtiClosed(null)).toBe(false);
    expect(isRtiClosed(undefined)).toBe(false);
    expect(isRtiClosed("")).toBe(false);
    expect(isRtiClosed("something_else")).toBe(false);
  });

  it("every terminal read-model status is in the closed set", () => {
    expect(RTI_CLOSED_STATUSES.has("replied")).toBe(true);
    expect(RTI_CLOSED_STATUSES.has("appeal")).toBe(true);
    expect(RTI_CLOSED_STATUSES.has("closed")).toBe(true);
    // open ones are NOT
    expect(RTI_CLOSED_STATUSES.has("received")).toBe(false);
    expect(RTI_CLOSED_STATUSES.has("forwarded")).toBe(false);
    expect(RTI_CLOSED_STATUSES.has("under_review")).toBe(false);
  });

  it("exposes the canonical read-model enum", () => {
    expect([...RTI_READ_STATUSES]).toEqual([
      "received",
      "forwarded",
      "under_review",
      "replied",
      "appeal",
      "closed",
    ]);
  });
});
